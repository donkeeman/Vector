import { normalizeControlCommand } from "./control-command.js";
import { looksLikeCounterQuestion } from "./counter-question.js";
import {
  createInactiveSession,
  createStartedSession,
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

const STALE_THREAD_STATUS_REPLY = "테스트 재시작한다며? 이전 기록은 전부 쓰레기통에 버렸어. 깔끔하게 새 흐름에서 다시 붙어보자고. 이번엔 아까처럼 운 좋게 넘어갈 생각 마.";
const CLEAN_MASTERY_STATUS_REPLY = "어... 어라? 정답이라고? ...쳇, 운이 좋았네. 이번 한 번만 봐준다. 이 스레드는 여기서 닫을 테니까 기어오르지 말고 다음 문제나 기다려.";
const RECOVERED_MASTERY_STATUS_REPLY = "하, 처음엔 무너졌으면서 이제 와서 따라오네. 그래도 끝까지는 붙었으니 이번 스레드는 여기서 닫는다. 착각은 하지 마. 이건 겨우 따라온 거지, 처음부터 알고 있던 건 아니니까.";
const NOOP_LOGGER = {
  debug() {},
  error() {},
};

export class TutorBot {
  constructor({ store, llmRunner, slackClient, topics, logger = NOOP_LOGGER }) {
    this.store = store;
    this.llmRunner = llmRunner;
    this.slackClient = slackClient;
    this.topics = topics;
    this.logger = logger;
    this.dispatchInFlight = null;
  }

  async handleControlInput(input, now = new Date()) {
    const command = normalizeControlCommand(input);

    if (!command) {
      return null;
    }

    return this.applyControlCommand(command, now);
  }

  async applyControlCommand(command, now = new Date()) {
    const session = (await this.store.getSession()) ?? createInactiveSession();
    let nextSession = session;

    if (command === "start") {
      if (session.state === "paused") {
        nextSession = resumeSession(session);
      } else if (session.state === "inactive") {
        nextSession = createStartedSession(now);
      }
    } else if (command === "stop") {
      nextSession = session.state === "active"
        ? pauseSession(session, now)
        : session;
    }

    await this.store.saveSession(nextSession);

    if (command === "start") {
      const openThreads = await this.store.listOpenThreads();
      const hasOpenStudyThread = openThreads.some((thread) => (thread.kind ?? "study") === "study");

      if (nextSession.state === "active" && hasOpenStudyThread === false) {
        try {
          await this.dispatchNextQuestion(now);
        } catch (error) {
          this.logger.error("tutor_bot.start_dispatch_failed", {
            message: error?.message ?? String(error),
          });
        }
      }
    }

    return nextSession;
  }

  async closeOpenStudyThreadsAsStale(now = new Date()) {
    const openThreads = await this.store.listOpenThreads();
    const openStudyThreads = openThreads.filter((thread) => (thread.kind ?? "study") === "study");
    const closedThreads = [];

    for (const thread of openStudyThreads) {
      try {
        await this.slackClient.postThreadReply(thread.slackThreadTs, STALE_THREAD_STATUS_REPLY);
      } catch (error) {
        this.logger.error("tutor_bot.stale_notice_failed", {
          threadTs: thread.slackThreadTs,
          message: error?.message ?? String(error),
        });
      }
      const closedThread = closeThread(thread, "stale", now);
      await this.store.saveThread(closedThread);
      closedThreads.push(closedThread);
    }

    return closedThreads;
  }

  async dispatchNextQuestion(now = new Date()) {
    if (this.dispatchInFlight) {
      return this.dispatchInFlight;
    }

    const pendingDispatch = this.#dispatchNextQuestion(now);
    this.dispatchInFlight = pendingDispatch;

    try {
      return await pendingDispatch;
    } finally {
      if (this.dispatchInFlight === pendingDispatch) {
        this.dispatchInFlight = null;
      }
    }
  }

  async #dispatchNextQuestion(now) {
    const session = (await this.store.getSession()) ?? createInactiveSession();
    const openThreads = await this.store.listOpenThreads();
    const hasOpenStudyThread = openThreads.some((thread) => (thread.kind ?? "study") === "study");
    const hasCounterQuestionThread = openThreads.some(
      (thread) => thread.mode === "counterquestion",
    );

    if (hasOpenStudyThread || !shouldDispatchAutoQuestion(session, hasCounterQuestionThread)) {
      this.logger.debug("tutor_bot.dispatch_skipped", {
        reason: hasOpenStudyThread
          ? "open_study_thread_exists"
          : "session_not_dispatchable",
        sessionState: session.state,
        hasCounterQuestionThread,
      });
      return null;
    }

    const topic = pickNextTopic({
      now,
      topics: this.topics,
      memories: await this.store.getTopicMemories(),
    });

    if (!topic) {
      this.logger.debug("tutor_bot.dispatch_skipped", {
        reason: "no_due_topic",
      });
      return null;
    }

    this.logger.debug("tutor_bot.dispatch_topic_selected", {
      topicId: topic.id,
    });
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
      return {
        thread: resolvedThread,
        shouldScheduleNextQuestion: false,
      };
    }

    const evaluation = await this.llmRunner.runTask("evaluate", {
      thread,
      text,
    });
    const normalizedEvaluation = normalizeEvaluationResult(text, evaluation);

    await this.store.saveAttempt({
      threadTs,
      topicId: thread.topicId,
      answer: text,
      outcome: normalizedEvaluation.outcome,
      recordedAt: now,
      rationale: normalizedEvaluation.rationale ?? null,
    });

    const currentMemory =
      (await this.store.getTopicMemory(thread.topicId)) ?? createEmptyTopicMemory();
    const masteryKind = normalizedEvaluation.outcome === "mastered"
      ? (thread.blockedOnce ? "recovered" : "clean")
      : undefined;
    const nextMemory = updateTopicMemory(
      currentMemory,
      normalizedEvaluation.outcome,
      now,
      masteryKind ? { masteryKind } : {},
    );
    await this.store.saveTopicMemory(thread.topicId, nextMemory);

    if (normalizedEvaluation.outcome === "continue") {
      const followUp = await this.llmRunner.runTask("followup", {
        thread,
        text,
        evaluation: normalizedEvaluation,
      });

      await this.slackClient.postThreadReply(threadTs, followUp.text);
      return {
        thread,
        memory: nextMemory,
        shouldScheduleNextQuestion: false,
      };
    }

    if (normalizedEvaluation.outcome === "blocked") {
      const teaching = await this.llmRunner.runTask("teach", {
        thread,
        text,
        evaluation: normalizedEvaluation,
      });

      await this.slackClient.postThreadReply(threadTs, teaching.text);
      const blockedThread = {
        ...thread,
        blockedOnce: true,
      };
      await this.store.saveThread(blockedThread);
      return {
        thread: blockedThread,
        memory: nextMemory,
        shouldScheduleNextQuestion: false,
      };
    }

    const reply = normalizedEvaluation.text ?? "흥, 이번엔 넘어간다. 다음엔 더 깊게 물어볼 거야.";
    await this.slackClient.postThreadReply(threadTs, reply);
    await this.slackClient.postThreadReply(
      threadTs,
      masteryKind === "recovered" ? RECOVERED_MASTERY_STATUS_REPLY : CLEAN_MASTERY_STATUS_REPLY,
    );
    const closedThread = closeThread(thread, "mastered", now);
    await this.store.saveThread(closedThread);
    return {
      thread: closedThread,
      memory: nextMemory,
      masteryKind,
      shouldScheduleNextQuestion: true,
    };
  }
}

function normalizeEvaluationResult(text, evaluation) {
  if (evaluation.outcome === "continue" && looksExplicitlyStuckAnswer(text)) {
    return {
      ...evaluation,
      outcome: "blocked",
      rationale: mergeRationale(
        evaluation.rationale,
        "The user explicitly signaled they are stuck or do not know the mechanism.",
      ),
    };
  }

  return evaluation;
}

function looksExplicitlyStuckAnswer(text) {
  const normalized = String(text ?? "").toLowerCase();
  return /모르겠|잘 모르|정확히는 모르|헷갈|까먹|기억 안 나|모르는데|모르겠는데/u.test(normalized);
}

function mergeRationale(rationale, addition) {
  if (!rationale) {
    return addition;
  }

  return `${rationale} ${addition}`;
}
