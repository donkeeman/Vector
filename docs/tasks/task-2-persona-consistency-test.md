# Task 2: Persona Consistency Test Suite

## Goal

Vector의 페르소나(천재 라이벌, 한국어 반말체) 일관성을 자동 검증하는 테스트 스위트를 구축한다. `normalizeBanmalText`의 ~35개 정규식 패턴을 각각 단위 테스트하고, 고정 샘플 응답으로 페르소나 규칙 준수를 검증한다.

## Project Context

- Runtime: Node.js ESM (package.json `"type": "module"`)
- Test runner: `node --test` (Node.js built-in)
- Convention: code=English, comments=Korean, commit=Korean 반말체 + Conventional Commits

## Current State

### normalizeBanmalText (src/llm/codex-cli-runner.js:475-529)

~35개 정규식 치환으로 존댓말→반말 변환. 이미 export되어 있음:
```js
export { normalizeBanmalText };  // line 578
```

치환 목록 (전체):
```
해보시겠어요 → 해볼래     해보시겠어 → 해볼래
해주시겠어요 → 해줄래     해주시겠어 → 해줄래
시겠어요 → 겠어           시겠어 → 겠어
시겠습니다 → 겠어         이죠 → 이지
죠 → 지                   뭐예요 → 뭐야
뭐예 → 뭐야               이에요 → 이야
예요 → 야                  입니다 → 이야
있습니다 → 있어            없습니다 → 없어
알겠습니다 → 알겠어        겠습니다 → 겠어
겠어요 → 겠어              됩니다 → 돼
가능합니다 → 가능해        합니다 → 해
해주세요 → 해줘            해보세요 → 해봐
하세요 → 해                십시오 → 해
인가요 → 인가              나요 → 나
까요 → 까                  해요 → 해
돼요 → 돼                  있어요 → 있어
없어요 → 없어              맞아요 → 맞아
아니에요 → 아니야          그래요 → 그래
(마지막) 요$ → "" (끝나는 요 제거)
```

