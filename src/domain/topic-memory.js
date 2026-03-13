import { addKstDays } from "./time.js";

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
  const next = {
    ...current,
    learningState: nextLearningState,
    timesAsked: current.timesAsked + 1,
    attemptCount: current.attemptCount + 1,
    lastOutcome: outcome,
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

  if (current.lastOutcome === "blocked") {
    return 4;
  }

  if (current.lastOutcome === "continue") {
    return 3;
  }

  if (current.lastOutcome === "mastered") {
    return current.lastMasteryKind === "recovered" ? 2 : 1;
  }

  return null;
}

export function pickNextTopic({ now, topics, memories }) {
  const candidates = topics
    .map((topic) => {
      const memory = memories.get(topic.id) ?? null;
      const bucket = classifyCandidateBucket(memory, now);

      if (bucket === null) {
        return null;
      }

      return {
        topic,
        bucket,
        effectiveWeight: Math.max(1, topic.weight ?? 1),
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      if (right.bucket !== left.bucket) {
        return right.bucket - left.bucket;
      }

      if (right.effectiveWeight !== left.effectiveWeight) {
        return right.effectiveWeight - left.effectiveWeight;
      }

      return left.topic.id.localeCompare(right.topic.id);
    });

  return candidates[0]?.topic ?? null;
}

function classifyCandidateBucket(memory, now) {
  const lane = classifyTopicLane(memory);
  if (lane === "new") {
    return 2;
  }

  const reviewPriority = classifyReviewPriority(memory, now);

  if (reviewPriority === 4) {
    return 4;
  }

  if (reviewPriority === 3) {
    return 3;
  }

  if (reviewPriority === 2) {
    return 1.5;
  }

  if (reviewPriority === 1) {
    return 1;
  }

  return null;
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
