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
  constructor({
    store,
    llmRunner,
    slackClient,
    topics,
    topicSelector = pickTopicForContinuousFlow,
    random = Math.random,
    logger = NOOP_LOGGER,
  }) {
    this.store = store;
    this.llmRunner = llmRunner;
    this.slackClient = slackClient;
    this.topics = topics;
    this.topicSelector = topicSelector;
    this.random = random;
    this.logger = logger;
    this.dispatchInFlight = null;
    this.topicBag = [];
    this.lastDispatchedTopicId = null;
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

    if (command === "start" && session.state === "paused" && nextSession.state === "active") {
      await this.reopenLatestStoppedStudyThread();
    }

    if (command === "stop") {
      const closedThreads = await this.closeOpenThreadsAsStopped(now);
      this.logger.debug("tutor_bot.stop_closed_threads", {
        count: closedThreads.length,
      });
    }

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

  async reopenLatestStoppedStudyThread() {
    if (typeof this.store.getLatestStoppedStudyThread !== "function") {
      return null;
    }

    const latestStoppedStudyThread = await this.store.getLatestStoppedStudyThread();
    if (!latestStoppedStudyThread) {
      return null;
    }

    const reopenedThread = {
      ...latestStoppedStudyThread,
      status: "open",
      closedAt: null,
    };
    await this.store.saveThread(reopenedThread);
    this.logger.debug("tutor_bot.start_resumed_thread", {
      threadTs: reopenedThread.slackThreadTs,
      topicId: reopenedThread.topicId,
    });
    return reopenedThread;
  }

  async closeOpenThreadsAsStopped(now = new Date()) {
    const openThreads = await this.store.listOpenThreads();
    const closedThreads = [];

    for (const thread of openThreads) {
      const closedThread = closeThread(thread, "stopped", now);
      await this.store.saveThread(closedThread);
      closedThreads.push(closedThread);
    }

    return closedThreads;
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

    const memories = await this.store.getTopicMemories();
    const catalogTopics = await this.#listCatalogTopics(now);
    let topic = this.topicSelector({
      now,
      topics: catalogTopics,
      memories,
      random: this.random,
      lastTopicId: this.lastDispatchedTopicId,
      state: this,
    });

    if (!topic) {
      topic = await this.#generateTopic({
        now,
        catalogTopics,
      });

      if (topic) {
        await this.#saveTopicIfSupported(topic, now);
      }
    }

    if (!topic) {
      this.logger.debug("tutor_bot.dispatch_skipped", {
        reason: "no_topic_available",
      });
      return null;
    }

    if (typeof this.store.touchTopic === "function") {
      await this.store.touchTopic(topic.id, now);
    }

    this.logger.debug("tutor_bot.dispatch_topic_selected", {
      topicId: topic.id,
    });
    this.lastDispatchedTopicId = topic.id;
    const topicMemory = memories.get(topic.id) ?? null;
    const question = await this.llmRunner.runTask("question", {
      topic,
      topicMemory,
    });
    const message = await this.slackClient.postDirectMessage(question.text);
    const thread = createThreadState({
      slackThreadTs: message.ts,
      topicId: topic.id,
      openedAt: now,
      lastAssistantPrompt: question.text,
      lastChallengePrompt: question.text,
      codexSessionId: question.codexSessionId ?? null,
    });

    await this.store.saveThread(thread);
    return thread;
  }

  async #listCatalogTopics(now) {
    if (typeof this.store.listTopics !== "function") {
      return Array.isArray(this.topics) ? [...this.topics] : [];
    }

    let catalogTopics = await this.store.listTopics();

    if (catalogTopics.length === 0 && Array.isArray(this.topics) && this.topics.length > 0) {
      for (const topic of this.topics) {
        await this.#saveTopicIfSupported(topic, now);
      }
      catalogTopics = await this.store.listTopics();
    }

    return catalogTopics;
  }

  async #saveTopicIfSupported(topic, now) {
    if (typeof this.store.saveTopic !== "function") {
      return;
    }

    await this.store.saveTopic(topic, now);
  }

  async #generateTopic({ now, catalogTopics }) {
    const recentTopics = await this.#loadRecentTopicHistory();
    const existingIds = new Set(catalogTopics.map((topic) => topic.id));
    const existingTitles = new Set(
      catalogTopics.map((topic) => String(topic.title ?? "").trim().toLowerCase()).filter(Boolean),
    );

    const generated = await this.llmRunner.runTask("topic", {
      now: now.toISOString(),
      recentTopics,
      existingTopics: catalogTopics.map((topic) => ({
        id: topic.id,
        title: topic.title,
        category: topic.category,
      })),
    });

    const rawTopic = generated?.topic ?? generated;
    const normalized = normalizeGeneratedTopic(rawTopic);

    if (!normalized) {
      this.logger.error("tutor_bot.topic_generation_invalid", {
        rawTopic,
      });
      return null;
    }

    if (existingTitles.has(normalized.title.toLowerCase())) {
      this.logger.debug("tutor_bot.topic_generation_deduplicated", {
        reason: "title_already_exists",
        title: normalized.title,
      });
      return null;
    }

    if (!existingIds.has(normalized.id)) {
      return normalized;
    }

    return {
      ...normalized,
      id: createUniqueTopicId(normalized.id, existingIds),
    };
  }

  async #loadRecentTopicHistory(limit = 8) {
    const threads = await this.store.listOpenThreads();
    const recentFromOpen = threads
      .filter((thread) => (thread.kind ?? "study") === "study" && thread.topicId)
      .slice(-limit)
      .map((thread) => thread.topicId);

    if (recentFromOpen.length > 0) {
      return recentFromOpen;
    }

    return this.lastDispatchedTopicId ? [this.lastDispatchedTopicId] : [];
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
        lastAssistantPrompt: counterThread.lastAssistantPrompt ?? null,
        lastChallengePrompt: getChallengePrompt(counterThread),
        codexSessionId: counterThread.codexSessionId ?? null,
      });

      await this.slackClient.postThreadReply(threadTs, answer.text);

      const resolvedThread = answer.resolved === false
        ? counterThread
        : resolveCounterQuestion(counterThread, now);
      const updatedThread = setThreadPrompts(
        mergeCodexSessionId(resolvedThread, answer.codexSessionId),
        {
          assistantPrompt: answer.text,
          challengePrompt: getChallengePrompt(counterThread),
        },
      );
      await this.store.saveThread(updatedThread);
      return {
        thread: updatedThread,
        shouldScheduleNextQuestion: false,
      };
    }

    const evaluation = await this.llmRunner.runTask("evaluate", {
      thread,
      text,
      lastAssistantPrompt: thread.lastAssistantPrompt ?? null,
      lastChallengePrompt: getChallengePrompt(thread),
      codexSessionId: thread.codexSessionId ?? null,
    });
    const normalizedEvaluation = normalizeEvaluationResult(text, evaluation);
    const sessionBoundThread = mergeCodexSessionId(thread, normalizedEvaluation.codexSessionId);

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
        thread: sessionBoundThread,
        text,
        evaluation: normalizedEvaluation,
        lastAssistantPrompt: sessionBoundThread.lastAssistantPrompt ?? null,
        lastChallengePrompt: getChallengePrompt(sessionBoundThread),
        codexSessionId: sessionBoundThread.codexSessionId ?? null,
      });

      await this.slackClient.postThreadReply(threadTs, followUp.text);
      const continuedThread = setThreadPrompts(
        mergeCodexSessionId(sessionBoundThread, followUp.codexSessionId),
        {
          assistantPrompt: followUp.text,
          challengePrompt: followUp.challengePrompt ?? followUp.text,
        },
      );
      await this.store.saveThread(continuedThread);
      return {
        thread: continuedThread,
        memory: nextMemory,
        shouldScheduleNextQuestion: false,
      };
    }

    if (normalizedEvaluation.outcome === "blocked") {
      const teaching = await this.llmRunner.runTask("teach", {
        thread: sessionBoundThread,
        text,
        evaluation: normalizedEvaluation,
        lastAssistantPrompt: sessionBoundThread.lastAssistantPrompt ?? null,
        lastChallengePrompt: getChallengePrompt(sessionBoundThread),
        codexSessionId: sessionBoundThread.codexSessionId ?? null,
      });

      const challengePrompt = normalizeChallengePrompt(
        teaching.challengePrompt,
        getChallengePrompt(sessionBoundThread),
      );
      await this.slackClient.postThreadReply(threadTs, teaching.text);
      if (challengePrompt && challengePrompt !== teaching.text) {
        await this.slackClient.postThreadReply(threadTs, challengePrompt);
      }
      const blockedThread = setThreadPrompts(
        {
          ...mergeCodexSessionId(sessionBoundThread, teaching.codexSessionId),
          blockedOnce: true,
        },
        {
          assistantPrompt: teaching.text,
          challengePrompt,
        },
      );
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
    const closedThread = closeThread(sessionBoundThread, "mastered", now);
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
  if (evaluation.outcome !== "blocked" && looksExplicitlyStuckAnswer(text)) {
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

function setThreadPrompts(thread, { assistantPrompt, challengePrompt }) {
  return {
    ...thread,
    lastAssistantPrompt: assistantPrompt ?? null,
    lastChallengePrompt: challengePrompt ?? null,
  };
}

function mergeCodexSessionId(thread, codexSessionId) {
  if (!codexSessionId) {
    return thread;
  }

  return {
    ...thread,
    codexSessionId,
  };
}

function getChallengePrompt(thread) {
  return thread.lastChallengePrompt ?? thread.lastAssistantPrompt ?? null;
}

function normalizeChallengePrompt(primary, fallback) {
  const primaryText = typeof primary === "string" ? primary.trim() : "";
  if (primaryText) {
    return primaryText;
  }

  const fallbackText = typeof fallback === "string" ? fallback.trim() : "";
  return fallbackText || null;
}

function pickTopicForContinuousFlow({
  now,
  topics,
  memories,
  random = Math.random,
  lastTopicId = null,
  state = null,
}) {
  if (!Array.isArray(topics) || topics.length === 0) {
    return null;
  }

  const memoryMap = memories instanceof Map ? memories : new Map();
  const reviewCandidates = topics.filter((topic) => {
    const memory = memoryMap.get(topic.id);
    if (!memory) {
      return false;
    }
    if (memory.nextReviewAt && memory.nextReviewAt.getTime() > now.getTime()) {
      return false;
    }
    return true;
  });

  if (reviewCandidates.length > 0) {
    return pickNextTopic({
      now,
      topics: reviewCandidates,
      memories: memoryMap,
    });
  }

  const newTopicCandidates = topics.filter((topic) => memoryMap.has(topic.id) === false);
  if (newTopicCandidates.length === 0) {
    return null;
  }

  if (!state) {
    return pickRandomTopic(newTopicCandidates, random);
  }

  const availableIds = new Set(newTopicCandidates.map((topic) => topic.id));
  state.topicBag = Array.isArray(state.topicBag)
    ? state.topicBag.filter((topic) => availableIds.has(topic.id))
    : [];

  if (state.topicBag.length === 0) {
    state.topicBag = shuffleTopics(newTopicCandidates, random);
    if (
      state.topicBag.length > 1
      && lastTopicId
      && state.topicBag[0].id === lastTopicId
    ) {
      const [first, second, ...rest] = state.topicBag;
      state.topicBag = [second, first, ...rest];
    }
  }

  return state.topicBag.shift() ?? null;
}

function shuffleTopics(topics, random) {
  const shuffled = [...topics];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    const current = shuffled[index];
    shuffled[index] = shuffled[swapIndex];
    shuffled[swapIndex] = current;
  }

  return shuffled;
}

function pickRandomTopic(topics, random) {
  const index = Math.floor(random() * topics.length);
  return topics[index] ?? null;
}

function normalizeGeneratedTopic(rawTopic) {
  if (!rawTopic || typeof rawTopic !== "object") {
    return null;
  }

  const title = String(rawTopic.title ?? "").trim();
  const promptSeed = String(rawTopic.promptSeed ?? "").trim();
  const category = String(rawTopic.category ?? "general").trim().toLowerCase();
  const weightRaw = Number(rawTopic.weight ?? 3);
  const weight = Number.isFinite(weightRaw) ? Math.min(Math.max(Math.round(weightRaw), 1), 10) : 3;

  if (!title || !promptSeed) {
    return null;
  }

  const baseId = String(rawTopic.id ?? title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

  if (!baseId) {
    return null;
  }

  return {
    id: baseId,
    title,
    category: category || "general",
    promptSeed,
    weight,
  };
}

function createUniqueTopicId(baseId, existingIds) {
  let nextId = baseId;
  let counter = 2;

  while (existingIds.has(nextId)) {
    nextId = `${baseId}-${counter}`;
    counter += 1;
  }

  return nextId;
}
