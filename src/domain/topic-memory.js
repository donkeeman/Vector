import { addKstDays } from "./time.js";

const DEFAULT_LANE_WEIGHTS = {
  new: 60,
  review: 40,
};

export function createEmptyTopicMemory() {
  return {
    learningState: "new",
    timesAsked: 0,
    timesBlocked: 0,
    timesRecovered: 0,
    timesMasteredClean: 0,
    timesMasteredRecovered: 0,
    lastMisconceptionSummary: null,
    lastTeachingSummary: null,
    lastAskedAt: null,
    lastAnsweredAt: null,
    lastOutcome: null,
    nextReviewAt: null,
    masteryScore: 0,
    attemptCount: 0,
    successCount: 0,
    failureCount: 0,
    lastMasteryKind: null,
    masteredStreak: 0,
  };
}

export function scheduleReview(memory, outcome, now, options = {}) {
  const current = normalizeTopicMemory(memory);

  if (outcome === "blocked") {
    return addKstDays(now, 1);
  }

  if (outcome === "mastered") {
    const masteryKind = options.masteryKind ?? "clean";
    const nextStreak = current.lastOutcome === "mastered"
      ? current.masteredStreak + 1
      : 1;
    const cleanDays = masteryDaysForStreak(nextStreak);
    const days = masteryKind === "recovered"
      ? recoveredMasteryDaysForStreak(nextStreak)
      : cleanDays;
    return addKstDays(now, days);
  }

  return now;
}

export function updateTopicMemory(memory, outcome, now, options = {}) {
  const current = normalizeTopicMemory(memory);
  const nextLearningState = resolveLearningState(current, outcome, options);
  const masteryKind = nextLearningState === "mastered_recovered"
    ? "recovered"
    : "clean";
  const hasMisconceptionSummary = typeof options.lastMisconceptionSummary === "string"
    && options.lastMisconceptionSummary.trim().length > 0;
  const hasTeachingSummary = typeof options.lastTeachingSummary === "string"
    && options.lastTeachingSummary.trim().length > 0;
  const next = {
    ...current,
    learningState: nextLearningState,
    timesAsked: current.timesAsked + 1,
    attemptCount: current.attemptCount + 1,
    lastOutcome: outcome,
    lastMisconceptionSummary: hasMisconceptionSummary
      ? options.lastMisconceptionSummary.trim()
      : current.lastMisconceptionSummary,
    lastTeachingSummary: hasTeachingSummary
      ? options.lastTeachingSummary.trim()
      : current.lastTeachingSummary,
    lastAskedAt: parseDateOrNull(options.lastAskedAt ?? current.lastAskedAt),
    lastAnsweredAt: now,
    nextReviewAt: scheduleReview(current, outcome, now, { masteryKind }),
  };

  if (outcome === "mastered") {
    next.masteryScore = clamp(current.masteryScore + 0.35, 0, 1);
    next.successCount = current.successCount + 1;
    next.lastMasteryKind = masteryKind;
    if (nextLearningState === "mastered_recovered") {
      next.timesRecovered = current.timesRecovered + 1;
      next.timesMasteredRecovered = current.timesMasteredRecovered + 1;
    } else {
      next.timesMasteredClean = current.timesMasteredClean + 1;
    }
    next.masteredStreak = current.lastOutcome === "mastered"
      ? current.masteredStreak + 1
      : 1;
    return next;
  }

  if (outcome === "blocked") {
    next.masteryScore = clamp(current.masteryScore - 0.3, 0, 1);
    next.failureCount = current.failureCount + 1;
    next.timesBlocked = current.timesBlocked + 1;
    next.masteredStreak = 0;
    next.lastMasteryKind = null;
    return next;
  }

  next.masteryScore = clamp(current.masteryScore + 0.05, 0, 1);
  next.masteredStreak = 0;
  next.lastMasteryKind = null;
  return next;
}

export function classifyTopicLane(memory) {
  if (!memory) {
    return "new";
  }

  const current = normalizeTopicMemory(memory);
  return current.timesAsked > 0 ? "review" : "new";
}

export function classifyReviewPriority(memory, now) {
  if (!memory) {
    return null;
  }

  const current = normalizeTopicMemory(memory);
  if (classifyTopicLane(current) !== "review") {
    return null;
  }

  if (current.nextReviewAt && current.nextReviewAt.getTime() > now.getTime()) {
    return null;
  }

  if (current.learningState === "blocked") {
    return 4;
  }

  if (current.learningState === "fuzzy") {
    return 3;
  }

  if (current.learningState === "mastered_recovered") {
    return 2;
  }

  if (current.learningState === "mastered_clean") {
    return 1;
  }

  return null;
}

