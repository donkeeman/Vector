import test from "node:test";
import assert from "node:assert/strict";

import {
  createEmptyTopicMemory,
  scheduleReview,
  updateTopicMemory,
  pickNextTopic,
} from "../../src/domain/topic-memory.js";

test("blocked 주제는 최소 하루 뒤에 다시 묻는다", () => {
  const now = new Date("2026-03-10T10:00:00+09:00");

  const nextReviewAt = scheduleReview(
    {
      masteryScore: 0.2,
      attemptCount: 1,
      successCount: 0,
      failureCount: 1,
      lastOutcome: "blocked",
      nextReviewAt: null,
      masteredStreak: 0,
    },
    "blocked",
    now,
  );

  assert.equal(nextReviewAt.toISOString(), "2026-03-11T01:00:00.000Z");
});

test("mastered 주제는 나중에 다시 물어보되 연속 정답일수록 간격이 늘어난다", () => {
  const now = new Date("2026-03-10T10:00:00+09:00");
  const empty = createEmptyTopicMemory();

  const first = updateTopicMemory(empty, "mastered", now);
  assert.equal(first.nextReviewAt?.toISOString(), "2026-03-17T01:00:00.000Z");
  assert.equal(first.masteredStreak, 1);

  const second = updateTopicMemory(first, "mastered", now);
  assert.equal(second.nextReviewAt?.toISOString(), "2026-03-24T01:00:00.000Z");
  assert.equal(second.masteredStreak, 2);
});

test("출제 우선순위는 blocked due > weak due > new > mastered due 순이다", () => {
  const now = new Date("2026-03-10T10:00:00+09:00");
  const topics = [
    {
      id: "mastered-topic",
      title: "Mastered Topic",
      category: "frontend",
      promptSeed: "Explain event delegation.",
      weight: 3,
    },
    {
      id: "new-topic",
      title: "New Topic",
      category: "frontend",
      promptSeed: "Explain the rendering pipeline.",
      weight: 3,
    },
    {
      id: "weak-topic",
      title: "Weak Topic",
      category: "network",
      promptSeed: "Explain HTTP caching.",
      weight: 2,
    },
    {
      id: "blocked-topic",
      title: "Blocked Topic",
      category: "os",
      promptSeed: "Explain process vs thread.",
      weight: 1,
    },
  ];

  const selected = pickNextTopic({
    now,
    topics,
    memories: new Map([
      [
        "mastered-topic",
        {
          masteryScore: 0.9,
          attemptCount: 3,
          successCount: 3,
          failureCount: 0,
          lastOutcome: "mastered",
          nextReviewAt: now,
          masteredStreak: 2,
        },
      ],
      [
        "weak-topic",
        {
          masteryScore: 0.4,
          attemptCount: 2,
          successCount: 1,
          failureCount: 1,
          lastOutcome: "continue",
          nextReviewAt: now,
          masteredStreak: 0,
        },
      ],
      [
        "blocked-topic",
        {
          masteryScore: 0.1,
          attemptCount: 1,
          successCount: 0,
          failureCount: 1,
          lastOutcome: "blocked",
          nextReviewAt: now,
          masteredStreak: 0,
        },
      ],
    ]),
  });

  assert.equal(selected?.id, "blocked-topic");
});
