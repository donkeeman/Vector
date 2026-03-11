import test from "node:test";
import assert from "node:assert/strict";

import { VECTOR_SYSTEM_PROMPT } from "../../src/persona/vector-system-prompt.js";

test("Vector 프롬프트는 정답 시 열등감과 승부욕을 명시한다", () => {
  assert.match(VECTOR_SYSTEM_PROMPT, /wounded pride/i);
  assert.match(VECTOR_SYSTEM_PROMPT, /competitive/i);
  assert.match(VECTOR_SYSTEM_PROMPT, /must never sound emotionally flat when the user succeeds/i);
});

test("Vector 프롬프트는 한국어 답변을 반말로 고정한다", () => {
  assert.match(VECTOR_SYSTEM_PROMPT, /반말/u);
  assert.doesNotMatch(VECTOR_SYSTEM_PROMPT, /존댓말/u);
});

test("Vector 프롬프트는 도발적 시작과 단어 나열 비판을 직접 요구한다", () => {
  assert.match(VECTOR_SYSTEM_PROMPT, /이 정도는 당연히 알겠지/i);
  assert.match(VECTOR_SYSTEM_PROMPT, /단어 나열/u);
  assert.match(VECTOR_SYSTEM_PROMPT, /Do NOT give sincere praise/i);
});
