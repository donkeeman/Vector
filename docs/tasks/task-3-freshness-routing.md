# Task 3: Freshness Routing (최신성 질문 분류 및 보수 응답)

## Goal

사용자가 최신 정보에 의존하는 질문(프레임워크 버전, API 변경 등)을 했을 때, 근거 없는 단정 대신 보수적 응답을 하도록 규칙 기반 분류기를 도입한다. RAG 없이 독립 동작.

## Project Context

- Runtime: Node.js ESM (package.json `"type": "module"`)
- Test runner: `node --test` (Node.js built-in)
- Convention: code=English, comments=Korean, commit=Korean 반말체 + Conventional Commits
- 의존성 추가 금지

## Architecture — 현재 질문 처리 흐름

### Direct Question (slack-message-router.js:132-148)
```js
await this.#startDirectQaThread({
  threadTs,
  text: event.text,
  openedAt,
  replyFactory: async () => this.llmRunner.runTask("direct_question", {
    text: event.text,        // ← 여기에 freshnessType 추가
  }),
});
```

### Teach (tutor-thread-handler.js:243-255)
```js
const teaching = await llmRunner.runTask("teach", {
  thread: sessionBoundThread,
  text,
  evaluation: normalizedEvaluation,
  // ... 기타 payload
  // ← 여기에 freshnessType 추가
});
```

### TASK_INSTRUCTIONS (codex-cli-runner.js:205-224)
각 태스크별 LLM 지시문이 정의된 객체. `direct_question`과 `teach` 지시문에 freshness 관련 조건부 규칙을 추가해야 함.

## Sub-Tasks (TDD)

### Sub-Task 1: Freshness Classifier 모듈 생성

**생성 파일:**
- `src/domain/freshness-classifier.js`
- `test/domain/freshness-classifier.test.js`

**설계:**

```js
// src/domain/freshness-classifier.js

// volatile 신호 키워드/패턴
const VOLATILE_SIGNALS = [
  { pattern: /(?:최신|최근|새로운|새로 나온|업데이트|변경|릴리[즈스]|deprecated|지원 중단)/iu, name: "freshness_keyword" },
  { pattern: /\b(?:v?\d+\.\d+(?:\.\d+)?)\b/u, name: "version_number" },
  { pattern: /\b20[2-3]\d\b/u, name: "year_reference" },
  // 프레임워크명 + 숫자: React 19, Next.js 15, Python 3.12, Node 22 등
  { pattern: /(?:React|Next\.?js|Vue|Angular|Svelte|Python|Node\.?js?|Java|Swift|Kotlin|Go|Rust|TypeScript|Deno|Bun)\s*\d+/iu, name: "framework_version" },
  { pattern: /(?:변경점|마이그레이션|breaking change|migration)/iu, name: "migration_keyword" },
  { pattern: /(?:방금|이번|올해|지금)\s*(?:나온|출시|릴리)/iu, name: "recent_release" },
];

// evergreen 신호 키워드/패턴
const EVERGREEN_SIGNALS = [
  { pattern: /(?:원리|개념|기본|기초|이론|정의|차이|비교)\b/u, name: "concept_keyword" },
  { pattern: /(?:왜|어떻게|무슨 원리|동작 방식|작동 원리|메커니즘)/u, name: "mechanism_question" },
  { pattern: /(?:자료\s*구조|알고리즘|운영\s*체제|네트워크|데이터베이스|컴파일러|OS)\b/iu, name: "cs_fundamental" },
  { pattern: /(?:TCP|UDP|HTTP|DNS|OSI|IP|ARP)\b/u, name: "protocol_name" },
  { pattern: /(?:스택|큐|힙|트리|그래프|해시|링크드\s*리스트|배열)\b/u, name: "data_structure" },
  { pattern: /(?:정렬|탐색|DFS|BFS|다익스트라|DP|동적\s*프로그래밍)\b/u, name: "algorithm" },
  { pattern: /(?:프로세스|스레드|세마포어|뮤텍스|데드락|페이지|가상\s*메모리)\b/u, name: "os_concept" },
];

/**
 * 질문 텍스트의 최신성 의존도를 분류한다.
 * @param {string} questionText
 * @returns {{ type: 'evergreen'|'volatile'|'unknown', signals: string[] }}
 */
export function classifyFreshness(questionText) {
  const text = String(questionText ?? "").trim();
  if (!text) {
    return { type: "unknown", signals: [] };
  }

  const volatileHits = VOLATILE_SIGNALS
    .filter(s => s.pattern.test(text))
    .map(s => s.name);
  const evergreenHits = EVERGREEN_SIGNALS
    .filter(s => s.pattern.test(text))
    .map(s => s.name);

  // volatile 신호가 하나라도 있으면 volatile 우선
  if (volatileHits.length > 0) {
    return { type: "volatile", signals: volatileHits };
  }

  if (evergreenHits.length > 0) {
    return { type: "evergreen", signals: evergreenHits };
  }

  return { type: "unknown", signals: [] };
}
```

