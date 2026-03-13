import test from "node:test";
import assert from "node:assert/strict";

import {
  buildClaudeExecArgs,
  parseClaudeResultEnvelope,
} from "../../src/llm/claude-cli-runner.js";

test("claude exec args는 print/json 출력 기반으로 구성된다", () => {
  const args = buildClaudeExecArgs({
    taskType: "evaluate",
    model: "claude-sonnet-4-6",
  });

  assert.deepEqual(args.slice(0, 11), [
    "--model",
    "claude-sonnet-4-6",
    "-p",
    "--output-format",
    "json",
    "--input-format",
    "text",
    "--tools",
    "",
    "--permission-mode",
    "bypassPermissions",
  ]);
  assert.doesNotMatch(args.join(" "), /--effort/u);
});

test("session-aware task는 claude session id가 있으면 --resume을 붙인다", () => {
  const args = buildClaudeExecArgs({
    taskType: "direct_thread_turn",
    prompt: "thread turn prompt",
    claudeSessionId: "session-123",
  });

  assert.match(args.join(" "), /--resume session-123/u);
});

test("session-aware가 아닌 task(topic)는 --resume을 붙이지 않는다", () => {
  const args = buildClaudeExecArgs({
    taskType: "topic",
    prompt: "topic prompt",
    claudeSessionId: "session-123",
  });

  assert.doesNotMatch(args.join(" "), /--resume/u);
});

test("claude json envelope에서 result와 session_id를 파싱한다", () => {
  const envelope = parseClaudeResultEnvelope(
    JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      result: "{\"text\":\"테스트\"}",
      session_id: "abc-123",
    }),
  );

  assert.equal(envelope?.isError, false);
  assert.equal(envelope?.sessionId, "abc-123");
  assert.equal(envelope?.resultText, "{\"text\":\"테스트\"}");
});

test("claude envelope 파서는 마지막 result json 라인을 우선 사용한다", () => {
  const envelope = parseClaudeResultEnvelope([
    "not-json",
    JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      result: "{\"text\":\"최종\"}",
      session_id: "xyz-987",
    }),
  ].join("\n"));

  assert.equal(envelope?.sessionId, "xyz-987");
  assert.equal(envelope?.resultText, "{\"text\":\"최종\"}");
});