export function selectStudyLane({
  hasNewTopic,
  hasReviewTopic,
  random = Math.random,
  laneWeights = DEFAULT_LANE_WEIGHTS,
}) {
  if (hasNewTopic && !hasReviewTopic) {
    return "new";
  }

  if (hasReviewTopic && !hasNewTopic) {
    return "review";
  }

  if (!hasNewTopic && !hasReviewTopic) {
    return null;
  }

  const newWeightRaw = Number(laneWeights?.new ?? DEFAULT_LANE_WEIGHTS.new);
  const reviewWeightRaw = Number(laneWeights?.review ?? DEFAULT_LANE_WEIGHTS.review);
  const newWeight = Number.isFinite(newWeightRaw) ? Math.max(0, newWeightRaw) : DEFAULT_LANE_WEIGHTS.new;
  const reviewWeight = Number.isFinite(reviewWeightRaw)
    ? Math.max(0, reviewWeightRaw)
    : DEFAULT_LANE_WEIGHTS.review;
  const total = newWeight + reviewWeight;

  if (total <= 0) {
    return random() < 0.5 ? "new" : "review";
  }

  return random() < (newWeight / total) ? "new" : "review";
}

export function pickReviewTopic({ now, topics, memories }) {
  const memoryMap = memories instanceof Map ? memories : new Map();
  const candidates = topics
    .map((topic) => {
      const memory = memoryMap.get(topic.id) ?? null;
      const priority = classifyReviewPriority(memory, now);
      if (priority === null) {
        return null;
      }

      return {
        topic,
        priority,
        effectiveWeight: Math.max(1, topic.weight ?? 1),
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      if (right.priority !== left.priority) {
        return right.priority - left.priority;
      }

      if (right.effectiveWeight !== left.effectiveWeight) {
        return right.effectiveWeight - left.effectiveWeight;
      }

      return left.topic.id.localeCompare(right.topic.id);
    });

  return candidates[0]?.topic ?? null;
}

export function pickNextTopic({ now, topics, memories }) {
  const memoryMap = memories instanceof Map ? memories : new Map();
  const reviewTopic = pickReviewTopic({
    now,
    topics,
    memories: memoryMap,
  });
  if (reviewTopic) {
    return reviewTopic;
  }

  const newTopics = topics
    .filter((topic) => classifyTopicLane(memoryMap.get(topic.id) ?? null) === "new")
    .sort((left, right) => {
      const leftWeight = Math.max(1, left.weight ?? 1);
      const rightWeight = Math.max(1, right.weight ?? 1);
      if (rightWeight !== leftWeight) {
        return rightWeight - leftWeight;
      }
      return left.id.localeCompare(right.id);
    });

  return newTopics[0] ?? null;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function masteryDaysForStreak(streak) {
  return Math.min(7 * 2 ** (streak - 1), 30);
}

function recoveredMasteryDaysForStreak(streak) {
  if (streak <= 1) {
    return 3;
  }

  return masteryDaysForStreak(streak - 1);
}

function resolveLearningState(current, outcome, options) {
  if (outcome === "blocked") {
    return "blocked";
  }

  if (outcome === "continue") {
    return "fuzzy";
  }

  if (outcome === "mastered") {
    if (options.masteryKind === "recovered") {
      return "mastered_recovered";
    }

    if (current.learningState === "blocked" || current.timesBlocked > current.timesRecovered) {
      return "mastered_recovered";
    }

    return "mastered_clean";
  }

  return current.learningState;
}

function normalizeTopicMemory(memory) {
  if (!memory) {
    return createEmptyTopicMemory();
  }

  const base = createEmptyTopicMemory();
  const timesAsked = Number(memory.timesAsked ?? memory.attemptCount ?? 0);
  const timesBlocked = Number(memory.timesBlocked ?? memory.failureCount ?? 0);
  const timesMasteredRecovered = Number(
    memory.timesMasteredRecovered
      ?? (memory.lastMasteryKind === "recovered" ? memory.successCount ?? 0 : 0),
  );
  const timesRecovered = Number(memory.timesRecovered ?? timesMasteredRecovered);
  const timesMasteredClean = Number(
    memory.timesMasteredClean
      ?? Math.max(0, Number(memory.successCount ?? 0) - timesMasteredRecovered),
  );
  const learningState = memory.learningState ?? inferLearningStateFromLegacy(memory);

  return {
    ...base,
    ...memory,
    learningState,
    timesAsked,
    timesBlocked,
    timesRecovered,
    timesMasteredClean,
    timesMasteredRecovered,
    lastAskedAt: parseDateOrNull(memory.lastAskedAt),
    lastAnsweredAt: parseDateOrNull(memory.lastAnsweredAt),
    nextReviewAt: parseDateOrNull(memory.nextReviewAt),
    attemptCount: Number(memory.attemptCount ?? timesAsked),
    successCount: Number(memory.successCount ?? (timesMasteredClean + timesMasteredRecovered)),
    failureCount: Number(memory.failureCount ?? timesBlocked),
    masteredStreak: Number(memory.masteredStreak ?? 0),
    masteryScore: Number(memory.masteryScore ?? 0),
  };
}

function inferLearningStateFromLegacy(memory) {
  if (memory.lastOutcome === "blocked") {
    return "blocked";
  }

  if (memory.lastOutcome === "continue") {
    return "fuzzy";
  }

  if (memory.lastOutcome === "mastered") {
    return memory.lastMasteryKind === "recovered"
      ? "mastered_recovered"
      : "mastered_clean";
  }

  return "new";
}

function parseDateOrNull(value) {
  if (!value) {
    return null;
  }

  return value instanceof Date ? value : new Date(value);
}
