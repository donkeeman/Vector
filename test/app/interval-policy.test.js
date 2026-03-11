import test from "node:test";
import assert from "node:assert/strict";

import { createDispatchDelayMs } from "../../src/app/interval-policy.js";

test("랜덤 발송 간격은 기본적으로 1분 이상 3분 이하이다", () => {
  assert.equal(createDispatchDelayMs(() => 0), 1 * 60 * 1000);
  assert.equal(createDispatchDelayMs(() => 1), 3 * 60 * 1000);
});

test("랜덤 값에 따라 발송 간격이 선형적으로 계산된다", () => {
  assert.equal(createDispatchDelayMs(() => 0.5), 2 * 60 * 1000);
});
