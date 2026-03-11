import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildCodexExecArgs,
  parseCodexThreadIdFromStdout,
} from "../../src/llm/codex-cli-runner.js";
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

test("direct_question 지시는 반말 응답을 요구한다", () => {
  const source = readFileSync(new URL("../../src/llm/codex-cli-runner.js", import.meta.url), "utf8");

  assert.match(source, /direct_question[\s\S]*반말/u);
});

test("direct_thread_turn 지시는 direct Q&A history를 활용한다", () => {
  const source = readFileSync(new URL("../../src/llm/codex-cli-runner.js", import.meta.url), "utf8");

  assert.match(source, /direct_thread_turn[\s\S]*history/u);
});

test("direct Q&A 지시는 오프트픽 거절 대신 계속 답변하도록 유지한다", () => {
  const source = readFileSync(new URL("../../src/llm/codex-cli-runner.js", import.meta.url), "utf8");

  assert.doesNotMatch(source, /direct_question[\s\S]*항복 선언 \(!stop\)/u);
  assert.doesNotMatch(source, /direct_thread_turn[\s\S]*항복 선언 \(!stop\)/u);
});

test("evaluate task는 high reasoning으로 실행되고 direct question은 medium reasoning과 ephemeral을 쓴다", () => {
  const evaluateArgs = buildCodexExecArgs({
    taskType: "evaluate",
    outputPath: "/tmp/evaluate.json",
    prompt: "evaluate prompt",
    model: "gpt-5.4",
  });
  const directQuestionArgs = buildCodexExecArgs({
    taskType: "direct_question",
    outputPath: "/tmp/direct-question.json",
    prompt: "direct question prompt",
    model: "gpt-5.4",
  });

  assert.deepEqual(evaluateArgs.slice(0, 7), [
    "--model",
    "gpt-5.4",
    "exec",
    "--skip-git-repo-check",
    "--sandbox",
    "read-only",
    "--ephemeral",
  ]);
  assert.match(evaluateArgs.join(" "), /model_reasoning_effort="high"/u);
  assert.match(directQuestionArgs.join(" "), /model_reasoning_effort="medium"/u);
  assert.match(directQuestionArgs.join(" "), /--json/u);
  assert.doesNotMatch(directQuestionArgs.join(" "), /--ephemeral/u);
});

test("teach 지시는 막힌 지점을 직접 교정하도록 요구한다", () => {
  const source = readFileSync(new URL("../../src/llm/codex-cli-runner.js", import.meta.url), "utf8");

  assert.match(source, /teach[\s\S]*막힌/u);
  assert.match(source, /teach[\s\S]*정답 구조/u);
});

test("질문과 direct Q&A 지시는 도발적 라이벌 톤을 직접 요구한다", () => {
  const source = readFileSync(new URL("../../src/llm/codex-cli-runner.js", import.meta.url), "utf8");

  assert.match(source, /question[\s\S]*도발/u);
  assert.match(source, /direct_question[\s\S]*라이벌/u);
  assert.match(source, /direct_thread_turn[\s\S]*도발/u);
  assert.match(source, /teach[\s\S]*비웃/u);
});

test("direct Q&A 지시는 질문을 문자 그대로 해석하고 숨은 의도를 지어내지 말라고 강제한다", () => {
  const source = readFileSync(new URL("../../src/llm/codex-cli-runner.js", import.meta.url), "utf8");

  assert.match(source, /direct_question[\s\S]*literal/u);
  assert.match(source, /direct_question[\s\S]*Do not invent/u);
  assert.match(source, /direct_question[\s\S]*bot name/u);
  assert.match(source, /direct_thread_turn[\s\S]*literal/u);
  assert.match(source, /direct_thread_turn[\s\S]*Do not invent/u);
  assert.match(source, /direct_thread_turn[\s\S]*answer attempt/u);
  assert.match(source, /direct_thread_turn[\s\S]*pivot/u);
});

test("direct_thread_turn task는 답변 시도와 피벗을 모두 처리하도록 지시한다", () => {
  const source = readFileSync(new URL("../../src/llm/codex-cli-runner.js", import.meta.url), "utf8");

  assert.match(source, /direct_thread_turn[\s\S]*challenge/u);
  assert.match(source, /direct_thread_turn[\s\S]*pivot/u);
  assert.match(source, /direct_thread_turn[\s\S]*nextState/u);
});

test("direct_thread_turn task는 이해 확인용 재서술을 같은 맥락의 기술 턴으로 취급하라고 지시한다", () => {
  const source = readFileSync(new URL("../../src/llm/codex-cli-runner.js", import.meta.url), "utf8");

  assert.match(source, /direct_thread_turn[\s\S]*paraphrase/u);
  assert.match(source, /direct_thread_turn[\s\S]*confirm/u);
  assert.match(source, /direct_thread_turn[\s\S]*same-context/u);
});

test("direct_thread_turn task는 짧고 서툰 답변 시도도 오프트픽으로 자르지 말라고 지시한다", () => {
  const source = readFileSync(new URL("../../src/llm/codex-cli-runner.js", import.meta.url), "utf8");

  assert.match(source, /direct_thread_turn[\s\S]*short/u);
  assert.match(source, /direct_thread_turn[\s\S]*tentative/u);
  assert.match(source, /direct_thread_turn[\s\S]*wrong/u);
  assert.match(source, /direct_thread_turn[\s\S]*still answer attempts/u);
});

test("direct Q&A task는 codex session id가 있으면 resume 경로를 쓴다", () => {
  const args = buildCodexExecArgs({
    taskType: "direct_thread_turn",
    outputPath: "/tmp/direct-thread-turn.json",
    prompt: "resume prompt",
    model: "gpt-5.4",
    codexSessionId: "thread-123",
  });

  assert.deepEqual(args.slice(0, 5), [
    "--model",
    "gpt-5.4",
    "exec",
    "resume",
    "--skip-git-repo-check",
  ]);
  assert.match(args.join(" "), /thread-123/u);
  assert.doesNotMatch(args.join(" "), /--ephemeral/u);
});

test("codex json stdout에서 thread.started 이벤트의 id를 뽑아낸다", () => {
  const threadId = parseCodexThreadIdFromStdout([
    "{\"type\":\"turn.started\"}",
    "{\"type\":\"thread.started\",\"thread_id\":\"019cdb62-262f-7820-a256-93d1cb0fd0c2\"}",
    "{\"type\":\"turn.completed\"}",
  ].join("\n"));

  assert.equal(threadId, "019cdb62-262f-7820-a256-93d1cb0fd0c2");
});
