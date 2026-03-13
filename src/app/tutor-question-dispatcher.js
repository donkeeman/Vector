import { createInactiveSession, shouldDispatchAutoQuestion } from "../domain/session-policy.js";
import { createThreadState } from "../domain/thread-policy.js";
import { pickNextTopic } from "../domain/topic-memory.js";

const NOOP_LOGGER = {
  debug() {},
  error() {},
};

export function createTutorQuestionDispatcher({
  store,
  llmRunner,
  slackClient,
  topics,
  topicSelector = pickTopicForContinuousFlow,
  random = Math.random,
  logger = NOOP_LOGGER,
}) {
  let dispatchInFlight = null;
  let lastDispatchedTopicId = null;
  const topicSelectionState = {
    topicBag: [],
  };

  async function dispatchNextQuestion(now = new Date()) {
    if (dispatchInFlight) {
      return dispatchInFlight;
    }

    const pendingDispatch = runDispatch(now);
    dispatchInFlight = pendingDispatch;

    try {
      return await pendingDispatch;
    } finally {
      if (dispatchInFlight === pendingDispatch) {
        dispatchInFlight = null;
      }
    }
  }

  async function runDispatch(now) {
    const session = (await store.getSession()) ?? createInactiveSession();
    const openThreads = await store.listOpenThreads();
    const hasOpenStudyThread = openThreads.some((thread) => (thread.kind ?? "study") === "study");
    const hasCounterQuestionThread = openThreads.some(
      (thread) => thread.mode === "counterquestion",
    );

    if (hasOpenStudyThread || !shouldDispatchAutoQuestion(session, hasCounterQuestionThread)) {
      logger.debug("tutor_bot.dispatch_skipped", {
        reason: hasOpenStudyThread
          ? "open_study_thread_exists"
          : "session_not_dispatchable",
        sessionState: session.state,
        hasCounterQuestionThread,
      });
      return null;
    }

    const memories = await store.getTopicMemories();
    const catalogTopics = await listCatalogTopics(now);
    let topic = topicSelector({
      now,
      topics: catalogTopics,
      memories,
      random,
      lastTopicId: lastDispatchedTopicId,
      state: topicSelectionState,
    });

    if (!topic) {
      topic = await generateTopic({ now, catalogTopics });

      if (topic) {
        await saveTopicIfSupported(topic, now);
      }
    }

    if (!topic) {
      logger.debug("tutor_bot.dispatch_skipped", {
        reason: "no_topic_available",
      });
      return null;
    }

    if (typeof store.touchTopic === "function") {
      await store.touchTopic(topic.id, now);
    }

    logger.debug("tutor_bot.dispatch_topic_selected", {
      topicId: topic.id,
    });
    lastDispatchedTopicId = topic.id;
    const topicMemory = memories.get(topic.id) ?? null;
    const question = await llmRunner.runTask("question", {
      topic,
      topicMemory,
    });
    const message = await slackClient.postDirectMessage(question.text);
    const thread = createThreadState({
      slackThreadTs: message.ts,
      topicId: topic.id,
      openedAt: now,
      lastAssistantPrompt: question.text,
      lastChallengePrompt: question.text,
      codexSessionId: question.codexSessionId ?? null,
    });

    await store.saveThread(thread);
    return thread;
  }

  async function listCatalogTopics(now) {
    if (typeof store.listTopics !== "function") {
      return Array.isArray(topics) ? [...topics] : [];
    }

    let catalogTopics = await store.listTopics();

    if (catalogTopics.length === 0 && Array.isArray(topics) && topics.length > 0) {
      for (const topic of topics) {
        await saveTopicIfSupported(topic, now);
      }
      catalogTopics = await store.listTopics();
    }

    return catalogTopics;
  }

  async function saveTopicIfSupported(topic, now) {
    if (typeof store.saveTopic !== "function") {
      return;
    }

    await store.saveTopic(topic, now);
  }

  async function generateTopic({ now, catalogTopics }) {
    const recentTopics = await loadRecentTopicHistory();
    const existingIds = new Set(catalogTopics.map((topic) => topic.id));
    const existingTitles = new Set(
      catalogTopics.map((topic) => String(topic.title ?? "").trim().toLowerCase()).filter(Boolean),
    );

    const generated = await llmRunner.runTask("topic", {
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
      logger.error("tutor_bot.topic_generation_invalid", {
        rawTopic,
      });
      return null;
    }

    if (existingTitles.has(normalized.title.toLowerCase())) {
      logger.debug("tutor_bot.topic_generation_deduplicated", {
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

  async function loadRecentTopicHistory(limit = 8) {
    const threads = await store.listOpenThreads();
    const recentFromOpen = threads
      .filter((thread) => (thread.kind ?? "study") === "study" && thread.topicId)
      .slice(-limit)
      .map((thread) => thread.topicId);

    if (recentFromOpen.length > 0) {
      return recentFromOpen;
    }

    return lastDispatchedTopicId ? [lastDispatchedTopicId] : [];
  }

  return {
    dispatchNextQuestion,
  };
}

export function pickTopicForContinuousFlow({
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
