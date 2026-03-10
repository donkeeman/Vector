import test from "node:test";
import assert from "node:assert/strict";

import {
  createStartedSession,
  expireSessionIfNeeded,
  pauseSession,
  resumeSession,
  endSession,
  shouldDispatchAutoQuestion,
} from "../../src/domain/session-policy.js";
import {
  createThreadState,
  markThreadAsCounterQuestion,
  resolveCounterQuestion,
} from "../../src/domain/thread-policy.js";

test("세션이 시작되어야만 자동 질문이 발송된다", () => {
  const inactive = {
    state: "inactive",
    startedAt: null,
    pausedAt: null,
    endedAt: null,
    expiresAt: null,
  };

  assert.equal(shouldDispatchAutoQuestion(inactive, false), false);

  const started = createStartedSession(new Date("2026-03-10T09:05:00+09:00"));
  assert.equal(shouldDispatchAutoQuestion(started, false), true);
});

test("pause와 resume은 발송 상태만 바꾸고 세션은 유지한다", () => {
  const started = createStartedSession(new Date("2026-03-10T09:05:00+09:00"));
  const paused = pauseSession(started, new Date("2026-03-10T10:00:00+09:00"));

  assert.equal(paused.state, "paused");
  assert.equal(shouldDispatchAutoQuestion(paused, false), false);

  const resumed = resumeSession(paused);
  assert.equal(resumed.state, "active");
  assert.equal(shouldDispatchAutoQuestion(resumed, false), true);
});

test("end 또는 당일 만료 이후에는 자동 질문이 멈춘다", () => {
  const started = createStartedSession(new Date("2026-03-10T09:05:00+09:00"));
  const ended = endSession(started, new Date("2026-03-10T18:30:00+09:00"));

  assert.equal(ended.state, "ended");
  assert.equal(shouldDispatchAutoQuestion(ended, false), false);

  const fresh = createStartedSession(new Date("2026-03-10T09:05:00+09:00"));
  const expired = expireSessionIfNeeded(
    fresh,
    new Date("2026-03-11T00:00:00+09:00"),
  );

  assert.equal(expired.state, "ended");
  assert.equal(shouldDispatchAutoQuestion(expired, false), false);
});

test("역질문 모드가 열려 있으면 전역 자동 질문이 멈춘다", () => {
  const session = createStartedSession(new Date("2026-03-10T09:05:00+09:00"));
  const thread = markThreadAsCounterQuestion(
    createThreadState({
      slackThreadTs: "123.456",
      topicId: "http-cache",
      openedAt: new Date("2026-03-10T09:10:00+09:00"),
    }),
  );

  assert.equal(
    shouldDispatchAutoQuestion(session, thread.mode === "counterquestion"),
    false,
  );

  const resolved = resolveCounterQuestion(thread, new Date("2026-03-10T09:30:00+09:00"));
  assert.equal(resolved.mode, "evaluation");
  assert.equal(
    shouldDispatchAutoQuestion(session, resolved.mode === "counterquestion"),
    true,
  );
});
