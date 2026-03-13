import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyReviewPriority,
  classifyTopicLane,
  createEmptyTopicMemory,
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
});

test("outcome 전이에 따라 learningState가 계산된다", () => {
  const now = new Date("2026-03-10T10:00:00+09:00");
  const empty = createEmptyTopicMemory();

  const firstSuccess = updateTopicMemory(empty, "mastered", now);
  assert.equal(firstSuccess.learningState, "mastered_clean");
  assert.equal(firstSuccess.timesMasteredClean, 1);

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
