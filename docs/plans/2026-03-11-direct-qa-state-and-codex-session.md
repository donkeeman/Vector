# Direct Q&A State And Codex Session Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** direct Q&A 스레드에 명시적인 상태머신과 Codex session 재개를 붙여, 후속 답변이 오프트픽으로 잘리지 않고 같은 Slack thread 문맥을 안정적으로 이어가게 만든다.

**Architecture:** SQLite thread row가 direct Q&A의 상태와 Codex session id를 source of truth로 가진다. direct Q&A 생성/후속/답변평가 task는 Codex session을 재개해 품질을 보강하되, resume 실패 시 SQLite history를 payload로 넘겨 새 session으로 복구한다.

**Tech Stack:** Node.js ESM, sqlite3 CLI store, Codex CLI (`exec` / `exec resume`), built-in node:test

---

### Task 1: Direct Q&A Thread State Schema

**Files:**
- Modify: `src/domain/thread-policy.js`
- Modify: `src/storage/sqlite-store.js`
- Test: `test/storage/sqlite-store.test.js`

**Step 1: Write the failing test**
- direct Q&A thread가 `codexSessionId`, `directQaState`, `lastAssistantPrompt`를 저장/조회하는 테스트를 추가한다.

**Step 2: Run test to verify it fails**

Run: `npm test -- /Users/hwlee/Projects/Vector/test/storage/sqlite-store.test.js`
Expected: FAIL because the new fields are not persisted yet.

**Step 3: Write minimal implementation**
- thread policy 생성자와 sqlite mapping/query를 확장한다.
- migration helper로 기존 DB에 새 컬럼을 추가한다.

**Step 4: Run test to verify it passes**

Run: `npm test -- /Users/hwlee/Projects/Vector/test/storage/sqlite-store.test.js`
Expected: PASS

### Task 2: Codex Session-Aware Direct Q&A Runner

**Files:**
- Modify: `src/llm/codex-cli-runner.js`
- Test: `test/domain/llm-runner.test.js`

**Step 1: Write the failing test**
- direct Q&A task가 새 session 시작 시 `thread.started` id를 반환하고, session id가 있으면 `exec resume` 경로를 쓰는 테스트를 추가한다.

**Step 2: Run test to verify it fails**

Run: `npm test -- /Users/hwlee/Projects/Vector/test/domain/llm-runner.test.js`
Expected: FAIL because direct Q&A task 결과에 session metadata가 없고 resume args도 없다.

**Step 3: Write minimal implementation**
- direct Q&A task 전용 exec/resume args builder를 추가한다.
- `--json` stdout에서 `thread.started` 이벤트를 파싱한다.
- direct Q&A response shape를 `{ text, expectsAnswer, challengePrompt, codexSessionId }` 형태로 정규화한다.
- prompt를 literal-first, no invented intent 규칙으로 강화한다.

**Step 4: Run test to verify it passes**

Run: `npm test -- /Users/hwlee/Projects/Vector/test/domain/llm-runner.test.js`
Expected: PASS

### Task 3: Direct Q&A State Machine In Router

**Files:**
- Modify: `src/app/slack-message-router.js`
- Test: `test/app/slack-message-router.test.js`

**Step 1: Write the failing test**
- assistant가 challenge를 남긴 direct Q&A thread가 `awaiting_answer` 상태가 되는지 테스트를 추가한다.
- 그 상태에서 user reply가 `direct_followup`이 아니라 `direct_answer_evaluate`로 가는 테스트를 추가한다.
- resume 실패 시 fallback 새 session을 저장하는 테스트를 추가한다.

**Step 2: Run test to verify it fails**

Run: `npm test -- /Users/hwlee/Projects/Vector/test/app/slack-message-router.test.js`
Expected: FAIL because the router currently has no direct Q&A answer mode.

**Step 3: Write minimal implementation**
- root direct question 시작 시 llm result metadata를 thread row에 저장한다.
- direct Q&A reply 시 thread state에 따라 `direct_followup` 또는 `direct_answer_evaluate`를 선택한다.
- llm result의 `expectsAnswer` / `challengePrompt`를 보고 thread state를 갱신한다.

**Step 4: Run test to verify it passes**

Run: `npm test -- /Users/hwlee/Projects/Vector/test/app/slack-message-router.test.js`
Expected: PASS

### Task 4: Regression Verification

**Files:**
- Verify: `test/app/slack-message-router.test.js`
- Verify: `test/domain/llm-runner.test.js`
- Verify: `test/storage/sqlite-store.test.js`
- Verify: full suite

**Step 1: Run focused regression**

Run: `npm test -- /Users/hwlee/Projects/Vector/test/app/slack-message-router.test.js /Users/hwlee/Projects/Vector/test/domain/llm-runner.test.js /Users/hwlee/Projects/Vector/test/storage/sqlite-store.test.js`
Expected: PASS

**Step 2: Run full regression**

Run: `npm test`
Expected: PASS with no new failures

**Step 3: Commit**

```bash
git add docs/plans/2026-03-11-direct-qa-state-and-codex-session-design.md docs/plans/2026-03-11-direct-qa-state-and-codex-session.md src/domain/thread-policy.js src/storage/sqlite-store.js src/llm/codex-cli-runner.js src/app/slack-message-router.js test/storage/sqlite-store.test.js test/domain/llm-runner.test.js test/app/slack-message-router.test.js
git commit -m "feat: direct qa 상태와 codex 세션 붙이기"
```
