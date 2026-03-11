# Vector Tone And Topic Guard Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Vector의 루트 DM 응답을 한국어 반말로 고정하고, 비기술 질문은 LLM 호출 없이 즉시 차단한다.

**Architecture:** 시스템 프롬프트와 `direct_question` 지시로 말투를 강제하고, `SlackMessageRouter` 앞단에 규칙 기반 기술 질문 판정기를 둔다. 오프트픽 차단은 로컬 처리로 끝내고, 허용 질문만 기존 `CodexCliRunner` 경로로 흘린다.

**Tech Stack:** Node.js ESM, built-in test runner, Slack Socket Mode runtime, Codex CLI

---

### Task 1: 반말 요구사항을 테스트로 고정

**Files:**
- Modify: `test/persona/vector-system-prompt.test.js`
- Test: `test/persona/vector-system-prompt.test.js`

**Step 1: Write the failing test**

추가할 검증:

```js
assert.match(VECTOR_SYSTEM_PROMPT, /반말/u);
assert.doesNotMatch(VECTOR_SYSTEM_PROMPT, /존댓말/u);
```

**Step 2: Run test to verify it fails**

Run: `node --test test/persona/vector-system-prompt.test.js`
Expected: FAIL because prompt does not require 반말 yet.

**Step 3: Write minimal implementation**

`src/persona/vector-system-prompt.js`에 한국어 스타일을 반말로 명시한다.

**Step 4: Run test to verify it passes**

Run: `node --test test/persona/vector-system-prompt.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add test/persona/vector-system-prompt.test.js src/persona/vector-system-prompt.js
git commit -m "feat: 반말 톤 고정"
```

### Task 2: 오프트픽 차단을 테스트로 고정

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
  ts: "1000.9",
  text: "너 누구야",
});

assert.deepEqual(llmRunner.calls, []);
assert.deepEqual(slackClient.threadReplies, [{
  threadTs: "1000.9",
  text: "..."
}]);
```

또 다른 검증:

```js
await router.handleMessageEvent({
  type: "message",
  channel_type: "im",
  channel: "D123",
  ts: "1001.0",
  text: "행렬식이 뭐야",
});

assert.equal(llmRunner.calls[0].taskType, "direct_question");
```

**Step 2: Run test to verify it fails**

Run: `node --test test/app/slack-message-router.test.js`
Expected: FAIL because router does not distinguish technical/off-topic roots yet.

**Step 3: Write minimal implementation**

`src/app/slack-message-router.js`에 기술 질문 판정과 오프트픽 차단 분기를 추가한다. 필요하면 작은 헬퍼를 분리한다.

**Step 4: Run test to verify it passes**

Run: `node --test test/app/slack-message-router.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add test/app/slack-message-router.test.js src/app/slack-message-router.js
git commit -m "feat: 오프트픽 질문 차단"
```

### Task 3: direct question 말투를 최소 구현으로 고정

**Files:**
- Modify: `src/llm/codex-cli-runner.js`
- Test: `test/domain/llm-runner.test.js`

**Step 1: Write the failing test**

추가할 검증:

```js
assert.match(prompt, /반말/u);
```

**Step 2: Run test to verify it fails**

Run: `node --test test/domain/llm-runner.test.js`
Expected: FAIL because direct question instruction does not explicitly require 반말.

**Step 3: Write minimal implementation**

`direct_question` task instruction에 반말 요구를 추가한다.

**Step 4: Run test to verify it passes**

Run: `node --test test/domain/llm-runner.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add test/domain/llm-runner.test.js src/llm/codex-cli-runner.js
git commit -m "feat: direct question 반말 고정"
```

### Task 4: 전체 회귀 검증

**Files:**
- Modify: `README.md` (only if behavior docs need refresh)
- Test: `npm test`

**Step 1: Run full test suite**

Run: `npm test`
Expected: PASS with all tests green.

**Step 2: Optional docs refresh**

루트 DM의 오프트픽 차단과 반말 정책이 README에 필요하면 최소로 반영한다.

**Step 3: Re-run tests if docs caused no code changes**

Run: `npm test`
Expected: PASS

**Step 4: Commit**

```bash
git add .
git commit -m "feat: 반말 톤과 질문 가드 추가"
```
