import test from "node:test";
import assert from "node:assert/strict";

import {
  applyDirectQaOperation,
  createDirectQaStackState,
} from "../../src/domain/direct-qa-stack-policy.js";

test("direct qa stack 기본 상태는 비어 있고 sealed=false이며 maxDepth=5다", () => {
  const state = createDirectQaStackState();

  assert.deepEqual(state, {
    frames: [],
    sealed: false,
    maxDepth: 5,
  });
});

test("depth 5 도달 시 sealed=true가 되고 이후 push는 차단된다", () => {
  const state = {
    frames: [
      { id: "f1", prompt: "Q1", weakPassUsed: false },
      { id: "f2", prompt: "Q2", weakPassUsed: false },
      { id: "f3", prompt: "Q3", weakPassUsed: false },
      { id: "f4", prompt: "Q4", weakPassUsed: false },
    ],
    sealed: false,
    maxDepth: 5,
  };

  const reached = applyDirectQaOperation(state, {
    operation: "push",
    nextPrompt: "Q5",
    now: new Date("2026-03-17T12:00:00+09:00"),
  });
  assert.equal(reached.stack.frames.length, 5);
  assert.equal(reached.stack.sealed, true);
  assert.equal(reached.appliedOperation, "push");

  const blocked = applyDirectQaOperation(reached.stack, {
    operation: "push",
    nextPrompt: "Q6",
    now: new Date("2026-03-17T12:00:01+09:00"),
  });
  assert.equal(blocked.stack.frames.length, 5);
  assert.equal(blocked.stack.sealed, true);
  assert.equal(blocked.appliedOperation, "stay");
});

test("pop 연쇄로 빈 스택이 되면 shouldClose=true다", () => {
  const state = {
    frames: [
      { id: "root", prompt: "Q1", weakPassUsed: false },
    ],
    sealed: false,
    maxDepth: 5,
  };

  const popped = applyDirectQaOperation(state, {
    operation: "pop",
    passQuality: "strong",
  });

  assert.equal(popped.stack.frames.length, 0);
  assert.equal(popped.shouldClose, true);
  assert.equal(popped.appliedOperation, "pop");
});

test("프레임이 1개일 때 weak pop은 1회 stay로 강등되고 weakPassUsed=true가 된다", () => {
  const state = {
    frames: [
      { id: "root", prompt: "원 질문", weakPassUsed: false },
    ],
    sealed: false,
    maxDepth: 5,
  };

  const weak = applyDirectQaOperation(state, {
    operation: "pop",
    passQuality: "weak",
    nextPrompt: "검증 질문",
  });

  assert.equal(weak.shouldClose, false);
  assert.equal(weak.appliedOperation, "stay");
  assert.equal(weak.stack.frames.length, 1);
  assert.equal(weak.stack.frames[0].weakPassUsed, true);
  assert.equal(weak.stack.frames[0].prompt, "검증 질문");

  const second = applyDirectQaOperation(weak.stack, {
    operation: "pop",
    passQuality: "strong",
  });
  assert.equal(second.shouldClose, true);
  assert.equal(second.stack.frames.length, 0);
});

