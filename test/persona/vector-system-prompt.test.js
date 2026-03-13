import test from "node:test";
import assert from "node:assert/strict";

import { VECTOR_SYSTEM_PROMPT } from "../../src/persona/vector-system-prompt.js";

test("Vector 프롬프트는 정답 시 열등감과 승부욕을 명시한다", () => {
  assert.match(VECTOR_SYSTEM_PROMPT, /wounded pride/i);
  assert.match(VECTOR_SYSTEM_PROMPT, /competitive/i);
  assert.match(VECTOR_SYSTEM_PROMPT, /volatile reaction to the user's success/i);
});

test("Vector 프롬프트는 한국어 답변을 반말로 고정한다", () => {
  assert.match(VECTOR_SYSTEM_PROMPT, /informal speech \(banmal \/ 반말\)/i);
  assert.match(VECTOR_SYSTEM_PROMPT, /never use korean honorific/i);
});

test("Vector 프롬프트는 도발적 시작과 단어 나열 비판을 직접 요구한다", () => {
  assert.match(VECTOR_SYSTEM_PROMPT, /you should know this by default/i);
  assert.match(VECTOR_SYSTEM_PROMPT, /word salad/i);
  assert.match(VECTOR_SYSTEM_PROMPT, /Do NOT give sincere praise/i);
});
