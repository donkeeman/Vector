# Direct Thread Turn Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** direct Q&A 스레드의 해석을 `direct_thread_turn` 하나로 통합해, 예외 규칙을 줄이고 피벗/답변/새 질문을 더 자연스럽게 처리한다.

**Architecture:** root DM의 첫 direct question만 별도 task로 두고, 이후 direct Q&A thread reply는 전부 `direct_thread_turn`으로 보낸다. thread state는 `open/awaiting_answer` 두 개만 유지하고, Codex session resume과 SQLite history를 함께 사용한다.

**Tech Stack:** Node.js ESM, sqlite3 CLI, Codex CLI resume/json mode, node:test

---

### Task 1: Thread State 단순화

**Files:**
- Modify: `src/domain/thread-policy.js`
- Modify: `src/storage/sqlite-store.js`
- Test: `test/storage/sqlite-store.test.js`

**Step 1: Write the failing test**
- direct Q&A thread의 `mode`가 `direct_qa`로 고정되고, `directQaState`만 바뀌는 테스트를 추가한다.

**Step 2: Run test to verify it fails**

Run: `npm test -- /Users/hwlee/Projects/Vector/test/storage/sqlite-store.test.js`
Expected: FAIL

**Step 3: Write minimal implementation**
- thread policy와 sqlite mapping을 direct Q&A state 중심으로 정리한다.

**Step 4: Run test to verify it passes**

Run: `npm test -- /Users/hwlee/Projects/Vector/test/storage/sqlite-store.test.js`
Expected: PASS

### Task 2: LLM Task 통합

**Files:**
- Modify: `src/llm/codex-cli-runner.js`
- Test: `test/domain/llm-runner.test.js`

**Step 1: Write the failing test**
- `direct_followup`/`direct_answer_evaluate` 대신 `direct_thread_turn` task를 기대하는 테스트를 추가한다.
- `direct_thread_turn` prompt가 literal-first, no invented intent, pivot handling을 명시하는지 테스트를 추가한다.

**Step 2: Run test to verify it fails**

Run: `npm test -- /Users/hwlee/Projects/Vector/test/domain/llm-runner.test.js`
Expected: FAIL

**Step 3: Write minimal implementation**
- `direct_thread_turn` task instruction을 추가한다.
- session-aware task 목록을 `direct_question` + `direct_thread_turn`으로 정리한다.
- 결과 shape를 `text`, `nextState`, `challengePrompt`, `codexSessionId` 중심으로 정규화한다.

**Step 4: Run test to verify it passes**

Run: `npm test -- /Users/hwlee/Projects/Vector/test/domain/llm-runner.test.js`
Expected: PASS

### Task 3: Router 단순화

**Files:**
- Modify: `src/app/slack-message-router.js`
- Test: `test/app/slack-message-router.test.js`

**Step 1: Write the failing test**
- direct Q&A open state reply가 `direct_thread_turn`으로 가는 테스트를 작성한다.
- awaiting_answer state reply도 같은 task로 가는 테스트를 작성한다.
- `모르겠어 + 새 기술 질문` reply가 rejection이 아니라 정상 답변으로 이어지는 테스트를 작성한다.

**Step 2: Run test to verify it fails**

Run: `npm test -- /Users/hwlee/Projects/Vector/test/app/slack-message-router.test.js`
Expected: FAIL

**Step 3: Write minimal implementation**
- router에서 `direct_followup`/`direct_answer_evaluate` 분기를 제거한다.
- direct Q&A thread reply는 항상 `direct_thread_turn`으로 보낸다.
- llm output의 `nextState`/`challengePrompt`에 따라 thread state를 갱신한다.

**Step 4: Run test to verify it passes**

Run: `npm test -- /Users/hwlee/Projects/Vector/test/app/slack-message-router.test.js`
Expected: PASS

### Task 4: Regression Verification

**Files:**
- Verify: `test/storage/sqlite-store.test.js`
- Verify: `test/domain/llm-runner.test.js`
- Verify: `test/app/slack-message-router.test.js`
- Verify: full suite

**Step 1: Run focused regression**

Run: `npm test -- /Users/hwlee/Projects/Vector/test/storage/sqlite-store.test.js /Users/hwlee/Projects/Vector/test/domain/llm-runner.test.js /Users/hwlee/Projects/Vector/test/app/slack-message-router.test.js`
Expected: PASS

**Step 2: Run full regression**

Run: `npm test`
Expected: PASS

**Step 3: Commit**

```bash
git add docs/plans/2026-03-11-direct-thread-turn-design.md docs/plans/2026-03-11-direct-thread-turn.md src/domain/thread-policy.js src/storage/sqlite-store.js src/llm/codex-cli-runner.js src/app/slack-message-router.js test/storage/sqlite-store.test.js test/domain/llm-runner.test.js test/app/slack-message-router.test.js
git commit -m "refactor: direct qa 턴 해석 단순화"
```
