import test from "node:test";
import assert from "node:assert/strict";

import { runWithRetry } from "../../src/llm/run-with-retry.js";

test("LLM 호출은 JSON 파싱 실패 시 한 번 더 재시도한다", async () => {
  let attempts = 0;

  const result = await runWithRetry(
    async () => {
      attempts += 1;

      if (attempts === 1) {
        return "not-json";
      }

      return JSON.stringify({
        ok: true,
        message: "valid",
      });
    },
    {
      maxAttempts: 2,
      parser: (raw) => JSON.parse(raw),
    },
  );

  assert.deepEqual(result, {
    ok: true,
    message: "valid",
  });
  assert.equal(attempts, 2);
});

test("모든 재시도가 실패하면 마지막 에러를 던진다", async () => {
  await assert.rejects(
    () =>
      runWithRetry(
        async () => "not-json",
        {
          maxAttempts: 2,
          parser: (raw) => JSON.parse(raw),
        },
      ),
    /Unexpected token/,
  );
});
