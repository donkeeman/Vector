# Direct Q&A 스택 구현 계획

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** direct Q&A 스레드를 질문 스택으로 운영해 루트/꼬리질문 해소 순서를 보장하고, 최대 깊이 이후 push 금지 규칙을 강제한다.

**Architecture:** `directQaStackJson + directQaStackSealed`를 thread 상태로 저장하고, LLM은 `operation(push/pop/stay/close)`만 제안한다. 상태 전이 불변식(깊이 5, sealed 이후 push 금지)은 앱 레이어(`direct-qa-stack-policy`)에서 최종 강제한다.

**Tech Stack:** Node.js ESM, sqlite3 CLI, built-in test runner, Slack Socket Mode, Codex CLI

---

### Task 1: Direct Q&A 스택 정책 도입

**Files:**
- Create: `src/domain/direct-qa-stack-policy.js`
- Create: `test/domain/direct-qa-stack-policy.test.js`

**Step 1: Write the failing test**

```js
import { applyDirectQaOperation } from "../../src/domain/direct-qa-stack-policy.js";

test("depth 5 도달 후 sealed=true가 되고 push가 차단된다", () => {
  const state = {
    frames: [
      { id: "f1", prompt: "Q1", weakPassUsed: false },
      { id: "f2", prompt: "Q2", weakPassUsed: false },
      { id: "f3", prompt: "Q3", weakPassUsed: false },
      { id: "f4", prompt: "Q4", weakPassUsed: false },
    ],
    sealed: false,
    maxDepth: 5,
  };

  const reached = applyDirectQaOperation(state, { operation: "push", nextPrompt: "Q5" });
  assert.equal(reached.frames.length, 5);
  assert.equal(reached.sealed, true);

  const blocked = applyDirectQaOperation(reached, { operation: "push", nextPrompt: "Q6" });
  assert.equal(blocked.frames.length, 5);
  assert.equal(blocked.sealed, true);
});
```

**Step 2: Run test to verify it fails**

Run: `node --test test/domain/direct-qa-stack-policy.test.js`
Expected: FAIL (`module not found` or `applyDirectQaOperation is not a function`)

**Step 3: Write minimal implementation**

```js
export function applyDirectQaOperation(state, result) {
  // push/pop/stay/close를 정규화하고 sealed + maxDepth 불변식을 강제합니다.
}
```

구현 범위:
- 초기 상태 정규화(`frames`, `sealed`, `maxDepth=5`)
- `push` 허용 조건 검증
- `pop` 후 empty 판정 (`shouldClose=true`)
- `passQuality=weak`의 단일 검증 플래그 처리

**Step 4: Run test to verify it passes**

Run: `node --test test/domain/direct-qa-stack-policy.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add src/domain/direct-qa-stack-policy.js test/domain/direct-qa-stack-policy.test.js
git commit -m "feat: direct qa 스택 정책 도입"
```

### Task 2: Thread 저장 스키마 확장

**Files:**
- Modify: `src/storage/sqlite-store.js`
- Modify: `test/storage/sqlite-store.test.js`

**Step 1: Write the failing test**

```js
await store.saveThread({
  slackThreadTs: "stack.1",
  topicId: null,
  kind: "direct_qa",
  mode: "direct_qa",
  status: "open",
  openedAt: now,
  directQaStack: {
    frames: [{ id: "root", prompt: "MVCC가 뭐야?", weakPassUsed: false }],
    sealed: false,
    maxDepth: 5,
  },
  directQaStackSealed: false,
});

const loaded = await store.getThread("stack.1");
assert.equal(loaded.directQaStack.frames.length, 1);
assert.equal(loaded.directQaStack.sealed, false);
```

**Step 2: Run test to verify it fails**

Run: `node --test test/storage/sqlite-store.test.js`
Expected: FAIL (필드 직렬화/역직렬화 누락)

**Step 3: Write minimal implementation**

구현 범위:
- `threads` 컬럼 추가:
 - `direct_qa_stack_json TEXT`
 - `direct_qa_stack_sealed INTEGER NOT NULL DEFAULT 0`
- `saveThread`/`mapThreadRow`에 stack 매핑 추가
- `#ensureThreadColumns()`에 컬럼 마이그레이션 추가

