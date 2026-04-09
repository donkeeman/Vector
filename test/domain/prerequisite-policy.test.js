import test from "node:test";
import assert from "node:assert/strict";

import {
  applyPrerequisitePriority,
  filterPrerequisiteTopics,
  isPrerequisiteSatisfied,
} from "../../src/domain/prerequisite-policy.js";
import { createEmptyTopicMemory } from "../../src/domain/topic-memory.js";

test("미충족 prerequisite가 있으면 prerequisite 토픽만 우선 대상으로 남긴다", () => {
  const topics = [
    { id: "prereq-a", title: "Prereq A" },
    { id: "deferred-x", title: "Deferred X" },
    { id: "normal-y", title: "Normal Y" },
  ];
  const memories = new Map([
    [
      "prereq-a",
      {
        ...createEmptyTopicMemory(),
        learningState: "new",
        prerequisiteFor: "deferred-x",
      },
    ],
    [
      "deferred-x",
      {
        ...createEmptyTopicMemory(),
        learningState: "deferred",
      },
    ],
  ]);

  const prioritized = applyPrerequisitePriority(topics, memories);

  assert.deepEqual(prioritized.map((topic) => topic.id), ["prereq-a", "normal-y"]);
});

test("prerequisite 토픽은 mastered 상태가 아니면 필터링된다", () => {
  const topics = [
    { id: "prereq-a", title: "Prereq A" },
    { id: "prereq-b", title: "Prereq B" },
  ];
  const memories = new Map([
    [
      "prereq-a",
      {
        ...createEmptyTopicMemory(),
        learningState: "mastered_clean",
        prerequisiteFor: "deferred-x",
      },
    ],
    [
      "prereq-b",
      {
        ...createEmptyTopicMemory(),
        learningState: "blocked",
        prerequisiteFor: "deferred-x",
      },
    ],
  ]);

  const filtered = filterPrerequisiteTopics(topics, memories);

  assert.deepEqual(filtered.map((topic) => topic.id), ["prereq-b"]);
});

test("deferred 토픽은 모든 prerequisite가 mastered 상태일 때만 충족된다", () => {
  const memories = new Map([
    [
      "prereq-a",
      {
        ...createEmptyTopicMemory(),
        learningState: "mastered_clean",
        prerequisiteFor: "deferred-x",
      },
    ],
    [
      "prereq-b",
      {
        ...createEmptyTopicMemory(),
        learningState: "mastered_recovered",
        prerequisiteFor: "deferred-x",
      },
    ],
    [
      "deferred-x",
      {
        ...createEmptyTopicMemory(),
        learningState: "deferred",
      },
    ],
  ]);

  assert.equal(isPrerequisiteSatisfied("deferred-x", memories), true);

  memories.set("prereq-b", {
    ...createEmptyTopicMemory(),
    learningState: "blocked",
    prerequisiteFor: "deferred-x",
  });

  assert.equal(isPrerequisiteSatisfied("deferred-x", memories), false);
});
