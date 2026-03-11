import test from "node:test";
import assert from "node:assert/strict";

import { TutorBot } from "../../src/app/tutor-bot.js";
import {
  createInactiveSession,
  createStartedSession,
  pauseSession,
} from "../../src/domain/session-policy.js";
import { createThreadState } from "../../src/domain/thread-policy.js";

test("!start는 inactive 세션을 새로 시작한다", async () => {
  const store = createInMemoryStore();
  store.session = createInactiveSession();
  const bot = new TutorBot({
    store,
    topics: [],
    llmRunner: createUnusedLlmRunner(),
    slackClient: createUnusedSlackClient(),
  });
  const now = new Date("2026-03-11T09:05:00+09:00");

  const nextSession = await bot.handleControlInput("!start", now);

  assert.equal(nextSession.state, "active");
  assert.deepEqual(nextSession.startedAt, now);
  assert.deepEqual(store.session, nextSession);
});

test("!start는 paused 세션을 재개한다", async () => {
  const store = createInMemoryStore();
  const startedAt = new Date("2026-03-11T09:05:00+09:00");
  const pausedAt = new Date("2026-03-11T10:00:00+09:00");
  store.session = pauseSession(createStartedSession(startedAt), pausedAt);
  const bot = new TutorBot({
    store,
    topics: [],
    llmRunner: createUnusedLlmRunner(),
    slackClient: createUnusedSlackClient(),
  });

  const nextSession = await bot.handleControlInput("!start", new Date("2026-03-11T10:10:00+09:00"));

  assert.equal(nextSession.state, "active");
  assert.deepEqual(nextSession.startedAt, startedAt);
  assert.equal(nextSession.pausedAt, null);
});

test("!start는 이미 active 세션이면 상태를 다시 만들지 않는다", async () => {
  const store = createInMemoryStore();
  const startedAt = new Date("2026-03-11T09:05:00+09:00");
  store.session = createStartedSession(startedAt);
  const bot = new TutorBot({
    store,
    topics: [],
    llmRunner: createUnusedLlmRunner(),
    slackClient: createUnusedSlackClient(),
  });

  const nextSession = await bot.handleControlInput("!start", new Date("2026-03-11T10:10:00+09:00"));

  assert.equal(nextSession.state, "active");
  assert.deepEqual(nextSession.startedAt, startedAt);
  assert.deepEqual(store.session, nextSession);
});

test("!stop는 active 세션을 멈추고 inactive 세션은 그대로 둔다", async () => {
  const activeStore = createInMemoryStore();
  activeStore.session = createStartedSession(new Date("2026-03-11T09:05:00+09:00"));
  const inactiveStore = createInMemoryStore();
  inactiveStore.session = createInactiveSession();
  const activeBot = new TutorBot({
    store: activeStore,
    topics: [],
    llmRunner: createUnusedLlmRunner(),
    slackClient: createUnusedSlackClient(),
  });
  const inactiveBot = new TutorBot({
    store: inactiveStore,
    topics: [],
    llmRunner: createUnusedLlmRunner(),
    slackClient: createUnusedSlackClient(),
  });
  const stoppedAt = new Date("2026-03-11T10:00:00+09:00");

  const pausedSession = await activeBot.handleControlInput("!stop", stoppedAt);
  const unchangedSession = await inactiveBot.handleControlInput("!stop", stoppedAt);

  assert.equal(pausedSession.state, "paused");
  assert.deepEqual(pausedSession.pausedAt, stoppedAt);
  assert.equal(unchangedSession.state, "inactive");
});