**Step 4: Run test to verify it passes**

Run: `node --test test/storage/sqlite-store.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add src/storage/sqlite-store.js test/storage/sqlite-store.test.js
git commit -m "feat: direct qa 스택 저장 추가"
```

### Task 3: LLM 출력 계약 확장

**Files:**
- Modify: `src/llm/codex-cli-runner.js`
- Modify: `test/domain/llm-runner.test.js`

**Step 1: Write the failing test**

```js
const parsed = parseTaskResult("direct_thread_turn", {
  outputText: "{\"text\":\"...\",\"operation\":\"push\",\"nextPrompt\":\"Q2\"}",
  codexThreadId: "thread-1",
});
assert.equal(parsed.operation, "push");
assert.equal(parsed.nextPrompt, "Q2");
```

그리고 prompt 스냅샷 검증:

```js
assert.match(source, /direct_thread_turn[\s\S]*operation\"\\:\"push\\|pop\\|stay\\|close/u);
assert.match(source, /direct_thread_turn[\s\S]*sealed/u);
```

**Step 2: Run test to verify it fails**

Run: `node --test test/domain/llm-runner.test.js`
Expected: FAIL (새 output 계약 미반영)

**Step 3: Write minimal implementation**

구현 범위:
- `direct_thread_turn` 지시문에 operation 계약 추가
- `parseTaskResult`에서 `operation/nextPrompt/passQuality` 정규화
- 하위호환: `nextState/challengePrompt`만 와도 `stay`로 해석

**Step 4: Run test to verify it passes**

Run: `node --test test/domain/llm-runner.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add src/llm/codex-cli-runner.js test/domain/llm-runner.test.js
git commit -m "feat: direct qa 턴 계약 확장"
```

### Task 4: 라우터 스택 전이 연결

**Files:**
- Modify: `src/app/slack-message-router.js`
- Modify: `src/domain/thread-policy.js`
- Modify: `test/app/slack-message-router.test.js`

**Step 1: Write the failing test**

추가할 핵심 케이스:

```js
test("max depth 이후 push 요청은 stay로 강등한다", async () => {
  // depth=5 + sealed=true thread 준비
  // llm이 operation=push 반환
  // 결과: stack depth 유지, 질문은 top 기준 유지
});

test("pop 연쇄로 stack이 비면 direct_qa thread를 종료한다", async () => {
  // operation=pop으로 빈 스택
  // 결과: status=mastered(또는 close 규칙) + closedAt 설정
});
```

**Step 2: Run test to verify it fails**

Run: `node --test test/app/slack-message-router.test.js`
Expected: FAIL (스택 전이 로직 부재)

**Step 3: Write minimal implementation**

구현 범위:
- direct Q&A thread payload에 `directQaStack` 전달
- `applyDirectQaReplyState`를 stack 기반 전이로 교체
- 종료 조건(빈 스택)에서 thread close 처리
- `lastChallengePrompt`를 `stack.top.prompt`와 동기화

**Step 4: Run test to verify it passes**

Run: `node --test test/app/slack-message-router.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add src/app/slack-message-router.js src/domain/thread-policy.js test/app/slack-message-router.test.js
git commit -m "feat: direct qa 스택 전이 연결"
```

### Task 5: 통합 회귀 검증

**Files:**
- Modify: `docs/plans/2026-03-17-direct-qa-stack-design.md` (필요 시 구현 결정 반영)

**Step 1: Run target suites**

Run: `node --test test/domain/direct-qa-stack-policy.test.js test/domain/llm-runner.test.js test/storage/sqlite-store.test.js test/app/slack-message-router.test.js`
Expected: PASS

**Step 2: Run full test suite**

Run: `npm test`
Expected: PASS

**Step 3: Commit**

```bash
git add .
git commit -m "feat: direct qa 스택 흐름 도입"
```

## 다음 단계 메모

- 스택 기능 완료 후, 에이전트 기능형 2차 항목(`direct_qa` 도구사용/계획/다단계 해결)을 별도 설계로 분리합니다.
- 시작 질문: `도구사용 capability를 direct_thread_turn 내부 프롬프트 계약으로 둘지, 앱 레이어의 명시적 tool-orchestrator로 분리할지`.
