import test from "node:test";
import assert from "node:assert/strict";

import { SessionLifecycleManager } from "../../../src/runtime/macos/session-lifecycle-manager.js";

test("lifecycle manager는 launch와 wake/unlock 이벤트를 start로, sleep/lock 이벤트를 stop으로 매핑한다", async () => {
  const calls = [];
  const hooks = [];
  const manager = new SessionLifecycleManager({
    tutorBot: {
      async applyControlCommand(command, now) {
        calls.push({ command, now });
        return { state: command === "start" ? "active" : "inactive" };
      },
    },
    now: () => new Date("2026-03-11T18:00:00+09:00"),
    onControlCommandApplied(command, session) {
      hooks.push({ command, session });
    },
  });

  await manager.handleAppLaunch();
  await manager.handleEvent("system_did_wake");
  await manager.handleEvent("screen_unlocked");
  await manager.handleEvent("system_will_sleep");
  await manager.handleEvent("screen_locked");

  assert.deepEqual(calls.map(({ command }) => command), [
    "start",
    "start",
    "start",
    "stop",
    "stop",
  ]);
  assert.deepEqual(hooks.map(({ command }) => command), [
    "start",
    "start",
    "start",
    "stop",
    "stop",
  ]);
});

test("lifecycle manager는 알 수 없는 이벤트를 무시한다", async () => {
  const calls = [];
  const manager = new SessionLifecycleManager({
    tutorBot: {
      async applyControlCommand(command) {
        calls.push(command);
        return null;
      },
    },
  });

  await manager.handleEvent("monitor_started");

  assert.deepEqual(calls, []);
});
