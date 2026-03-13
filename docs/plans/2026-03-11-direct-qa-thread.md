# Vector Direct Q&A Thread Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 루트 DM 기술 질문도 저장형 스레드로 취급해서 꼬리질문이 이어지게 하고, 자기소개/사용법은 고정문구로 빠르게 응답한다.

**Architecture:** `threads`에 `kind`를 추가해 학습 스레드와 direct Q&A 스레드를 구분하고, `direct_qa_messages`에 대화 turn을 저장한다. 라우터는 루트 DM에서 자기소개/사용법 예외, 오프트픽 차단, direct Q&A 생성 분기를 수행하고, direct Q&A 스레드 reply는 새 `direct_followup` LLM task로 이어간다.

**Tech Stack:** Node.js ESM, sqlite3 CLI, built-in test runner, Slack Socket Mode, Codex CLI

---

### Task 1: 라우터 기대 동작을 failing test로 고정

**Files:**
- Modify: `test/app/slack-message-router.test.js`
- Test: `test/app/slack-message-router.test.js`

**Step 1: Write the failing test**

추가할 검증:

```js
await router.handleMessageEvent({
  type: "message",
  channel_type: "im",
  channel: "D123",
  text: "RAG가 뭐야",
  ts: "2000.1",
});

assert.equal(store.savedThread.kind, "direct_qa");
assert.deepEqual(store.directQaMessages, [
  { threadTs: "2000.1", role: "user", text: "RAG가 뭐야" },
  { threadTs: "2000.1", role: "assistant", text: "..." },
]);
```

또 다른 검증:

```js
await router.handleMessageEvent({
  type: "message",
  channel_type: "im",
  channel: "D123",
  text: "너 누구야",
  ts: "2000.2",
});

assert.deepEqual(llmCalls, []);
assert.deepEqual(slackReplies, [{ threadTs: "2000.2", text: "..." }]);
```

**Step 2: Run test to verify it fails**

Run: `node --test test/app/slack-message-router.test.js`
Expected: FAIL because direct question threads are not persisted and intro/how-to exceptions do not exist yet.

**Step 3: Write minimal implementation**

`src/app/slack-message-router.js`에 direct Q&A thread 생성, intro/how-to 예외 응답, direct Q&A follow-up 분기를 추가한다.

**Step 4: Run test to verify it passes**

Run: `node --test test/app/slack-message-router.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add test/app/slack-message-router.test.js src/app/slack-message-router.js
git commit -m "feat: direct qa 스레드 저장"
```

### Task 2: 저장소 direct Q&A history를 failing test로 고정

**Files:**
- Create: `test/storage/sqlite-store.test.js`
- Modify: `src/storage/sqlite-store.js`
- Test: `test/storage/sqlite-store.test.js`

**Step 1: Write the failing test**

추가할 검증:

```js
await store.init();
await store.saveThread({
  slackThreadTs: "2000.1",
  topicId: null,
  kind: "direct_qa",
  status: "open",
  mode: "direct_qa",
  openedAt: now,
});
await store.saveDirectQaMessage({ threadTs: "2000.1", role: "user", text: "RAG가 뭐야", recordedAt: now });

const thread = await store.getThread("2000.1");
const history = await store.listDirectQaMessages("2000.1");
```

**Step 2: Run test to verify it fails**

Run: `node --test test/storage/sqlite-store.test.js`
Expected: FAIL because schema/methods do not exist yet.

**Step 3: Write minimal implementation**

`src/storage/sqlite-store.js`에:
- `threads.kind` 컬럼 보장
- `direct_qa_messages` 테이블 생성
- `saveDirectQaMessage`, `listDirectQaMessages` 구현
- 기존 row에 `kind`가 없을 때 `study`로 해석하는 매핑 추가

**Step 4: Run test to verify it passes**

Run: `node --test test/storage/sqlite-store.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add test/storage/sqlite-store.test.js src/storage/sqlite-store.js
git commit -m "feat: direct qa 히스토리 저장"
```

### Task 3: direct Q&A follow-up을 failing test로 고정

**Files:**
- Modify: `test/app/slack-message-router.test.js`
- Modify: `src/llm/codex-cli-runner.js`
- Modify: `src/domain/thread-policy.js`
- Test: `test/app/slack-message-router.test.js`

**Step 1: Write the failing test**

추가할 검증:

```js
store.savedThreads.set("2000.1", {
  slackThreadTs: "2000.1",
  kind: "direct_qa",
  mode: "direct_qa",
  status: "open",
});
store.directQaMessages.set("2000.1", [
  { role: "user", text: "RAG가 뭐야" },
  { role: "assistant", text: "..." },
]);

await router.handleMessageEvent({
  type: "message",
  channel_type: "im",
  channel: "D123",
  ts: "2000.3",
  thread_ts: "2000.1",
  text: "그럼 vector search랑 차이는?",
});

assert.equal(llmCalls[0].type, "direct_followup");
assert.deepEqual(llmCalls[0].payload.history.length, 2);
```

**Step 2: Run test to verify it fails**

Run: `node --test test/app/slack-message-router.test.js`
Expected: FAIL because all thread replies currently route to TutorBot.

**Step 3: Write minimal implementation**

`direct_followup` task와 direct Q&A thread mode를 추가하고, 라우터가 `kind === direct_qa`일 때 별도 처리하게 만든다.

**Step 4: Run test to verify it passes**

Run: `node --test test/app/slack-message-router.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add test/app/slack-message-router.test.js src/llm/codex-cli-runner.js src/domain/thread-policy.js
git commit -m "feat: direct qa 꼬리질문 연결"
```

### Task 4: 전체 회귀 검증

**Files:**
- Modify: `README.md` (if behavior docs need refresh)
- Test: `npm test`

**Step 1: Run full test suite**

Run: `npm test`
Expected: PASS with all tests green.

**Step 2: Optional docs refresh**

루트 DM direct Q&A와 자기소개/사용법 예외가 README에 필요하면 최소로 반영한다.

**Step 3: Re-run tests**

Run: `npm test`
Expected: PASS

**Step 4: Commit**

```bash
git add .
git commit -m "feat: direct qa 스레드 연속성 추가"
```
