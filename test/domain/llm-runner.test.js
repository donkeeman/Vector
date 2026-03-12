import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildCodexExecArgs,
  keepSingleQuestion,
  normalizeBanmalText,
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

  assert.match(source, /direct_question[\s\S]*informal speech \(banmal\)/u);
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

test("evaluate와 direct question은 session-aware json 경로로 실행되고 reasoning profile을 유지한다", () => {
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
    "--json",
    "-c",
    "model_reasoning_effort=\"high\"",
  ]);
  assert.match(evaluateArgs.join(" "), /model_reasoning_effort="high"/u);
  assert.match(directQuestionArgs.join(" "), /model_reasoning_effort="medium"/u);
  assert.match(evaluateArgs.join(" "), /--json/u);
  assert.doesNotMatch(evaluateArgs.join(" "), /--ephemeral/u);
  assert.match(directQuestionArgs.join(" "), /--json/u);
  assert.doesNotMatch(directQuestionArgs.join(" "), /--ephemeral/u);
});

test("teach 지시는 막힌 지점을 직접 교정하도록 요구한다", () => {
  const source = readFileSync(new URL("../../src/llm/codex-cli-runner.js", import.meta.url), "utf8");

  assert.match(source, /teach[\s\S]*exact failure point/u);
  assert.match(source, /teach[\s\S]*answer scaffold/u);
  assert.match(source, /teach[\s\S]*thread\.lastAssistantPrompt/u);
});

test("study 평가/꼬리질문/교정 지시는 lastChallengePrompt를 기준으로 같은 지점을 추적한다", () => {
  const source = readFileSync(new URL("../../src/llm/codex-cli-runner.js", import.meta.url), "utf8");

  assert.match(source, /evaluate[\s\S]*lastChallengePrompt/u);
  assert.match(source, /followup[\s\S]*lastChallengePrompt/u);
  assert.match(source, /teach[\s\S]*lastChallengePrompt/u);
  assert.match(source, /teach[\s\S]*challengePrompt/u);
});

test("질문과 direct Q&A 지시는 도발적 라이벌 톤을 직접 요구한다", () => {
  const source = readFileSync(new URL("../../src/llm/codex-cli-runner.js", import.meta.url), "utf8");

  assert.match(source, /question[\s\S]*provocative/u);
  assert.match(source, /direct_question[\s\S]*rival/u);
  assert.match(source, /direct_thread_turn[\s\S]*provocative/u);
  assert.match(source, /teach[\s\S]*mocking/u);
});

test("counterquestion 지시는 모호한 지시어를 lastAssistantPrompt로 해석하도록 강제한다", () => {
  const source = readFileSync(new URL("../../src/llm/codex-cli-runner.js", import.meta.url), "utf8");

  assert.match(source, /answer_counterquestion[\s\S]*ambiguous references/u);
  assert.match(source, /answer_counterquestion[\s\S]*thread\.lastAssistantPrompt/u);
  assert.match(source, /answer_counterquestion[\s\S]*Do not bounce back/u);
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

test("질문 후처리는 그리고로 이어진 다중 질문을 첫 질문 하나로 자른다", () => {
  const normalized = keepSingleQuestion(
    "setTimeout(0), Promise.then, requestAnimationFrame이 한 프레임 안에서 충돌할 때 실행 순서를 설명해봐, 그리고 마이크로태스크 폭주가 왜 페인트를 굶기는지도 설명해봐.",
  );

  assert.equal(
    normalized,
    "setTimeout(0), Promise.then, requestAnimationFrame이 한 프레임 안에서 충돌할 때 실행 순서를 설명해봐",
  );
});

test("질문 후처리는 물음표가 여러 개면 첫 질문만 남긴다", () => {
  const normalized = keepSingleQuestion(
    "r1이 먼저야? p가 먼저야? 이유까지 말해봐.",
  );

  assert.equal(normalized, "r1이 먼저야?");
});

test("질문 후처리는 앞쪽 도발 질문을 버리고 기술 질문 하나만 남긴다", () => {
  const normalized = keepSingleQuestion(
    "자, 이 정도는 안 틀리겠지? setTimeout(0), Promise.then, requestAnimationFrame 순서를 단계별로 설명해봐?",
  );

  assert.equal(
    normalized,
    "setTimeout(0), Promise.then, requestAnimationFrame 순서를 단계별로 설명해봐?",
  );
});

test("반말 후처리는 기본 존댓말 어미를 반말로 정규화한다", () => {
  const normalized = normalizeBanmalText(
    "그건 기본입니다. 다시 설명해주세요. 이 경우는 가능합니다.",
  );

  assert.equal(
    normalized,
    "그건 기본이야. 다시 설명해줘. 이 경우는 가능해.",
  );
});
