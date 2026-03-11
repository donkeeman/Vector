import { addKstDays } from "./time.js";

const FRONTEND_WEIGHT_BONUS = new Map([
  ["frontend", 10],
  ["browser", 8],
  ["web", 6],
  ["network", 3],
]);

export function createEmptyTopicMemory() {
  return {
    masteryScore: 0,
    attemptCount: 0,
    successCount: 0,
    failureCount: 0,
    lastOutcome: null,
    lastMasteryKind: null,
    nextReviewAt: null,
    masteredStreak: 0,
  };
}

export function scheduleReview(memory, outcome, now, options = {}) {
  if (outcome === "blocked") {
    return addKstDays(now, 1);
  }

  if (outcome === "mastered") {
    const masteryKind = options.masteryKind ?? "clean";
    const nextStreak = memory.lastOutcome === "mastered"
      ? memory.masteredStreak + 1
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
  const current = memory ?? createEmptyTopicMemory();
  const masteryKind = options.masteryKind ?? "clean";
  const next = {
    ...current,
    attemptCount: current.attemptCount + 1,
    lastOutcome: outcome,
    nextReviewAt: scheduleReview(current, outcome, now, { masteryKind }),
  };

  if (outcome === "mastered") {
    next.masteryScore = clamp(current.masteryScore + 0.35, 0, 1);
    next.successCount = current.successCount + 1;
    next.lastMasteryKind = masteryKind;
    next.masteredStreak = current.lastOutcome === "mastered"
      ? current.masteredStreak + 1
      : 1;
    return next;
  }

  if (outcome === "blocked") {
    next.masteryScore = clamp(current.masteryScore - 0.3, 0, 1);
    next.failureCount = current.failureCount + 1;
    next.masteredStreak = 0;
    next.lastMasteryKind = null;
    return next;
  }

  next.masteryScore = clamp(current.masteryScore + 0.05, 0, 1);
  next.masteredStreak = 0;
  next.lastMasteryKind = null;
  return next;
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
        effectiveWeight: topic.weight + (FRONTEND_WEIGHT_BONUS.get(topic.category) ?? 0),
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
  if (!memory) {
    return 2;
  }

  if (memory.nextReviewAt && memory.nextReviewAt.getTime() > now.getTime()) {
    return null;
  }

  if (memory.lastOutcome === "blocked") {
    return 4;
  }

  if (isWeak(memory)) {
    return 3;
  }

  if (memory.lastOutcome === "mastered") {
    return 1;
  }

  return null;
}

function isWeak(memory) {
  return memory.lastOutcome === "continue" || memory.masteryScore < 0.6;
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
