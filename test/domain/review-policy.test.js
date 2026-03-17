import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyReviewPriority,
  classifyTopicLane,
  createEmptyTopicMemory,
  pickReviewTopic,
  selectStudyLane,
  updateTopicMemory,
} from "../../src/domain/topic-memory.js";

test("createEmptyTopicMemory는 structured memory 기본 shape를 가진다", () => {
  const memory = createEmptyTopicMemory();

  assert.equal(memory.learningState, "new");
  assert.equal(memory.timesAsked, 0);
  assert.equal(memory.timesBlocked, 0);
  assert.equal(memory.timesRecovered, 0);
  assert.equal(memory.timesMasteredClean, 0);
  assert.equal(memory.timesMasteredRecovered, 0);
  assert.equal(memory.lastMisconceptionSummary, null);
  assert.equal(memory.lastTeachingSummary, null);
  assert.equal(memory.lastAskedAt, null);
  assert.equal(memory.lastAnsweredAt, null);
  assert.equal(memory.lastOutcome, null);
  assert.equal(memory.nextReviewAt, null);
  assert.equal("masteryScore" in memory, false);
  assert.equal("successCount" in memory, false);
  assert.equal("failureCount" in memory, false);
  assert.equal("lastMasteryKind" in memory, false);
});

test("outcome 전이에 따라 learningState가 계산된다", () => {
  const now = new Date("2026-03-10T10:00:00+09:00");
  const empty = createEmptyTopicMemory();

  const firstSuccess = updateTopicMemory(empty, "mastered", now);
  assert.equal(firstSuccess.learningState, "mastered_clean");
  assert.equal(firstSuccess.timesMasteredClean, 1);
  assert.equal("masteryScore" in firstSuccess, false);
  assert.equal("successCount" in firstSuccess, false);
  assert.equal("failureCount" in firstSuccess, false);
  assert.equal("lastMasteryKind" in firstSuccess, false);

  const blocked = updateTopicMemory(empty, "blocked", now);
  assert.equal(blocked.learningState, "blocked");
  assert.equal(blocked.timesBlocked, 1);

  const recovered = updateTopicMemory(blocked, "mastered", now);
  assert.equal(recovered.learningState, "mastered_recovered");
  assert.equal(recovered.timesRecovered, 1);
  assert.equal(recovered.timesMasteredRecovered, 1);

  const fuzzy = updateTopicMemory(empty, "continue", now);
  assert.equal(fuzzy.learningState, "fuzzy");
});

test("new > review lane 분류와 review 우선순위(blocked > fuzzy > mastered_recovered > mastered_clean)가 고정된다", () => {
  const now = new Date("2026-03-10T10:00:00+09:00");

  assert.equal(classifyTopicLane(null), "new");
  assert.equal(classifyTopicLane({ ...createEmptyTopicMemory(), timesAsked: 1 }), "review");

  const blockedMemory = {
    ...createEmptyTopicMemory(),
    timesAsked: 1,
    learningState: "blocked",
    nextReviewAt: now,
  };
  const fuzzyMemory = {
    ...createEmptyTopicMemory(),
    timesAsked: 1,
    learningState: "fuzzy",
    nextReviewAt: now,
  };
  const recoveredMemory = {
    ...createEmptyTopicMemory(),
    timesAsked: 1,
    learningState: "mastered_recovered",
    nextReviewAt: now,
  };
  const cleanMemory = {
    ...createEmptyTopicMemory(),
    timesAsked: 1,
    learningState: "mastered_clean",
    nextReviewAt: now,
  };

  assert.equal(classifyReviewPriority(blockedMemory, now), 4);
  assert.equal(classifyReviewPriority(fuzzyMemory, now), 3);
  assert.equal(classifyReviewPriority(recoveredMemory, now), 2);
  assert.equal(classifyReviewPriority(cleanMemory, now), 1);
});

test("lane selector는 new/review가 모두 가능하면 기본 비율을 new 60, review 40으로 고른다", () => {
  let newCount = 0;
  let reviewCount = 0;

  for (let index = 0; index < 100; index += 1) {
    const lane = selectStudyLane({
      hasNewTopic: true,
      hasReviewTopic: true,
      random: () => index / 100,
    });

    if (lane === "new") {
      newCount += 1;
    } else if (lane === "review") {
      reviewCount += 1;
    }
  }

  assert.equal(newCount, 60);
  assert.equal(reviewCount, 40);
  assert.ok(newCount > reviewCount);
});

test("review lane에서 topic 선택 우선순위는 blocked > fuzzy > mastered_recovered > mastered_clean이다", () => {
  const now = new Date("2026-03-10T10:00:00+09:00");
  const topics = [
    { id: "blocked-topic", title: "Blocked", category: "os", promptSeed: "x", weight: 1 },
    { id: "fuzzy-topic", title: "Fuzzy", category: "os", promptSeed: "x", weight: 1 },
    { id: "recovered-topic", title: "Recovered", category: "os", promptSeed: "x", weight: 1 },
    { id: "clean-topic", title: "Clean", category: "os", promptSeed: "x", weight: 1 },
  ];

  const selected = pickReviewTopic({
    now,
    topics,
    memories: new Map([
      [
        "blocked-topic",
        {
          ...createEmptyTopicMemory(),
          timesAsked: 1,
          learningState: "blocked",
          nextReviewAt: now,
        },
      ],
      [
        "fuzzy-topic",
        {
          ...createEmptyTopicMemory(),
          timesAsked: 1,
          learningState: "fuzzy",
          nextReviewAt: now,
        },
      ],
      [
        "recovered-topic",
        {
          ...createEmptyTopicMemory(),
          timesAsked: 1,
          learningState: "mastered_recovered",
          nextReviewAt: now,
        },
      ],
      [
        "clean-topic",
        {
          ...createEmptyTopicMemory(),
          timesAsked: 1,
          learningState: "mastered_clean",
          nextReviewAt: now,
        },
      ],
    ]),
  });

  assert.equal(selected?.id, "blocked-topic");
});