**테스트 (최소 25개):**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { classifyFreshness } from "../../src/domain/freshness-classifier.js";

// === volatile 케이스 (10개 이상) ===
test("React 19 새 기능은 volatile", () => {
  const r = classifyFreshness("React 19에서 새로 추가된 use() 훅이 뭐야?");
  assert.equal(r.type, "volatile");
});

test("버전 번호 언급은 volatile", () => {
  const r = classifyFreshness("Python 3.12에서 바뀐 점이 뭐야?");
  assert.equal(r.type, "volatile");
});

test("최신 키워드는 volatile", () => {
  const r = classifyFreshness("최신 Node.js에서 권장하는 패키지 매니저가 뭐야?");
  assert.equal(r.type, "volatile");
});

test("deprecated 언급은 volatile", () => {
  const r = classifyFreshness("componentWillMount가 deprecated된 이유가 뭐야?");
  assert.equal(r.type, "volatile");
});

test("연도 언급은 volatile", () => {
  const r = classifyFreshness("2026년 기준으로 가장 인기 있는 프론트엔드 프레임워크가 뭐야?");
  assert.equal(r.type, "volatile");
});

test("업데이트 키워드는 volatile", () => {
  const r = classifyFreshness("TypeScript 최근 업데이트에서 변경된 게 있어?");
  assert.equal(r.type, "volatile");
});

test("마이그레이션 키워드는 volatile", () => {
  const r = classifyFreshness("Next.js 14에서 15로 마이그레이션할 때 주의점이 뭐야?");
  assert.equal(r.type, "volatile");
});

test("릴리즈 키워드는 volatile", () => {
  const r = classifyFreshness("Bun 1.0 릴리즈에서 달라진 게 뭐야?");
  assert.equal(r.type, "volatile");
});

test("변경점 키워드는 volatile", () => {
  const r = classifyFreshness("Go 1.22 변경점 알려줘");
  assert.equal(r.type, "volatile");
});

test("breaking change 언급은 volatile", () => {
  const r = classifyFreshness("Vue 3에서 breaking change가 뭐가 있었어?");
  assert.equal(r.type, "volatile");
});

// === evergreen 케이스 (10개 이상) ===
test("자료구조 개념 질문은 evergreen", () => {
  const r = classifyFreshness("B+Tree랑 B-Tree 차이가 뭐야?");
  assert.equal(r.type, "evergreen");
});

test("알고리즘 원리 질문은 evergreen", () => {
  const r = classifyFreshness("다익스트라 알고리즘이 어떻게 동작하는지 설명해봐");
  assert.equal(r.type, "evergreen");
});

test("OS 개념 질문은 evergreen", () => {
  const r = classifyFreshness("프로세스랑 스레드 차이가 뭐야?");
  assert.equal(r.type, "evergreen");
});

