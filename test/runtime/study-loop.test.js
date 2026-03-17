import test from "node:test";
import assert from "node:assert/strict";

import { StudyLoop } from "../../src/runtime/study-loop.js";

test("study loop는 다음 질문을 하나만 예약하고 지연 후 dispatch를 호출한다", async () => {
  const timers = [];
  const calls = [];
  const loop = new StudyLoop({
    tutorBot: {
      async dispatchNextQuestion(now) {
        calls.push(now);
        return { slackThreadTs: "111.222" };
      },
    },
    createDelayMs: () => 90_000,
    setTimeoutFn(handler, delayMs) {
      const timer = { handler, delayMs, cancelled: false };
      timers.push(timer);
      return timer;
    },
    clearTimeoutFn(timer) {
      timer.cancelled = true;
    },
    now: () => new Date("2026-03-11T12:00:00+09:00"),
  });

  const delayMs = loop.scheduleNextQuestion();
  await timers[0].handler();

  assert.equal(delayMs, 90_000);
  assert.equal(timers.length, 2);
  assert.equal(timers[0].delayMs, 90_000);
  assert.equal(timers[1].delayMs, 90_000);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], new Date("2026-03-11T12:00:00+09:00"));
});

test("study loop는 재예약 시 기존 타이머를 취소하고 새 타이머 하나만 유지한다", () => {
  const timers = [];
  const loop = new StudyLoop({
    tutorBot: {
      async dispatchNextQuestion() {
        return null;
      },
    },
    createDelayMs: () => 60_000,
    setTimeoutFn(handler, delayMs) {
      const timer = { handler, delayMs, cancelled: false };
      timers.push(timer);
      return timer;
    },
    clearTimeoutFn(timer) {
      timer.cancelled = true;
    },
  });

  loop.scheduleNextQuestion();
  loop.scheduleNextQuestion();

  assert.equal(timers.length, 2);
  assert.equal(timers[0].cancelled, true);
  assert.equal(timers[1].cancelled, false);
});

test("study loop는 start나 stop 제어가 들어오면 대기 중 예약을 취소한다", () => {
  const timers = [];
  const loop = new StudyLoop({
    tutorBot: {
      async dispatchNextQuestion() {
        return null;
      },
    },
    createDelayMs: () => 60_000,
    setTimeoutFn(handler, delayMs) {
      const timer = { handler, delayMs, cancelled: false };
      timers.push(timer);
      return timer;
    },
    clearTimeoutFn(timer) {
      timer.cancelled = true;
    },
  });

  loop.scheduleNextQuestion();
  loop.handleControlCommand("stop");

  assert.equal(timers[0].cancelled, true);

  loop.scheduleNextQuestion();
  loop.handleControlCommand("start");

  assert.equal(timers[1].cancelled, true);
});

test("study loop는 dispatch가 재촉 전송 케이스를 반환해도 다음 루프를 깨지 않는다", async () => {
  const timers = [];
  const calls = [];
  const loop = new StudyLoop({
    tutorBot: {
      async dispatchNextQuestion(now) {
        calls.push(now);
        return {
          reminderSent: true,
          threadTs: "111.555",
        };
      },
    },
    createDelayMs: () => 45_000,
    setTimeoutFn(handler, delayMs) {
      const timer = { handler, delayMs, cancelled: false };
      timers.push(timer);
      return timer;
    },
    clearTimeoutFn(timer) {
      timer.cancelled = true;
    },
    now: () => new Date("2026-03-11T12:10:00+09:00"),
  });

  loop.scheduleNextQuestion();
  await timers[0].handler();

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], new Date("2026-03-11T12:10:00+09:00"));
  assert.equal(timers.length, 2);
});

test("study loop는 stop 제어가 들어오면 dispatch 이후 재예약을 중단한다", async () => {
  const timers = [];
  const loop = new StudyLoop({
    tutorBot: {
      async dispatchNextQuestion() {
        loop.handleControlCommand("stop");
        return null;
      },
    },
    createDelayMs: () => 45_000,
    setTimeoutFn(handler, delayMs) {
      const timer = { handler, delayMs, cancelled: false };
      timers.push(timer);
      return timer;
    },
    clearTimeoutFn(timer) {
      timer.cancelled = true;
    },
  });

  loop.scheduleNextQuestion();
  await timers[0].handler();

  assert.equal(timers.length, 1);
});