test("lifecycle stale cleanup은 열린 study 스레드만 stale로 닫고 direct_qa는 유지한다", async () => {
  const store = createInMemoryStore();
  store.threads.set(
    "111.100",
    createThreadState({
      slackThreadTs: "111.100",
      topicId: "rendering",
      openedAt: new Date("2026-03-11T09:00:00+09:00"),
    }),
  );
  store.threads.set(
    "111.101",
    createThreadState({
      slackThreadTs: "111.101",
      topicId: null,
      kind: "direct_qa",
      openedAt: new Date("2026-03-11T09:01:00+09:00"),
    }),
  );
  const replies = [];
  const bot = new TutorBot({
    store,
    topics: [],
    llmRunner: createUnusedLlmRunner(),
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
  const now = new Date("2026-03-11T10:00:00+09:00");

  const closedThreads = await bot.closeOpenStudyThreadsAsStale(now);

  assert.deepEqual(closedThreads.map((thread) => ({
    slackThreadTs: thread.slackThreadTs,
    status: thread.status,
    closedAt: thread.closedAt,
  })), [
    {
      slackThreadTs: "111.100",
      status: "stale",
      closedAt: now,
    },
  ]);
  assert.equal(store.threads.get("111.100")?.status, "stale");
  assert.equal(store.threads.get("111.101")?.status, "open");
  assert.deepEqual(replies, [
    {
      threadTs: "111.100",
      text: "테스트 재시작한다며? 이전 기록은 전부 쓰레기통에 버렸어. 깔끔하게 새 흐름에서 다시 붙어보자고. 이번엔 아까처럼 운 좋게 넘어갈 생각 마.",
    },
  ]);
});

test("stale 안내 답글이 실패해도 lifecycle cleanup은 스레드를 stale로 닫는다", async () => {
  const store = createInMemoryStore();
  store.threads.set(
    "111.102",
    createThreadState({
      slackThreadTs: "111.102",
      topicId: "rendering",
      openedAt: new Date("2026-03-11T09:00:00+09:00"),
    }),
  );
  const bot = new TutorBot({
    store,
    topics: [],
    llmRunner: createUnusedLlmRunner(),
    slackClient: {
      async postDirectMessage() {
        throw new Error("should not be called");
      },
      async postThreadReply() {
        throw new Error("temporary slack failure");
      },
    },
  });
  const now = new Date("2026-03-11T10:00:00+09:00");

  const closedThreads = await bot.closeOpenStudyThreadsAsStale(now);

  assert.equal(closedThreads.length, 1);
  assert.equal(closedThreads[0].status, "stale");
  assert.equal(store.threads.get("111.102")?.status, "stale");
});

test("active 세션이면 우선순위가 가장 높은 주제로 자동 질문을 보낸다", async () => {
  const store = createInMemoryStore();
  store.session = createStartedSession(new Date("2026-03-10T09:00:00+09:00"));

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
    topicSelector({ topics }) {
      return topics.find((topic) => topic.id === "blocked-topic") ?? null;
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

test("topic memory의 next_review_at이 미래여도 다음 질문은 계속 발송된다", async () => {
  const store = createInMemoryStore();
  store.session = createStartedSession(new Date("2026-03-10T09:00:00+09:00"));
  store.memories.set("event-loop", {
    masteryScore: 0.9,
    attemptCount: 3,
    successCount: 3,
    failureCount: 0,
    lastOutcome: "mastered",
    lastMasteryKind: "clean",
    nextReviewAt: new Date("2026-03-20T09:00:00+09:00"),
    masteredStreak: 2,
  });

  const slackMessages = [];
  const bot = new TutorBot({
    store,
    topics: [
      {
        id: "event-loop",
        title: "Event Loop",
        category: "frontend",
        promptSeed: "Explain event loop.",
        weight: 3,
      },
    ],
    llmRunner: {
      async runTask(type, payload) {
        assert.equal(type, "question");
        assert.equal(payload.topic.id, "event-loop");
        return { text: "microtask checkpoint를 설명해봐." };
      },
    },
    topicSelector({ topics }) {
      return topics[0] ?? null;
    },
    slackClient: {
      async postDirectMessage(text) {
        slackMessages.push(text);
        return { channel: "D123", ts: "111.223" };
      },
      async postThreadReply() {
        throw new Error("should not be called");
      },
    },
  });

  const result = await bot.dispatchNextQuestion(new Date("2026-03-10T09:05:00+09:00"));

  assert.equal(result?.topicId, "event-loop");
  assert.deepEqual(slackMessages, ["microtask checkpoint를 설명해봐."]);
});

test("!start 직후 첫 질문 발송이 실패해도 세션은 active로 유지된다", async () => {
  const store = createInMemoryStore();
  store.session = createInactiveSession();
  const bot = new TutorBot({
    store,
    topics: [
      {
        id: "event-loop",
        title: "Event Loop",
        category: "frontend",
        promptSeed: "Explain event loop.",
        weight: 3,
      },
    ],
    llmRunner: {
      async runTask(type) {
        if (type === "question") {
          throw new Error("codex transient failure");
        }

        throw new Error(`unexpected task: ${type}`);
      },
    },
    slackClient: {
      async postDirectMessage() {
        throw new Error("should not be called");
      },
      async postThreadReply() {
        throw new Error("should not be called");
      },
    },
  });

  const session = await bot.handleControlInput("!start", new Date("2026-03-11T10:05:00+09:00"));

  assert.equal(session.state, "active");
  assert.equal(store.session?.state, "active");
});

test("열린 study 스레드가 있으면 자동 질문을 새로 보내지 않는다", async () => {
  const store = createInMemoryStore();
  store.session = createStartedSession(new Date("2026-03-10T09:00:00+09:00"));
  store.threads.set(
    "111.200",
    createThreadState({
      slackThreadTs: "111.200",
      topicId: "existing-topic",
      openedAt: new Date("2026-03-10T09:01:00+09:00"),
    }),
  );
  const llmCalls = [];
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
    ],
    llmRunner: {
      async runTask(type) {
        llmCalls.push(type);
        return { text: "should not happen" };
      },
    },
    slackClient: {
      async postDirectMessage() {
        throw new Error("should not be called");
      },
      async postThreadReply() {
        throw new Error("should not be called");
      },
    },
  });

  const result = await bot.dispatchNextQuestion(new Date("2026-03-10T09:05:00+09:00"));

  assert.equal(result, null);
  assert.deepEqual(llmCalls, []);
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

test("사용자가 명시적으로 막혔다고 하면 continue 평가여도 blocked teaching 상태로 유지한다", async () => {
  const store = createInMemoryStore();
  store.threads.set(
    "111.333",
    createThreadState({
      slackThreadTs: "111.333",
      topicId: "event-loop",
      openedAt: new Date("2026-03-10T09:00:00+09:00"),
    }),
  );

  const replies = [];
  const llmCalls = [];
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
      async runTask(type, payload) {
        llmCalls.push({ type, payload });

        if (type === "evaluate") {
          return {
            outcome: "continue",
            rationale: "세부 메커니즘 설명이 비었다.",
          };
        }

        if (type === "teach") {
          return {
            text: "지금 막힌 건 rAF 콜백 목록이 언제 확정되는지야. 그 단계부터 다시 잡아.",
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

  const result = await bot.handleThreadMessage({
    threadTs: "111.333",
    text: "그것까지는 모르겠어.",
    now: new Date("2026-03-10T09:06:00+09:00"),
  });

  assert.deepEqual(llmCalls.map(({ type }) => type), [
    "evaluate",
    "teach",
  ]);
  assert.deepEqual(replies, [
    {
      threadTs: "111.333",
      text: "지금 막힌 건 rAF 콜백 목록이 언제 확정되는지야. 그 단계부터 다시 잡아.",
    },
  ]);
  assert.equal(result.thread.status, "open");
  assert.equal(result.thread.blockedOnce, true);
  assert.equal(store.attempts.at(-1)?.outcome, "blocked");
  assert.equal(result.shouldScheduleNextQuestion, false);
});

test("평가 결과가 mastered면 clean mastery 상태 답글 후 스레드를 닫고 다음 질문 예약 신호를 반환한다", async () => {
  const store = createInMemoryStore();
  store.threads.set(
    "111.444",
    createThreadState({
      slackThreadTs: "111.444",
      topicId: "rendering",
      openedAt: new Date("2026-03-10T09:00:00+09:00"),
    }),
  );

  const replies = [];
  const bot = new TutorBot({
    store,
    topics: [
      {
        id: "rendering",
        title: "Rendering",
        category: "frontend",
        promptSeed: "Explain rendering pipeline.",
        weight: 3,
      },
    ],
    llmRunner: {
      async runTask(type) {
        if (type === "evaluate") {
          return {
            outcome: "mastered",
            text: "흥, 이번엔 넘어간다. 다음엔 더 깊게 물어볼 거야.",
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

  const result = await bot.handleThreadMessage({
    threadTs: "111.444",
    text: "layout, paint, composite를 구분해서 설명하면 됩니다.",
    now: new Date("2026-03-10T09:06:00+09:00"),
  });

  assert.deepEqual(replies, [
    {
      threadTs: "111.444",
      text: "흥, 이번엔 넘어간다. 다음엔 더 깊게 물어볼 거야.",
    },
    {
      threadTs: "111.444",
      text: "어... 어라? 정답이라고? ...쳇, 운이 좋았네. 이번 한 번만 봐준다. 이 스레드는 여기서 닫을 테니까 기어오르지 말고 다음 문제나 기다려.",
    },
  ]);
  assert.equal(result.thread.status, "mastered");
  assert.equal(result.masteryKind, "clean");
  assert.equal(store.memories.get("rendering")?.lastMasteryKind, "clean");
  assert.equal(result.shouldScheduleNextQuestion, true);
});

test("blocked를 거친 뒤 mastered면 recovered mastery 상태 답글을 남긴다", async () => {
  const store = createInMemoryStore();
  const thread = createThreadState({
    slackThreadTs: "111.555",
    topicId: "btree",
    openedAt: new Date("2026-03-10T09:00:00+09:00"),
  });
  store.threads.set("111.555", {
    ...thread,
    blockedOnce: true,
  });

  const replies = [];
  const bot = new TutorBot({
    store,
    topics: [
      {
        id: "btree",
        title: "B-Tree",
        category: "db",
        promptSeed: "Explain B-tree index.",
        weight: 3,
      },
    ],
    llmRunner: {
      async runTask(type) {
        if (type === "evaluate") {
          return {
            outcome: "mastered",
            text: "좋아, 이번 답은 메커니즘이 맞다.",
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

  const result = await bot.handleThreadMessage({
    threadTs: "111.555",
    text: "페이지 단위 I/O를 줄이려고 fanout이 큰 트리를 쓴다.",
    now: new Date("2026-03-10T09:10:00+09:00"),
  });

  assert.deepEqual(replies, [
    {
      threadTs: "111.555",
      text: "좋아, 이번 답은 메커니즘이 맞다.",
    },
    {
      threadTs: "111.555",
      text: "하, 처음엔 무너졌으면서 이제 와서 따라오네. 그래도 끝까지는 붙었으니 이번 스레드는 여기서 닫는다. 착각은 하지 마. 이건 겨우 따라온 거지, 처음부터 알고 있던 건 아니니까.",
    },
  ]);
  assert.equal(result.thread.status, "mastered");
  assert.equal(result.masteryKind, "recovered");
  assert.equal(store.memories.get("btree")?.lastMasteryKind, "recovered");
  assert.equal(result.shouldScheduleNextQuestion, true);
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

function createUnusedLlmRunner() {
  return {
    async runTask() {
      throw new Error("should not be called");
    },
  };
}

function createUnusedSlackClient() {
  return {
    async postDirectMessage() {
      throw new Error("should not be called");
    },
    async postThreadReply() {
      throw new Error("should not be called");
    },
  };
}