test("네트워크 프로토콜 질문은 evergreen", () => {
  const r = classifyFreshness("TCP 3-way handshake가 왜 필요해?");
  assert.equal(r.type, "evergreen");
});

test("DB 개념 질문은 evergreen", () => {
  const r = classifyFreshness("데이터베이스 정규화가 뭐야?");
  assert.equal(r.type, "evergreen");
});

test("메커니즘 질문은 evergreen", () => {
  const r = classifyFreshness("가비지 컬렉션이 어떻게 동작해?");
  assert.equal(r.type, "evergreen");
});

test("왜 질문은 evergreen", () => {
  const r = classifyFreshness("왜 해시 테이블이 O(1)이야?");
  assert.equal(r.type, "evergreen");
});

test("데드락 개념은 evergreen", () => {
  const r = classifyFreshness("데드락 4가지 조건이 뭐야?");
  assert.equal(r.type, "evergreen");
});

test("가상 메모리 개념은 evergreen", () => {
  const r = classifyFreshness("가상 메모리 작동 원리 설명해봐");
  assert.equal(r.type, "evergreen");
});

test("DFS BFS 차이는 evergreen", () => {
  const r = classifyFreshness("DFS랑 BFS 차이가 뭐야?");
  assert.equal(r.type, "evergreen");
});

// === 경계 케이스 (5개) ===
test("volatile + evergreen 신호 동시 → volatile 우선", () => {
  const r = classifyFreshness("React 19에서 가상 DOM 동작 원리가 바뀌었어?");
  assert.equal(r.type, "volatile");
});

test("신호 없는 일반 질문은 unknown", () => {
  const r = classifyFreshness("커피 추천해줘");
  assert.equal(r.type, "unknown");
});

test("빈 문자열은 unknown", () => {
  const r = classifyFreshness("");
  assert.equal(r.type, "unknown");
});

test("null은 unknown", () => {
  const r = classifyFreshness(null);
  assert.equal(r.type, "unknown");
});

test("영문 프레임워크명 + 한국어 질문 혼합", () => {
  const r = classifyFreshness("Svelte 5에서 rune이 뭐야?");
  assert.equal(r.type, "volatile");
});
```

**커밋:** `feat: 최신성 분류기 구현 및 테스트`

---

### Sub-Task 2: TASK_INSTRUCTIONS에 freshness 규칙 추가

**수정 파일:** `src/llm/codex-cli-runner.js`

**현재 `direct_question` 지시문 (line 221):**
```
'The user asked a direct question in Slack DM. ...'
```

**끝에 추가할 내용:**
```
If payload.freshnessType is "volatile", this question depends on recent/versioned information. Do not state specific version details, API signatures, or configuration values as fact unless you are absolutely certain. For anything time-sensitive, add "최신 공식 문서 확인 필요" at the end. You may still explain general principles and known stable concepts.
```

**현재 `teach` 지시문 (line 217):**
```
'Return {"text":"...","challengePrompt":"..."} where text gives a brief correction ...'
```

**끝에 추가할 내용:**
```
If payload.freshnessType is "volatile", do not assert specific version details or API changes as fact. Teach the underlying principle and note that implementation details may have changed: "구체적인 API나 설정값은 공식 문서에서 확인해."
```

**추가로 `direct_thread_turn` 지시문 (line 223)에도 동일 규칙 추가:**
```
If payload.freshnessType is "volatile", do not state version-specific details as fact. Explain principles and flag time-sensitive claims with "최신 공식 문서 확인 필요".
```

**커밋:** `feat: TASK_INSTRUCTIONS에 freshness 보수 응답 규칙 추가`

---

### Sub-Task 3: 라우팅 통합

**수정 파일:**
- `src/app/slack-message-router.js`
- `src/app/tutor-thread-handler.js`

#### slack-message-router.js (direct question 경로)

**현재 (line 138-140):**
```js
replyFactory: async () => this.llmRunner.runTask("direct_question", {
  text: event.text,
}),
```

**수정:**
```js
import { classifyFreshness } from "../domain/freshness-classifier.js";

