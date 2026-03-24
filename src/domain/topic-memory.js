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
    attemptCount: 0,
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
    next.timesBlocked = current.timesBlocked + 1;
    next.masteredStreak = 0;
    return next;
  }

  next.masteredStreak = 0;
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

  const attemptCount = Number(memory.attemptCount ?? memory.timesAsked ?? 0);
  const timesAsked = Number(memory.timesAsked ?? attemptCount);
  const timesBlocked = Number(memory.timesBlocked ?? 0);
  const timesMasteredRecovered = Number(memory.timesMasteredRecovered ?? 0);
  const timesRecovered = Number(memory.timesRecovered ?? timesMasteredRecovered);
  const timesMasteredClean = Number(memory.timesMasteredClean ?? 0);
  const learningState = memory.learningState ?? "new";

  return {
    learningState,
    timesAsked,
    timesBlocked,
    timesRecovered,
    timesMasteredClean,
    timesMasteredRecovered,
    lastMisconceptionSummary: memory.lastMisconceptionSummary ?? null,
    lastTeachingSummary: memory.lastTeachingSummary ?? null,
    lastAskedAt: parseDateOrNull(memory.lastAskedAt),
    lastAnsweredAt: parseDateOrNull(memory.lastAnsweredAt),
    lastOutcome: memory.lastOutcome ?? null,
    nextReviewAt: parseDateOrNull(memory.nextReviewAt),
    attemptCount,
    masteredStreak: Number(memory.masteredStreak ?? 0),
  };
}

function parseDateOrNull(value) {
  if (!value) {
    return null;
  }

  return value instanceof Date ? value : new Date(value);
}
