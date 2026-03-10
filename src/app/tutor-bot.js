import { normalizeControlCommand } from "./control-command.js";
import { looksLikeCounterQuestion } from "./counter-question.js";
import {
  createInactiveSession,
  createStartedSession,
  endSession,
  pauseSession,
  resumeSession,
  shouldDispatchAutoQuestion,
} from "../domain/session-policy.js";
import {
  closeThread,
  createThreadState,
  markThreadAsCounterQuestion,
  resolveCounterQuestion,
} from "../domain/thread-policy.js";
import {
  createEmptyTopicMemory,
  pickNextTopic,
  updateTopicMemory,
} from "../domain/topic-memory.js";

export class TutorBot {
  constructor({ store, llmRunner, slackClient, topics }) {
    this.store = store;
    this.llmRunner = llmRunner;
    this.slackClient = slackClient;
    this.topics = topics;
  }

  async handleControlInput(input, now = new Date()) {
    const command = normalizeControlCommand(input);

    if (!command) {
      return null;
    }

    const session = (await this.store.getSession()) ?? createInactiveSession();
    let nextSession = session;

    if (command === "start") {
      nextSession = createStartedSession(now);
    } else if (command === "pause") {
      nextSession = pauseSession(session, now);
    } else if (command === "resume") {
      nextSession = resumeSession(session);
    } else if (command === "end") {
      nextSession = endSession(session, now);
    }

    await this.store.saveSession(nextSession);
    return nextSession;
  }

  async dispatchNextQuestion(now = new Date()) {
    const session = (await this.store.getSession()) ?? createInactiveSession();
    const openThreads = await this.store.listOpenThreads();
    const hasCounterQuestionThread = openThreads.some(
      (thread) => thread.mode === "counterquestion",
    );

    if (!shouldDispatchAutoQuestion(session, hasCounterQuestionThread)) {
      return null;
    }

    const topic = pickNextTopic({
      now,
      topics: this.topics,
      memories: await this.store.getTopicMemories(),
    });

    if (!topic) {
      return null;
    }

    const question = await this.llmRunner.runTask("question", { topic });
    const message = await this.slackClient.postDirectMessage(question.text);
    const thread = createThreadState({
      slackThreadTs: message.ts,
      topicId: topic.id,
      openedAt: now,
    });

    await this.store.saveThread(thread);
    return thread;
  }

  async handleThreadMessage({ threadTs, text, now = new Date() }) {
    const thread = await this.store.getThread(threadTs);

    if (!thread || thread.status !== "open") {
      return null;
    }

    if (looksLikeCounterQuestion(text)) {
      const counterThread = markThreadAsCounterQuestion(thread, now);
      await this.store.saveThread(counterThread);

      const answer = await this.llmRunner.runTask("answer_counterquestion", {
        thread: counterThread,
        text,
      });

      await this.slackClient.postThreadReply(threadTs, answer.text);

      const resolvedThread = answer.resolved === false
        ? counterThread
        : resolveCounterQuestion(counterThread, now);
      await this.store.saveThread(resolvedThread);
      return resolvedThread;
    }

    const evaluation = await this.llmRunner.runTask("evaluate", {
      thread,
      text,
    });

    await this.store.saveAttempt({
      threadTs,
      topicId: thread.topicId,
      answer: text,
      outcome: evaluation.outcome,
      recordedAt: now,
      rationale: evaluation.rationale ?? null,
    });

    const currentMemory =
      (await this.store.getTopicMemory(thread.topicId)) ?? createEmptyTopicMemory();
    const nextMemory = updateTopicMemory(currentMemory, evaluation.outcome, now);
    await this.store.saveTopicMemory(thread.topicId, nextMemory);

    if (evaluation.outcome === "continue") {
      const followUp = await this.llmRunner.runTask("followup", {
        thread,
        text,
        evaluation,
      });

      await this.slackClient.postThreadReply(threadTs, followUp.text);
      return { thread, memory: nextMemory };
    }

    if (evaluation.outcome === "blocked") {
      const teaching = await this.llmRunner.runTask("teach", {
        thread,
        text,
        evaluation,
      });

      await this.slackClient.postThreadReply(threadTs, teaching.text);
      const closedThread = closeThread(thread, "blocked", now);
      await this.store.saveThread(closedThread);
      return { thread: closedThread, memory: nextMemory };
    }

    const reply = evaluation.text ?? "흥, 이번엔 넘어간다. 다음엔 더 깊게 물어볼 거야.";
    await this.slackClient.postThreadReply(threadTs, reply);
    const closedThread = closeThread(thread, "mastered", now);
    await this.store.saveThread(closedThread);
    return { thread: closedThread, memory: nextMemory };
  }
}