// ... 내부 ...
replyFactory: async () => {
  const { type: freshnessType } = classifyFreshness(event.text);
  return this.llmRunner.runTask("direct_question", {
    text: event.text,
    freshnessType,
  });
},
```

#### tutor-thread-handler.js (teach 경로)

**현재 (line 243-255):**
```js
const teaching = await llmRunner.runTask("teach", {
  thread: sessionBoundThread,
  text,
  evaluation: normalizedEvaluation,
  lastAssistantPrompt: sessionBoundThread.lastAssistantPrompt ?? null,
  lastChallengePrompt: getChallengePrompt(sessionBoundThread),
  codexSessionId: sessionBoundThread.codexSessionId ?? null,
  topicMemory: currentMemory,
  recentAttempts: retrievalContext.recentAttempts,
  latestTeachingMemory: retrievalContext.latestTeachingMemory,
  previousMisconceptionSummary: retrievalContext.previousMisconceptionSummary,
  previousTeachingSummary: retrievalContext.previousTeachingSummary,
});
```

**수정:**
```js
import { classifyFreshness } from "../domain/freshness-classifier.js";

// teach 호출 시 challenge prompt 기준으로 freshness 분류
const challengeText = getChallengePrompt(sessionBoundThread) ?? text;
const { type: freshnessType } = classifyFreshness(challengeText);

const teaching = await llmRunner.runTask("teach", {
  thread: sessionBoundThread,
  text,
  evaluation: normalizedEvaluation,
  freshnessType,
  // ... 기존 payload 동일
});
```

**커밋:** `feat: direct_question과 teach에 freshness 분류 연결`

---

### Sub-Task 4: 통합 테스트

**수정 파일:** `test/app/slack-message-router.test.js` 또는 새 파일

volatile 질문이 들어왔을 때 payload에 `freshnessType: "volatile"`이 포함되는지 검증:

```js
test("volatile 질문의 direct_question payload에 freshnessType이 포함된다", async () => {
  let capturedPayload = null;
  const mockLlmRunner = {
    async runTask(taskType, payload) {
      capturedPayload = payload;
      return { text: "답변", nextState: "open", challengePrompt: null };
    },
  };
  // SlackMessageRouter 생성, "React 19 새 기능이 뭐야?" 이벤트 전달
  // capturedPayload.freshnessType === "volatile" 확인
});
```

**커밋:** `test: freshness routing 통합 테스트`

---

### Sub-Task 5: 회귀 검증

```bash
npm test
```

**커밋:** `test: freshness routing 전체 회귀 검증`

---

## Key Files Reference

| File | Role | 수정 내용 |
|------|------|----------|
| `src/domain/freshness-classifier.js` | **새로 생성** | 규칙 기반 freshness 분류기 |
| `src/llm/codex-cli-runner.js:205-224` | TASK_INSTRUCTIONS | volatile 보수 응답 규칙 추가 |
| `src/app/slack-message-router.js:138-140` | direct question 호출 | freshnessType payload 추가 |
| `src/app/tutor-thread-handler.js:243-255` | teach 호출 | freshnessType payload 추가 |
| `test/domain/freshness-classifier.test.js` | **새로 생성** | 분류기 테스트 25개+ |

## Notes

- 이 구현은 **규칙 기반(regex)**이다. LLM 호출 없이 동기적으로 동작하므로 성능 오버헤드 제로.
- `unknown` 분류 시에는 기존 동작 그대로 — freshness 규칙이 적용되지 않음.
- 향후 RAG 도입 시 `volatile` 분류 결과를 retrieval routing에 연결 가능 (확장 포인트).
- `direct_thread_turn`에도 freshness를 넣을 수 있지만, 스레드 내 후속 턴은 최초 질문의 맥락을 이어가므로 1차에선 생략해도 됨. 필요하면 나중에 추가.
