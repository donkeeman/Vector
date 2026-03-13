import test from "node:test";
import assert from "node:assert/strict";

import { createDebugLogger, previewText } from "../../src/debug/debug-logger.js";

test("debug logger는 enabled일 때만 JSON 로그를 남긴다", () => {
  const messages = [];
  const errors = [];
  const logger = createDebugLogger({
    enabled: true,
    now: () => new Date("2026-03-10T18:30:00+09:00"),
    infoSink: (message) => messages.push(message),
    errorSink: (message) => errors.push(message),
  });

  logger.debug("router.route.direct_question", {
    channel: "D123",
    textPreview: "rag가 뭐야?",
  });
  logger.error("llm.task.error", {
    taskType: "direct_question",
    message: "spawn codex ENOENT",
  });

  assert.deepEqual(messages, [
    '{"scope":"vector","ts":"2026-03-10T09:30:00.000Z","level":"debug","event":"router.route.direct_question","channel":"D123","textPreview":"rag가 뭐야?"}',
  ]);
  assert.deepEqual(errors, [
    '{"scope":"vector","ts":"2026-03-10T09:30:00.000Z","level":"error","event":"llm.task.error","taskType":"direct_question","message":"spawn codex ENOENT"}',
  ]);
});

test("debug logger는 disabled면 로그를 남기지 않는다", () => {
  const messages = [];
  const logger = createDebugLogger({
    enabled: false,
    infoSink: (message) => messages.push(message),
  });

  logger.debug("router.route.direct_question", {
    channel: "D123",
  });

  assert.deepEqual(messages, []);
});

test("previewText는 공백을 정리하고 길이를 제한한다", () => {
  assert.equal(previewText("  rag가   뭐야?  "), "rag가 뭐야?");
  assert.equal(previewText("a".repeat(90), 10), "aaaaaaaaaa...");
});
