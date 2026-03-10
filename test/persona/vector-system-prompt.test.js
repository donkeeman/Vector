import test from "node:test";
import assert from "node:assert/strict";

import { VECTOR_SYSTEM_PROMPT } from "../../src/persona/vector-system-prompt.js";

test("Vector 프롬프트는 정답 시 열등감과 승부욕을 명시한다", () => {
  assert.match(VECTOR_SYSTEM_PROMPT, /wounded pride/i);
  assert.match(VECTOR_SYSTEM_PROMPT, /competitive/i);
  assert.match(VECTOR_SYSTEM_PROMPT, /must never sound emotionally flat when the user succeeds/i);
});
