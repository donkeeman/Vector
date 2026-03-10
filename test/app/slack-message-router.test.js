import test from "node:test";
import assert from "node:assert/strict";

import { createThreadState } from "../../src/domain/thread-policy.js";
import { SlackMessageRouter } from "../../src/app/slack-message-router.js";

test("DM 루트 제어 명령은 세션 제어로 라우팅하고 같은 메시지 스레드에 확인 답장을 단다", async () => {
  const calls = [];
  const router = new SlackMessageRouter({
    store: createStore(),
    tutorBot: {
      async handleControlInput(text, now) {
        calls.push({ type: "control", text, now });
        return { state: "active" };
      },
      async dispatchNextQuestion(now) {
        calls.push({ type: "dispatch", now });
        return null;
      },
      async handleThreadMessage() {
        throw new Error("should not be called");
      },
    },
    llmRunner: {
      async runTask() {
        throw new Error("should not be called");
      },
    },
    slackClient: createSlackClient(),
    now: () => new Date("2026-03-10T17:00:00+09:00"),
  });

  await router.handleMessageEvent({
    type: "message",
    channel_type: "im",
    channel: "D123",
    user: "U123",
    text: "/study-start",
    ts: "1000.1",
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].text, "/study-start");
  assert.equal(calls[1].type, "dispatch");
  assert.deepEqual(router.slackClient.replies, [
    {
      threadTs: "1000.1",
      text: "좋아. 도망치진 않겠다는 거네. 준비되면 첫 질문부터 받아.",
    },
  ]);
});

test("DM 루트 일반 질문은 원문 메시지 스레드에 답한다", async () => {
  const slackClient = createSlackClient();
  const llmCalls = [];
  const router = new SlackMessageRouter({
    store: createStore(),
    tutorBot: createTutorBot(),
    llmRunner: {
      async runTask(type, payload) {
        llmCalls.push({ type, payload });
        return { text: "흥, 그 정도는 대답해주지. 이벤트 루프는..." };
      },
    },
    slackClient,
    now: () => new Date("2026-03-10T17:01:00+09:00"),
  });

  await router.handleMessageEvent({
    type: "message",
    channel_type: "im",
    channel: "D123",
    user: "U123",
    text: "event loop 설명해줘",
    ts: "1000.2",
  });

  assert.deepEqual(llmCalls, [
    {
      type: "direct_question",
      payload: {
        text: "event loop 설명해줘",
      },
    },
  ]);
  assert.deepEqual(slackClient.replies, [
    {
      threadTs: "1000.2",
      text: "흥, 그 정도는 대답해주지. 이벤트 루프는...",
    },
  ]);
});

test("열린 스레드가 있을 때 루트 DM에 답변처럼 보이는 메시지가 오면 안내 문구를 같은 메시지 스레드에 단다", async () => {
  const slackClient = createSlackClient();
  const store = createStore();
  store.threads.set(
    "111.222",
    createThreadState({
      slackThreadTs: "111.222",
      topicId: "event-loop",
      openedAt: new Date("2026-03-10T16:55:00+09:00"),
    }),
  );

  const router = new SlackMessageRouter({
    store,
    tutorBot: createTutorBot(),
    llmRunner: {
      async runTask() {
        throw new Error("should not be called");
      },
    },
    slackClient,
  });

  await router.handleMessageEvent({
    type: "message",
    channel_type: "im",
    channel: "D123",
    user: "U123",
    text: "콜스택이 비면 콜백이 들어갑니다.",
    ts: "1000.3",
  });

  assert.deepEqual(slackClient.replies, [
    {
      threadTs: "1000.3",
      text: "뜬금없이 무슨 소리야? 그 답변은 네가 열어둔 스레드에 달아. 거기서 끝까지 보자고.",
    },
  ]);
});

test("DM 스레드 reply는 TutorBot.handleThreadMessage로 전달된다", async () => {
  const calls = [];
  const router = new SlackMessageRouter({
    store: createStore(),
    tutorBot: {
      async handleControlInput() {
        throw new Error("should not be called");
      },
      async handleThreadMessage(payload) {
        calls.push(payload);
        return null;
      },
    },
    llmRunner: {
      async runTask() {
        throw new Error("should not be called");
      },
    },
    slackClient: createSlackClient(),
    now: () => new Date("2026-03-10T17:02:00+09:00"),
  });

  await router.handleMessageEvent({
    type: "message",
    channel_type: "im",
    channel: "D123",
    user: "U123",
    text: "콜스택이 비면 태스크 큐에서 가져옵니다.",
    ts: "1000.4",
    thread_ts: "1000.1",
  });

  assert.deepEqual(calls, [
    {
      threadTs: "1000.1",
      text: "콜스택이 비면 태스크 큐에서 가져옵니다.",
      now: new Date("2026-03-10T17:02:00+09:00"),
    },
  ]);
});

test("일반 질문 처리 실패 시에도 같은 메시지 스레드에 실패 응답을 단다", async () => {
  const slackClient = createSlackClient();
  const router = new SlackMessageRouter({
    store: createStore(),
    tutorBot: createTutorBot(),
    llmRunner: {
      async runTask() {
        throw new Error("codex failed");
      },
    },
    slackClient,
    onError() {},
  });

  await router.handleMessageEvent({
    type: "message",
    channel_type: "im",
    channel: "D123",
    user: "U123",
    text: "TCP handshake 설명해줘",
    ts: "1000.5",
  });

  assert.deepEqual(slackClient.replies, [
    {
      threadTs: "1000.5",
      text: "흠, 지금은 응답이 꼬였어. 같은 스레드에 다시 던져.",
    },
  ]);
});

test("봇 메시지, subtype 메시지, DM 외 채널 메시지는 무시한다", async () => {
  const slackClient = createSlackClient();
  const router = new SlackMessageRouter({
    store: createStore(),
    tutorBot: createTutorBot(),
    llmRunner: {
      async runTask() {
        throw new Error("should not be called");
      },
    },
    slackClient,
  });

  await router.handleMessageEvent({
    type: "message",
    channel_type: "im",
    channel: "D123",
    bot_id: "B123",
    text: "ignored",
    ts: "1000.6",
  });
  await router.handleMessageEvent({
    type: "message",
    channel_type: "im",
    channel: "D123",
    user: "U123",
    subtype: "message_changed",
    text: "ignored",
    ts: "1000.7",
  });
  await router.handleMessageEvent({
    type: "message",
    channel_type: "channel",
    channel: "C123",
    user: "U123",
    text: "ignored",
    ts: "1000.8",
  });

  assert.deepEqual(slackClient.replies, []);
});

function createTutorBot() {
  return {
    async handleControlInput() {
      throw new Error("should not be called");
    },
    async dispatchNextQuestion() {
      throw new Error("should not be called");
    },
    async handleThreadMessage() {
      throw new Error("should not be called");
    },
  };
}

function createStore() {
  return {
    threads: new Map(),
    async listOpenThreads() {
      return Array.from(this.threads.values()).filter((thread) => thread.status === "open");
    },
  };
}

function createSlackClient() {
  return {
    replies: [],
    async postThreadReply(threadTs, text) {
      this.replies.push({ threadTs, text });
      return { ok: true };
    },
  };
}