경계 조건에 `endingBoundary`와 `questionBoundary` 패턴 사용:
```js
const endingBoundary = String.raw`(?=\s*(?:["'"')\]]*[.!?,…~]|$))`;
const questionBoundary = String.raw`(?=\s*(?:["'"')\]]*[?!]|$))`;
```

### BANMAL_TASK_TYPES (codex-cli-runner.js:532-540)
normalizeBanmalText가 적용되는 태스크:
```js
question, followup, teach, answer_counterquestion,
direct_question, direct_thread_turn, evaluate
```

### 기존 테스트
- `test/persona/vector-system-prompt.test.js` 존재 (시스템 프롬프트 관련)
- normalizeBanmalText 전용 테스트는 아직 없음

## Sub-Tasks (TDD)

### Sub-Task 1: 페르소나 규칙 모듈 생성

**생성 파일:** `src/persona/persona-rules.js`

```js
// 페르소나 위반 검사를 위한 규칙 정의

// 금지 패턴: 존댓말/격식체 어미
export const HONORIFIC_PATTERNS = [
  { pattern: /습니다/u, name: "습니다 ending" },
  { pattern: /입니다/u, name: "입니다 ending" },
  { pattern: /세요/u, name: "세요 ending" },
  { pattern: /십시오/u, name: "십시오 ending" },
  { pattern: /예요(?=\s*[.!?,…~]|$)/u, name: "예요 ending" },
  { pattern: /이에요(?=\s*[.!?,…~]|$)/u, name: "이에요 ending" },
  { pattern: /겠어요(?=\s*[.!?,…~]|$)/u, name: "겠어요 ending" },
  { pattern: /해요(?=\s*[.!?,…~]|$)/u, name: "해요 ending" },
  { pattern: /돼요(?=\s*[.!?,…~]|$)/u, name: "돼요 ending" },
  { pattern: /있어요(?=\s*[.!?,…~]|$)/u, name: "있어요 ending" },
  { pattern: /없어요(?=\s*[.!?,…~]|$)/u, name: "없어요 ending" },
  { pattern: /까요(?=\s*[?!]|$)/u, name: "까요 ending" },
  { pattern: /나요(?=\s*[?!]|$)/u, name: "나요 ending" },
  { pattern: /드리/u, name: "드리 (deferential)" },
];

// 금지 패턴: 지나치게 공손한 표현
export const OVERLY_POLITE_PATTERNS = [
  { pattern: /감사합니다/u, name: "감사합니다" },
  { pattern: /감사해요/u, name: "감사해요" },
  { pattern: /부탁드/u, name: "부탁드리다" },
  { pattern: /죄송/u, name: "죄송" },
  { pattern: /실례/u, name: "실례" },
];

// 페르소나 위반 여부 검사
export function checkPersonaViolations(text) {
  const violations = [];
  for (const rule of [...HONORIFIC_PATTERNS, ...OVERLY_POLITE_PATTERNS]) {
    if (rule.pattern.test(text)) {
      violations.push(rule.name);
    }
  }
  return violations;
}

// 빈 응답 검사
export function isEmptyResponse(text) {
  return !text || !String(text).trim();
}
```

**커밋:** `feat: 페르소나 규칙 모듈 생성`

---

### Sub-Task 2: normalizeBanmalText 단위 테스트

**생성 파일:** `test/llm/normalize-banmal.test.js`

모든 ~35개 패턴에 대해 입출력 검증. 아래는 테스트 구조:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeBanmalText } from "../../src/llm/codex-cli-runner.js";

// 각 치환 패턴 검증
test("해보시겠어요 → 해볼래", () => {
  assert.equal(normalizeBanmalText("한번 해보시겠어요?"), "한번 해볼래?");
});

test("해보시겠어 → 해볼래", () => {
  assert.equal(normalizeBanmalText("한번 해보시겠어?"), "한번 해볼래?");
});

// ... (35개 패턴 각각)

// Edge cases
test("이미 반말인 텍스트는 변환 후에도 동일하다", () => {
  const banmal = "이건 네가 직접 해봐야 알아.";
  assert.equal(normalizeBanmalText(banmal), banmal);
});

test("빈 문자열은 그대로 반환한다", () => {
  assert.equal(normalizeBanmalText(""), "");
});

test("기술 용어 속 '요' 문자는 제거하지 않는다", () => {
  // "요소", "요청" 등 단어 내 '요'는 건드리지 않아야 함
  // 단, 현재 구현은 줄 끝 '요'만 제거하므로 중간 '요'는 안전
  const text = "이 요소가 중요해";
  assert.equal(normalizeBanmalText(text), "이 요소가 중요해");
});

test("복합 존댓말 문장이 모두 반말로 변환된다", () => {
  const input = "이건 가능합니다. 해보시겠어요?";
  const expected = "이건 가능해. 해볼래?";
  assert.equal(normalizeBanmalText(input), expected);
});

test("문장 중간 패턴도 경계 조건에 맞게 변환된다", () => {
  const input = "그건 됩니다. 근데 이건 안 됩니다.";
  const expected = "그건 돼. 근데 이건 안 돼.";
  assert.equal(normalizeBanmalText(input), expected);
});
```

전체 35개 패턴 + edge case 5~10개 = 약 40~45개 테스트 케이스.

**커밋:** `test: normalizeBanmalText 단위 테스트 추가`

---

### Sub-Task 3: 페르소나 일관성 검증 테스트

**생성 파일:** `test/persona/persona-consistency.test.js`

고정 샘플 응답으로 `normalizeBanmalText` 통과 후에도 페르소나 규칙을 준수하는지 검증.

```js
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeBanmalText } from "../../src/llm/codex-cli-runner.js";
import { checkPersonaViolations, isEmptyResponse } from "../../src/persona/persona-rules.js";

// 올바른 반말 응답 (10개) — normalizeBanmalText 통과 후 위반 없어야 함
const VALID_BANMAL_SAMPLES = [
  "이벤트 루프가 뭔지도 모르면서 비동기 얘기하냐? 콜 스택부터 설명해봐.",
  "그건 틀렸어. V8 엔진이 싱글 스레드라는 건 메인 스레드 얘기야. libuv 스레드풀은 별개지.",
  "흥, 그 정도는 맞았네. 근데 마이크로태스크 큐랑 매크로태스크 큐 차이는 알아?",
  "TCP 3-way handshake 순서도 모르면서 네트워크 안다고? SYN, SYN-ACK, ACK 순서야.",
  "인덱스가 뭔지 대충은 아는구나. 그럼 B+Tree 인덱스가 해시 인덱스보다 범위 검색에 유리한 이유는?",
  "페이지 교체 알고리즘 중 LRU가 왜 실제로는 근사치만 쓰는지 설명해봐.",
  "가비지 컬렉션의 Mark-and-Sweep이 뭔지는 아는 거지? 그럼 세대별 GC는?",
  "그건 맞아. 프로세스는 독립 메모리 공간, 스레드는 힙을 공유하지.",
  "데드락 4가지 조건 중 하나만 말해봐. 상호 배제 말고 다른 거.",
  "REST API에서 PUT이랑 PATCH 차이도 구분 못 하면 API 설계는 멀었어.",
];

// 존댓말/위반 응답 (10개) — normalizeBanmalText 적용 전 원본
const INVALID_SAMPLES_RAW = [
  "이벤트 루프에 대해 설명해 드리겠습니다.",
  "TCP 3-way handshake는 다음과 같습니다.",
  "좋은 질문이세요. 인덱스는 데이터 검색 속도를 높여주는 자료구조예요.",
  "감사합니다. 그 부분을 잘 이해하고 계시네요.",
  "죄송합니다만, 그 설명은 정확하지 않습니다.",
  "부탁드리는 건데, 한번 더 생각해보시겠어요?",
  "프로세스와 스레드의 차이를 말씀드리겠습니다.",
  "이 개념은 중요합니다. 잘 기억해두세요.",
  "데드락에 대해서 설명해드릴게요.",
  "REST API의 PUT과 PATCH는 다음과 같은 차이가 있습니다.",
];

test("올바른 반말 응답은 페르소나 위반이 없다", () => {
  for (const sample of VALID_BANMAL_SAMPLES) {
    const violations = checkPersonaViolations(sample);
    assert.deepEqual(violations, [], `위반 발견: "${sample}" → ${violations.join(", ")}`);
  }
});

test("존댓말 원본은 normalizeBanmalText 통과 후 페르소나 위반이 해소된다", () => {
  for (const raw of INVALID_SAMPLES_RAW) {
    const normalized = normalizeBanmalText(raw);
    const violations = checkPersonaViolations(normalized);
    // 일부는 normalizeBanmalText가 커버하지 못할 수 있음 (예: 드리-)
    // 이 테스트는 커버리지 측정용 — 실패 시 normalizeBanmalText 패턴 추가 필요
    if (violations.length > 0) {
      // 실패 케이스 기록 (경고 수준)
      console.log(`[persona-warn] "${raw}" → "${normalized}" still has: ${violations.join(", ")}`);
    }
  }
  // 최소 80% 이상은 해소되어야 함
  const resolvedCount = INVALID_SAMPLES_RAW.filter((raw) => {
    const normalized = normalizeBanmalText(raw);
    return checkPersonaViolations(normalized).length === 0;
  }).length;
  assert.ok(resolvedCount >= 8, `resolved ${resolvedCount}/10, need at least 8`);
});

test("빈 응답은 감지된다", () => {
  assert.ok(isEmptyResponse(""));
  assert.ok(isEmptyResponse(null));
  assert.ok(isEmptyResponse("   "));
  assert.ok(!isEmptyResponse("뭔가 있어"));
});
```

**커밋:** `test: 페르소나 일관성 검증 테스트 추가`

---

### Sub-Task 4: 회귀 검증

```bash
npm test
```

전체 통과 확인.

**커밋:** `test: 페르소나 테스트 전체 회귀 검증`

---

## Key Files Reference

| File | Role |
|------|------|
| `src/llm/codex-cli-runner.js:475-529` | `normalizeBanmalText` 함수 |
| `src/llm/codex-cli-runner.js:532-540` | `BANMAL_TASK_TYPES` 세트 |
| `src/llm/codex-cli-runner.js:313-331` | `normalizeReplyStyle` (banmal 적용 지점) |
| `src/llm/codex-cli-runner.js:205-224` | `TASK_INSTRUCTIONS` (페르소나 톤 지시) |
| `src/persona/vector-system-prompt.js` | 시스템 프롬프트 |
| `test/persona/vector-system-prompt.test.js` | 기존 프롬프트 테스트 |

## Notes

- `normalizeBanmalText`는 현재 `codex-cli-runner.js`에서 export됨. 별도 모듈로 분리하면 더 깔끔하지만, 기존 import 경로를 깨뜨리지 않도록 주의. 분리한다면 원래 파일에서 re-export 유지.
- `checkPersonaViolations`의 패턴 목록은 `normalizeBanmalText`의 패턴과 겹치지만 역할이 다름: normalize는 "변환", checkViolation은 "검증".
- 실제 LLM 호출 없이 고정 fixture로만 테스트. LLM 출력 품질은 이 테스트 범위 밖.
