# Slack Socket Mode Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Slack Socket Mode 수신을 붙여 DM root message와 thread reply를 현재 Vector 코어 로직에 연결한다.

**Architecture:** Slack 이벤트는 `SocketModeTransport`가 수신하고, 얇은 앱 계층 라우터가 제어 명령, 일반 질문, thread 답변을 분기한다. 기존 `TutorBot` 도메인은 유지하고, root DM 일반 질문만 새 task type으로 처리한다.

**Tech Stack:** Node.js ESM, `@slack/socket-mode`, existing `@slack/web-api`, Node test runner

---

### Task 1: Add Slack Event Routing Tests

**Files:**
- Modify: `test/app/tutor-bot.test.js`
- Create: `test/runtime/slack/socket-mode-transport.test.js`
- Test: `test/runtime/slack/socket-mode-transport.test.js`

**Step 1: Write the failing test**

```js
test("DM 루트 일반 질문은 원문 메시지 스레드에 답한다", async () => {
  // transport routes root DM question to reply in thread
});
```

**Step 2: Run test to verify it fails**

Run: `node --test test/runtime/slack/socket-mode-transport.test.js`
Expected: FAIL because the transport routing does not exist yet

**Step 3: Write minimal implementation**

```js
export class SocketModeTransport {
  // route events to injected handlers
}
```

**Step 4: Run test to verify it passes**

Run: `node --test test/runtime/slack/socket-mode-transport.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add test/runtime/slack/socket-mode-transport.test.js src/runtime/slack/socket-mode-transport.js
git commit -m "test: slack socket mode 라우팅 추가"
```

### Task 2: Add Direct Question App Handler

**Files:**
- Create: `src/app/direct-question.js`
- Modify: `src/llm/codex-cli-runner.js`
- Test: `test/runtime/slack/socket-mode-transport.test.js`

**Step 1: Write the failing test**

```js
test("일반 질문은 direct_question task로 답변을 만든다", async () => {
  // assert llmRunner.runTask("direct_question", ...)
});
```

**Step 2: Run test to verify it fails**

Run: `node --test test/runtime/slack/socket-mode-transport.test.js`
Expected: FAIL because no direct question handler exists

**Step 3: Write minimal implementation**

```js
export async function handleDirectQuestion({ llmRunner, slackClient, message }) {
  const reply = await llmRunner.runTask("direct_question", { text: message.text });
  return slackClient.postThreadReply(message.ts, reply.text);
}
```

**Step 4: Run test to verify it passes**

Run: `node --test test/runtime/slack/socket-mode-transport.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add src/app/direct-question.js src/llm/codex-cli-runner.js test/runtime/slack/socket-mode-transport.test.js
git commit -m "feat: 일반 질문 스레드 응답 추가"
```

### Task 3: Implement Socket Mode Transport

**Files:**
- Modify: `src/runtime/slack/socket-mode-transport.js`
- Modify: `src/main.js`
- Test: `test/runtime/slack/socket-mode-transport.test.js`

**Step 1: Write the failing test**

```js
test("스레드 reply는 TutorBot.handleThreadMessage로 전달된다", async () => {
  // assert handler invocation
});
```

**Step 2: Run test to verify it fails**

Run: `node --test test/runtime/slack/socket-mode-transport.test.js`
Expected: FAIL because the transport does not wire Slack events yet

**Step 3: Write minimal implementation**

```js
const client = new SocketModeClient({ appToken });
client.on("events_api", async ({ ack, body }) => {
  await ack();
  await routeMessageEvent(body.event);
});
```

**Step 4: Run test to verify it passes**

Run: `node --test test/runtime/slack/socket-mode-transport.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add src/runtime/slack/socket-mode-transport.js src/main.js test/runtime/slack/socket-mode-transport.test.js
git commit -m "feat: slack socket mode transport 연결"
```

### Task 4: Verify End-to-End Local Baseline

**Files:**
- Modify: `README.md`
- Modify: `.env.example`
- Test: `test/runtime/slack/socket-mode-transport.test.js`

**Step 1: Write the failing test**

```js
test("Socket Mode transport starts with injected handlers", async () => {
  // assert start path
});
```

**Step 2: Run test to verify it fails**

Run: `node --test`
Expected: FAIL if config or wiring is incomplete

**Step 3: Write minimal implementation**

```js
// document required env and runtime behavior
```

**Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS

**Step 5: Commit**

```bash
git add README.md .env.example
git commit -m "docs: socket mode 실행 방법 정리"
```
