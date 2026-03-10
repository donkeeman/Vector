import test from "node:test";
import assert from "node:assert/strict";

import { normalizeControlCommand } from "../../src/app/control-command.js";

test("제어 명령 의미는 시작/중단/재개/끝으로 정규화된다", () => {
  assert.equal(normalizeControlCommand("/study-start"), "start");
  assert.equal(normalizeControlCommand("시작"), "start");
  assert.equal(normalizeControlCommand("/study-pause"), "pause");
  assert.equal(normalizeControlCommand("중단"), "pause");
  assert.equal(normalizeControlCommand("/study-resume"), "resume");
  assert.equal(normalizeControlCommand("재개"), "resume");
  assert.equal(normalizeControlCommand("/study-end"), "end");
  assert.equal(normalizeControlCommand("끝"), "end");
});

test("지원하지 않는 입력은 제어 명령으로 간주하지 않는다", () => {
  assert.equal(normalizeControlCommand("모르겠음"), null);
  assert.equal(normalizeControlCommand("/study-unknown"), null);
});
