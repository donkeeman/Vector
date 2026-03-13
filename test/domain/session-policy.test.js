import test from "node:test";
import assert from "node:assert/strict";

import {
  createInactiveSession,
  createStartedSession,
  deactivateSession,
  expireSessionIfNeeded,
  shouldDispatchAutoQuestion,
} from "../../src/domain/session-policy.js";
import {
  createThreadState,
  markThreadAsCounterQuestion,
  resolveCounterQuestion,
} from "../../src/domain/thread-policy.js";

test("세션이 시작되어야만 자동 질문이 발송된다", () => {
  const inactive = createInactiveSession();

  assert.equal("pausedAt" in inactive, false);
  assert.equal("endedAt" in inactive, false);
  assert.equal(shouldDispatchAutoQuestion(inactive, false), false);

  const started = createStartedSession(new Date("2026-03-10T09:05:00+09:00"));
  assert.equal("pausedAt" in started, false);
  assert.equal("endedAt" in started, false);
  assert.equal(shouldDispatchAutoQuestion(started, false), true);
});

test("비활성화된 세션은 발송을 멈추고 같은 날 다시 활성 세션으로 시작할 수 있다", () => {
  const started = createStartedSession(new Date("2026-03-10T09:05:00+09:00"));
  const inactive = deactivateSession(started);

  assert.equal(inactive.state, "inactive");
  assert.equal(shouldDispatchAutoQuestion(inactive, false), false);

  const restarted = createStartedSession(new Date("2026-03-10T10:00:00+09:00"));
  assert.equal(restarted.state, "active");
  assert.equal(shouldDispatchAutoQuestion(restarted, false), true);
});

test("당일 만료 이후에는 세션이 inactive로 정규화된다", () => {
  const started = createStartedSession(new Date("2026-03-10T09:05:00+09:00"));

  const fresh = createStartedSession(new Date("2026-03-10T09:05:00+09:00"));
  const expired = expireSessionIfNeeded(
    fresh,
    new Date("2026-03-11T00:00:00+09:00"),
  );

  assert.equal(expired.state, "inactive");
  assert.equal(shouldDispatchAutoQuestion(expired, false), false);
  assert.equal(shouldDispatchAutoQuestion(started, false), true);
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
