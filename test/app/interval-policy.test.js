import test from "node:test";
import assert from "node:assert/strict";

import { createDispatchDelayMs } from "../../src/app/interval-policy.js";

test("랜덤 발송 간격은 기본적으로 10분 이상 20분 이하이다", () => {
  assert.equal(createDispatchDelayMs(() => 0), 10 * 60 * 1000);
  assert.equal(createDispatchDelayMs(() => 1), 20 * 60 * 1000);
});

test("랜덤 값에 따라 발송 간격이 선형적으로 계산된다", () => {
  assert.equal(createDispatchDelayMs(() => 0.5), 15 * 60 * 1000);
});
