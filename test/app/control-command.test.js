import test from "node:test";
import assert from "node:assert/strict";

import { normalizeControlCommand } from "../../src/app/control-command.js";

test("제어 명령 의미는 !start/!stop으로만 정규화된다", () => {
  assert.equal(normalizeControlCommand("!start"), "start");
  assert.equal(normalizeControlCommand("!stop"), "stop");
});

test("지원하지 않는 입력은 제어 명령으로 간주하지 않는다", () => {
  assert.equal(normalizeControlCommand("start"), null);
  assert.equal(normalizeControlCommand("stop"), null);
  assert.equal(normalizeControlCommand("/study-start"), null);
  assert.equal(normalizeControlCommand("/study-end"), null);
  assert.equal(normalizeControlCommand("resume"), null);
  assert.equal(normalizeControlCommand("end"), null);
  assert.equal(normalizeControlCommand("모르겠음"), null);
  assert.equal(normalizeControlCommand("/study-unknown"), null);
});
