import test from "node:test";
import assert from "node:assert/strict";

import { TutorBot } from "../../src/app/tutor-bot.js";
import { createStartedSession } from "../../src/domain/session-policy.js";
import { createThreadState } from "../../src/domain/thread-policy.js";

test("active 세션이면 우선순위가 가장 높은 주제로 자동 질문을 보낸다", async () => {
  const store = createInMemoryStore();
  store.session = createStartedSession(new Date("2026-03-10T09:00:00+09:00"));
  store.memories.set("blocked-topic", {
    masteryScore: 0.1,
    attemptCount: 1,
    successCount: 0,
    failureCount: 1,
    lastOutcome: "blocked",
    nextReviewAt: new Date("2026-03-10T09:00:00+09:00"),
    masteredStreak: 0,
  });

  const slackMessages = [];
  const bot = new TutorBot({
    store,
    topics: [
      {
        id: "new-topic",
        title: "New Topic",
        category: "frontend",
        promptSeed: "Explain event loop.",
        weight: 3,
      },
      {
        id: "blocked-topic",
        title: "Blocked Topic",
        category: "network",
        promptSeed: "Explain TCP three-way handshake.",
        weight: 1,
      },
    ],
    llmRunner: {
      async runTask(type, payload) {
        assert.equal(type, "question");
        assert.equal(payload.topic.id, "blocked-topic");
        return { text: "이 정도는 알겠지? TCP 3-way handshake 설명해봐." };
      },
    },
    slackClient: {
      async postDirectMessage(text) {
        slackMessages.push(text);
        return { channel: "D123", ts: "111.222" };
      },
      async postThreadReply() {
        throw new Error("should not be called");
      },
    },
  });

  await bot.dispatchNextQuestion(new Date("2026-03-10T09:05:00+09:00"));

  assert.deepEqual(slackMessages, [
    "이 정도는 알겠지? TCP 3-way handshake 설명해봐.",
  ]);
  assert.equal(store.threads.get("111.222")?.topicId, "blocked-topic");
});

test("평가 결과가 continue면 같은 스레드에 꼬리질문을 이어서 보낸다", async () => {
  const store = createInMemoryStore();
  store.threads.set(
    "111.222",
    createThreadState({
      slackThreadTs: "111.222",
      topicId: "event-loop",
      openedAt: new Date("2026-03-10T09:00:00+09:00"),
    }),
  );

  const replies = [];
  const bot = new TutorBot({
    store,
    topics: [
      {
        id: "event-loop",
        title: "Event Loop",
        category: "frontend",
        promptSeed: "Explain the event loop.",
        weight: 3,
      },
    ],
    llmRunner: {
      async runTask(type) {
        if (type === "evaluate") {
          return {
            outcome: "continue",
            rationale: "macro task와 micro task 설명이 빠졌다.",
          };
        }

        if (type === "followup") {
          return {
            text: "좋아, 그럼 microtask queue가 언제 비워지는지 설명해봐.",
          };
        }

        throw new Error(`unexpected task: ${type}`);
      },
    },
    slackClient: {
      async postDirectMessage() {
        throw new Error("should not be called");
      },
      async postThreadReply(threadTs, text) {
        replies.push({ threadTs, text });
        return { ok: true };
      },
    },
  });

  await bot.handleThreadMessage({
    threadTs: "111.222",
    text: "콜스택 보고 비는 시점에 콜백이 들어갑니다.",
    now: new Date("2026-03-10T09:06:00+09:00"),
  });

  assert.deepEqual(replies, [
    {
      threadTs: "111.222",
      text: "좋아, 그럼 microtask queue가 언제 비워지는지 설명해봐.",
    },
  ]);
  assert.equal(store.attempts.length, 1);
});

function createInMemoryStore() {
  return {
    session: null,
    threads: new Map(),
    memories: new Map(),
    attempts: [],
    async getSession() {
      return this.session;
    },
    async saveSession(session) {
      this.session = session;
    },
    async listOpenThreads() {
      return Array.from(this.threads.values()).filter((thread) => thread.status === "open");
    },
    async getThread(threadTs) {
      return this.threads.get(threadTs) ?? null;
    },
    async saveThread(thread) {
      this.threads.set(thread.slackThreadTs, thread);
    },
    async getTopicMemories() {
      return this.memories;
    },
    async getTopicMemory(topicId) {
      return this.memories.get(topicId) ?? null;
    },
    async saveTopicMemory(topicId, memory) {
      this.memories.set(topicId, memory);
    },
    async saveAttempt(attempt) {
      this.attempts.push(attempt);
    },
  };
}
