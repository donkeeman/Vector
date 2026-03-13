import test from "node:test";
import assert from "node:assert/strict";

import { TutorBot } from "../../src/app/tutor-bot.js";
import {
  createInactiveSession,
  createStartedSession,
  deactivateSession,
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

test("!start는 inactive 세션의 최근 stopped study 스레드 하나만 다시 열고 재개 알림을 남긴다", async () => {
  const store = createInMemoryStore();
  const startedAt = new Date("2026-03-11T09:05:00+09:00");
  const stoppedAt = new Date("2026-03-11T10:00:00+09:00");
  store.session = deactivateSession(createStartedSession(startedAt), stoppedAt);
  store.threads.set(
    "111.210",
    {
      ...createThreadState({
        slackThreadTs: "111.210",
        topicId: "event-loop",
        openedAt: new Date("2026-03-11T09:10:00+09:00"),
      }),
      status: "stopped",
      closedAt: new Date("2026-03-11T10:00:00+09:00"),
    },
  );
  store.threads.set(
    "111.211",
    {
      ...createThreadState({
        slackThreadTs: "111.211",
        topicId: "rendering",
        openedAt: new Date("2026-03-11T09:20:00+09:00"),
      }),
      status: "stopped",
      closedAt: new Date("2026-03-11T10:01:00+09:00"),
      lastUserReplyAt: new Date("2026-03-11T09:59:00+09:00"),
    },
  );
  store.threads.set(
    "111.212",
    {
      ...createThreadState({
        slackThreadTs: "111.212",
        topicId: null,
        kind: "direct_qa",
        openedAt: new Date("2026-03-11T09:30:00+09:00"),
      }),
      status: "stopped",
      closedAt: new Date("2026-03-11T10:02:00+09:00"),
    },
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

  const nextSession = await bot.handleControlInput("!start", new Date("2026-03-11T10:10:00+09:00"));

  assert.equal(nextSession.state, "active");
  assert.equal(store.threads.get("111.211")?.status, "open");
  assert.equal(store.threads.get("111.211")?.closedAt, null);
  assert.equal(store.threads.get("111.210")?.status, "stopped");
  assert.equal(store.threads.get("111.212")?.status, "stopped");
  assert.deepEqual(replies, [
    {
      threadTs: "111.211",
      text: "머리가 어떻게 된 거 아냐? 아직 끝내지도 못한 스레드가 버젓이 남아있잖아. 하던 거나 마저 끝내고 와. 모른다고 적당히 뭉개고 새 질문으로 도망칠 생각은 꿈도 꾸지 마.",
    },
  ]);
});

test("!start는 stopped 상태의 무응답 study 스레드도 open으로 다시 열고 답변 유도 대사를 남긴다", async () => {
  const store = createInMemoryStore();
  store.session = createInactiveSession();
  store.threads.set(
    "111.215",
    {
      ...createThreadState({
        slackThreadTs: "111.215",
        topicId: "event-loop",
        openedAt: new Date("2026-03-11T09:10:00+09:00"),
      }),
      status: "stopped",
      closedAt: new Date("2026-03-11T10:00:00+09:00"),
      lastUserReplyAt: null,
    },
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

  await bot.handleControlInput("!start", new Date("2026-03-11T10:10:00+09:00"));

  assert.equal(store.threads.get("111.215")?.status, "open");
  assert.equal(store.threads.get("111.215")?.closedAt, null);
  assert.deepEqual(replies, [
    {
      threadTs: "111.215",
      text: "야, 아직 내 마지막 질문에 답도 안 했잖아. 새로 시작 버튼 누른다고 기록이 리셋되는 줄 알았어? 딴소리하지 말고 그 스레드에서 지금 바로 답해.",
    },
  ]);
});

test("!start는 open 상태의 무응답 study 스레드면 재개 대신 해당 스레드로 답변 유도 대사를 남긴다", async () => {
  const store = createInMemoryStore();
  store.session = createInactiveSession();
  store.threads.set(
    "111.213",
    createThreadState({
      slackThreadTs: "111.213",
      topicId: "event-loop",
      openedAt: new Date("2026-03-11T09:10:00+09:00"),
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

  const nextSession = await bot.handleControlInput("!start", new Date("2026-03-11T10:10:00+09:00"));

  assert.equal(nextSession.state, "active");
  assert.equal(store.threads.get("111.213")?.status, "open");
  assert.equal(store.threads.get("111.213")?.closedAt, null);
  assert.deepEqual(replies, [
    {
      threadTs: "111.213",
      text: "야, 아직 내 마지막 질문에 답도 안 했잖아. 새로 시작 버튼 누른다고 기록이 리셋되는 줄 알았어? 딴소리하지 말고 그 스레드에서 지금 바로 답해.",
    },
  ]);
});

test("!start는 open study 스레드에 사용자 답변 이력이 있으면 기존 재개 대사를 사용한다", async () => {
  const store = createInMemoryStore();
  store.session = createInactiveSession();
  store.threads.set(
    "111.214",
    {
      ...createThreadState({
        slackThreadTs: "111.214",
        topicId: "event-loop",
        openedAt: new Date("2026-03-11T09:10:00+09:00"),
      }),
      lastUserReplyAt: new Date("2026-03-11T09:15:00+09:00"),
    },
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

  await bot.handleControlInput("!start", new Date("2026-03-11T10:10:00+09:00"));

  assert.equal(store.threads.get("111.214")?.status, "open");
  assert.equal(store.threads.get("111.214")?.closedAt, null);
  assert.deepEqual(replies, [
    {
      threadTs: "111.214",
      text: "머리가 어떻게 된 거 아냐? 아직 끝내지도 못한 스레드가 버젓이 남아있잖아. 하던 거나 마저 끝내고 와. 모른다고 적당히 뭉개고 새 질문으로 도망칠 생각은 꿈도 꾸지 마.",
    },
  ]);
});

test("!start는 이전 답변 이력이 있어도 최신 질문 대기 상태면 답변 유도 대사를 남긴다", async () => {
  const store = createInMemoryStore();
  store.session = createInactiveSession();
  store.threads.set(
    "111.217",
    {
      ...createThreadState({
        slackThreadTs: "111.217",
        topicId: "event-loop",
        openedAt: new Date("2026-03-11T09:10:00+09:00"),
      }),
      status: "stopped",
      closedAt: new Date("2026-03-11T10:00:00+09:00"),
      lastUserReplyAt: new Date("2026-03-11T09:20:00+09:00"),
      awaitingUserReplyAt: new Date("2026-03-11T09:25:00+09:00"),
    },
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

  await bot.handleControlInput("!start", new Date("2026-03-11T10:10:00+09:00"));

  assert.equal(store.threads.get("111.217")?.status, "open");
  assert.equal(store.threads.get("111.217")?.closedAt, null);
  assert.deepEqual(replies, [
    {
      threadTs: "111.217",
      text: "야, 아직 내 마지막 질문에 답도 안 했잖아. 새로 시작 버튼 누른다고 기록이 리셋되는 줄 알았어? 딴소리하지 말고 그 스레드에서 지금 바로 답해.",
    },
  ]);
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

test("이미 active 세션이어도 열린 study가 없고 stopped 무응답 스레드가 있으면 !start로 즉시 유도 대사를 남긴다", async () => {
  const store = createInMemoryStore();
  const startedAt = new Date("2026-03-11T09:05:00+09:00");
  store.session = createStartedSession(startedAt);
  store.threads.set(
    "111.218",
    {
      ...createThreadState({
        slackThreadTs: "111.218",
        topicId: "event-loop",
        openedAt: new Date("2026-03-11T09:10:00+09:00"),
      }),
      status: "stopped",
      closedAt: new Date("2026-03-11T10:00:00+09:00"),
      lastUserReplyAt: null,
    },
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

  const nextSession = await bot.handleControlInput("!start", new Date("2026-03-11T10:10:00+09:00"));

  assert.equal(nextSession.state, "active");
  assert.deepEqual(nextSession.startedAt, startedAt);
  assert.equal(store.threads.get("111.218")?.status, "open");
  assert.equal(store.threads.get("111.218")?.closedAt, null);
  assert.deepEqual(replies, [
    {
      threadTs: "111.218",
      text: "야, 아직 내 마지막 질문에 답도 안 했잖아. 새로 시작 버튼 누른다고 기록이 리셋되는 줄 알았어? 딴소리하지 말고 그 스레드에서 지금 바로 답해.",
    },
  ]);
});

test("연속 start 이벤트가 들어와도 무응답 study 스레드 유도 대사는 한 번만 보낸다", async () => {
  const store = createInMemoryStore();
  store.session = createInactiveSession();
  store.threads.set(
    "111.216",
    {
      ...createThreadState({
        slackThreadTs: "111.216",
        topicId: "event-loop",
        openedAt: new Date("2026-03-11T09:10:00+09:00"),
      }),
      status: "stopped",
      closedAt: new Date("2026-03-11T10:00:00+09:00"),
      lastUserReplyAt: null,
    },
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

  await bot.applyControlCommand("start", new Date("2026-03-11T10:10:00+09:00"));
  await bot.applyControlCommand("start", new Date("2026-03-11T10:10:01+09:00"));

  assert.equal(replies.length, 1);
  assert.deepEqual(replies[0], {
    threadTs: "111.216",
    text: "야, 아직 내 마지막 질문에 답도 안 했잖아. 새로 시작 버튼 누른다고 기록이 리셋되는 줄 알았어? 딴소리하지 말고 그 스레드에서 지금 바로 답해.",
  });
});

test("!stop는 active 세션을 inactive로 바꾸고 inactive 세션은 그대로 둔다", async () => {
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

  const inactiveSession = await activeBot.handleControlInput("!stop", stoppedAt);
  const unchangedSession = await inactiveBot.handleControlInput("!stop", stoppedAt);

  assert.equal(inactiveSession.state, "inactive");
  assert.equal(unchangedSession.state, "inactive");
});

test("!stop는 열린 study만 stopped로 닫고 direct_qa는 열린 상태로 둔다", async () => {
  const store = createInMemoryStore();
  store.session = createStartedSession(new Date("2026-03-11T09:05:00+09:00"));
  store.threads.set(
    "111.300",
    createThreadState({
      slackThreadTs: "111.300",
      topicId: "event-loop",
      openedAt: new Date("2026-03-11T09:10:00+09:00"),
    }),
  );
  store.threads.set(
    "111.301",
    createThreadState({
      slackThreadTs: "111.301",
      topicId: null,
      kind: "direct_qa",
      openedAt: new Date("2026-03-11T09:20:00+09:00"),
    }),
  );

  const bot = new TutorBot({
    store,
    topics: [],
    llmRunner: createUnusedLlmRunner(),
    slackClient: createUnusedSlackClient(),
  });
  const stoppedAt = new Date("2026-03-11T10:00:00+09:00");

  const session = await bot.handleControlInput("!stop", stoppedAt);

  assert.equal(session.state, "inactive");
  assert.equal(store.threads.get("111.300")?.status, "stopped");
  assert.equal(store.threads.get("111.301")?.status, "open");
  assert.deepEqual(store.threads.get("111.300")?.closedAt, stoppedAt);
  assert.equal(store.threads.get("111.301")?.closedAt, null);
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
        return {
          text: "이 정도는 알겠지? TCP 3-way handshake 설명해봐.",
          codexSessionId: "study-session-1",
        };
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
  assert.equal(
    store.threads.get("111.222")?.lastAssistantPrompt,
    "이 정도는 알겠지? TCP 3-way handshake 설명해봐.",
  );
  assert.equal(
    store.threads.get("111.222")?.lastChallengePrompt,
    "이 정도는 알겠지? TCP 3-way handshake 설명해봐.",
  );
  assert.equal(store.threads.get("111.222")?.codexSessionId, "study-session-1");
});

test("저장된 토픽이 없고 due 복습도 없으면 topic task로 새 토픽을 생성해 출제한다", async () => {
  const store = createInMemoryStore();
  store.session = createStartedSession(new Date("2026-03-10T09:00:00+09:00"));
  const calls = [];
  const bot = new TutorBot({
    store,
    topics: [],
    llmRunner: {
      async runTask(type, payload) {
        calls.push({ type, payload });
        if (type === "topic") {
          return {
            topic: {
              id: "memory-model",
              title: "Memory Model",
              category: "language-runtime",
              promptSeed: "Explain what a memory model is and why it exists.",
              weight: 4,
            },
          };
        }
        if (type === "question") {
          return {
            text: "메모리 모델이 뭐야?",
          };
        }
        throw new Error(`unexpected task: ${type}`);
      },
    },
    slackClient: {
      async postDirectMessage() {
        return { channel: "D123", ts: "111.223" };
      },
      async postThreadReply() {
        throw new Error("should not be called");
      },
    },
  });

  await bot.dispatchNextQuestion(new Date("2026-03-10T09:05:00+09:00"));

  assert.deepEqual(calls.map(({ type }) => type), ["topic", "question"]);
  assert.equal(calls[1].payload.topic.id, "memory-model");
  assert.equal(calls[1].payload.topicMemory, null);
  assert.equal(store.topics.get("memory-model")?.title, "Memory Model");
  assert.equal(store.threads.get("111.223")?.topicId, "memory-model");
});

test("due 복습 토픽이 있으면 새 topic 생성 없이 기존 토픽을 우선 출제한다", async () => {
  const store = createInMemoryStore();
  store.session = createStartedSession(new Date("2026-03-10T09:00:00+09:00"));
  await store.saveTopic({
    id: "http-cache",
    title: "HTTP Cache",
    category: "network",
    promptSeed: "Explain ETag and Last-Modified.",
    weight: 3,
  });
  await store.saveTopicMemory("http-cache", {
    masteryScore: 0.2,
    attemptCount: 1,
    successCount: 0,
    failureCount: 1,
    lastOutcome: "blocked",
    lastMasteryKind: null,
    nextReviewAt: new Date("2026-03-10T09:00:00+09:00"),
    masteredStreak: 0,
  });
  await store.saveAttempt({
    threadTs: "history.1",
    topicId: "http-cache",
    answer: "ETag는 그냥 문자열",
    answerSummary: "검증 토큰의 의미를 설명하지 못함",
    misconceptionSummary: "ETag/If-None-Match 연동을 모름",
    attemptKind: "evaluation",
    outcome: "blocked",
    rationale: "캐시 재검증 흐름 미설명",
    recordedAt: new Date("2026-03-10T08:40:00+09:00"),
  });
  await store.saveTeachingMemory({
    topicId: "http-cache",
    threadTs: "teach.1",
    teachingSummary: "validator 기반 조건부 요청을 다시 설명함",
    challengeSummary: "If-None-Match 흐름을 단계별로 설명해봐.",
    createdAt: new Date("2026-03-10T08:45:00+09:00"),
  });

  const calls = [];
  const bot = new TutorBot({
    store,
    topics: [],
    llmRunner: {
      async runTask(type, payload) {
        calls.push({ type, payload });
        if (type === "question") {
          return {
            text: "ETag가 Last-Modified보다 더 정확한 경우를 설명해봐.",
          };
        }
        throw new Error(`unexpected task: ${type}`);
      },
    },
    slackClient: {
      async postDirectMessage() {
        return { channel: "D123", ts: "111.224" };
      },
      async postThreadReply() {
        throw new Error("should not be called");
      },
    },
  });

  await bot.dispatchNextQuestion(new Date("2026-03-10T09:05:00+09:00"));

  assert.deepEqual(calls.map(({ type }) => type), ["question"]);
  assert.equal(calls[0].payload.topic.id, "http-cache");
  assert.equal(calls[0].payload.topicMemory.lastOutcome, "blocked");
  assert.equal(calls[0].payload.recentAttempts.length, 1);
  assert.equal(
    calls[0].payload.recentAttempts[0].misconceptionSummary,
    "ETag/If-None-Match 연동을 모름",
  );
  assert.equal(calls[0].payload.latestTeachingMemory?.threadTs, "teach.1");
  assert.equal(store.threads.get("111.224")?.topicId, "http-cache");
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

test("기본 topic selector는 같은 사이클에서 가능한 한 다양한 토픽을 순환한다", async () => {
  const store = createInMemoryStore();
  store.session = createStartedSession(new Date("2026-03-10T09:00:00+09:00"));

  const askedTopicIds = [];
  let messageSeq = 0;
  const bot = new TutorBot({
    store,
    topics: [
      {
        id: "topic-a",
        title: "Topic A",
        category: "frontend",
        promptSeed: "A",
        weight: 5,
      },
      {
        id: "topic-b",
        title: "Topic B",
        category: "network",
        promptSeed: "B",
        weight: 5,
      },
      {
        id: "topic-c",
        title: "Topic C",
        category: "db",
        promptSeed: "C",
        weight: 5,
      },
    ],
    llmRunner: {
      async runTask(type, payload) {
        assert.equal(type, "question");
        askedTopicIds.push(payload.topic.id);
        return { text: `${payload.topic.id} 질문` };
      },
    },
    slackClient: {
      async postDirectMessage() {
        messageSeq += 1;
        return { channel: "D123", ts: `111.30${messageSeq}` };
      },
      async postThreadReply() {
        throw new Error("should not be called");
      },
    },
  });

  for (let index = 0; index < 3; index += 1) {
    const thread = await bot.dispatchNextQuestion(new Date(`2026-03-10T09:0${index}:00+09:00`));
    await store.saveThread({
      ...thread,
      status: "mastered",
      closedAt: new Date(`2026-03-10T09:0${index}:30+09:00`),
    });
  }

  assert.equal(new Set(askedTopicIds).size, 3);
});

test("new topic이 남아 있으면 같은 review topic을 연속으로 반복하지 않는다", async () => {
  const store = createInMemoryStore();
  store.session = createStartedSession(new Date("2026-03-10T09:00:00+09:00"));
  await store.saveTopic({
    id: "review-topic",
    title: "Review Topic",
    category: "network",
    promptSeed: "Explain TCP flow control.",
    weight: 3,
  });
  await store.saveTopic({
    id: "new-topic-1",
    title: "New Topic 1",
    category: "frontend",
    promptSeed: "Explain event loop.",
    weight: 3,
  });
  await store.saveTopic({
    id: "new-topic-2",
    title: "New Topic 2",
    category: "db",
    promptSeed: "Explain B-tree.",
    weight: 3,
  });
  await store.saveTopicMemory("review-topic", {
    learningState: "blocked",
    timesAsked: 1,
    timesBlocked: 1,
    timesRecovered: 0,
    timesMasteredClean: 0,
    timesMasteredRecovered: 0,
    lastOutcome: "blocked",
    nextReviewAt: new Date("2026-03-10T09:00:00+09:00"),
  });

  const askedTopicIds = [];
  let sequence = 0;
  const bot = new TutorBot({
    store,
    topics: [],
    random: () => 0.99,
    llmRunner: {
      async runTask(type, payload) {
        if (type === "question") {
          askedTopicIds.push(payload.topic.id);
          return { text: `${payload.topic.id} 질문` };
        }

        throw new Error(`unexpected task: ${type}`);
      },
    },
    slackClient: {
      async postDirectMessage() {
        sequence += 1;
        return { channel: "D123", ts: `111.7${sequence}` };
      },
      async postThreadReply() {
        throw new Error("should not be called");
      },
    },
  });

  const first = await bot.dispatchNextQuestion(new Date("2026-03-10T09:05:00+09:00"));
  await store.saveThread({
    ...first,
    status: "mastered",
    closedAt: new Date("2026-03-10T09:05:30+09:00"),
  });
  const second = await bot.dispatchNextQuestion(new Date("2026-03-10T09:06:00+09:00"));

  assert.equal(askedTopicIds[0], "review-topic");
  assert.notEqual(askedTopicIds[1], "review-topic");
  assert.equal(second?.topicId === "new-topic-1" || second?.topicId === "new-topic-2", true);
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
      openedAt: new Date("2026-03-10T09:04:30+09:00"),
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

test("열린 study 스레드가 무응답 상태로 오래 열려 있으면 새 DM 대신 스레드에 재촉을 한 번만 보낸다", async () => {
  const store = createInMemoryStore();
  store.session = createStartedSession(new Date("2026-03-10T09:00:00+09:00"));
  store.threads.set(
    "111.991",
    {
      ...createThreadState({
        slackThreadTs: "111.991",
        topicId: "event-loop",
        openedAt: new Date("2026-03-10T09:00:00+09:00"),
      }),
      awaitingUserReplyAt: new Date("2026-03-10T09:00:00+09:00"),
      lastUserReplyAt: null,
      reminderSentAt: null,
    },
  );

  const replies = [];
  const bot = new TutorBot({
    store,
    topics: [
      {
        id: "new-topic",
        title: "New Topic",
        category: "frontend",
        promptSeed: "Explain rendering pipeline.",
        weight: 3,
      },
    ],
    llmRunner: {
      async runTask() {
        throw new Error("should not be called");
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

  await bot.dispatchNextQuestion(new Date("2026-03-10T09:05:00+09:00"));

  assert.deepEqual(replies, [
    {
      threadTs: "111.991",
      text: "야, 아직 답 안 했잖아. 같은 질문에서 또 도망치지 말고 지금 스레드에서 바로 답해.",
    },
  ]);
  assert.equal(store.threads.get("111.991")?.reminderSentAt?.toISOString(), "2026-03-10T00:05:00.000Z");

  await bot.dispatchNextQuestion(new Date("2026-03-10T09:07:00+09:00"));
  assert.equal(replies.length, 1);
});

test("사용자 답변이 들어오면 reminder 상태를 초기화하고 같은 스레드 재대기 구간에서 다시 한 번 재촉할 수 있다", async () => {
  const store = createInMemoryStore();
  store.session = createStartedSession(new Date("2026-03-10T09:00:00+09:00"));
  store.threads.set(
    "111.992",
    {
      ...createThreadState({
        slackThreadTs: "111.992",
        topicId: "event-loop",
        openedAt: new Date("2026-03-10T09:00:00+09:00"),
      }),
      awaitingUserReplyAt: new Date("2026-03-10T09:00:00+09:00"),
      lastUserReplyAt: null,
      reminderSentAt: new Date("2026-03-10T09:03:00+09:00"),
      lastAssistantPrompt: "event loop 순서를 설명해봐.",
      lastChallengePrompt: "event loop 순서를 설명해봐.",
    },
  );

  const replies = [];
  const bot = new TutorBot({
    store,
    topics: [],
    llmRunner: {
      async runTask(type) {
        if (type === "evaluate") {
          return {
            outcome: "continue",
            rationale: "핵심 단계가 빠짐",
          };
        }
        if (type === "followup") {
          return {
            text: "좋아, 그럼 microtask checkpoint가 언제 도는지 다시 말해봐.",
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
    threadTs: "111.992",
    text: "task 끝나고 콜백이 돌아요",
    now: new Date("2026-03-10T09:04:00+09:00"),
  });
  assert.equal(store.threads.get("111.992")?.reminderSentAt, null);
  assert.equal(
    store.threads.get("111.992")?.awaitingUserReplyAt?.toISOString(),
    "2026-03-10T00:04:00.000Z",
  );

  await bot.dispatchNextQuestion(new Date("2026-03-10T09:07:00+09:00"));

  assert.deepEqual(replies, [
    {
      threadTs: "111.992",
      text: "좋아, 그럼 microtask checkpoint가 언제 도는지 다시 말해봐.",
    },
    {
      threadTs: "111.992",
      text: "야, 아직 답 안 했잖아. 같은 질문에서 또 도망치지 말고 지금 스레드에서 바로 답해.",
    },
  ]);
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
            answerSummary: "콜백 실행 시점은 말했지만 microtask drain 순서를 누락함",
            misconceptionSummary: "event loop 한 tick 안에서 microtask 우선순위를 혼동함",
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
  assert.equal(
    store.attempts[0].answerSummary,
    "콜백 실행 시점은 말했지만 microtask drain 순서를 누락함",
  );
  assert.equal(
    store.attempts[0].misconceptionSummary,
    "event loop 한 tick 안에서 microtask 우선순위를 혼동함",
  );
  assert.equal(store.attempts[0].attemptKind, "evaluation");
  assert.equal(store.memories.get("event-loop")?.learningState, "fuzzy");
  assert.equal(
    store.threads.get("111.222")?.lastAssistantPrompt,
    "좋아, 그럼 microtask queue가 언제 비워지는지 설명해봐.",
  );
  assert.equal(
    store.threads.get("111.222")?.lastChallengePrompt,
    "좋아, 그럼 microtask queue가 언제 비워지는지 설명해봐.",
  );
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
            challengePrompt: "좋아, 다시 간다. rAF 콜백 목록이 고정되는 시점을 단계로 설명해봐.",
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
  assert.equal(
    llmCalls[0].payload.lastAssistantPrompt,
    null,
  );
  assert.equal(
    llmCalls[1].payload.lastAssistantPrompt,
    null,
  );
  assert.deepEqual(replies, [
    {
      threadTs: "111.333",
      text: "지금 막힌 건 rAF 콜백 목록이 언제 확정되는지야. 그 단계부터 다시 잡아.",
    },
    {
      threadTs: "111.333",
      text: "좋아, 다시 간다. rAF 콜백 목록이 고정되는 시점을 단계로 설명해봐.",
    },
  ]);
  assert.equal(result.thread.status, "open");
  assert.equal(result.thread.blockedOnce, true);
  assert.equal(
    result.thread.lastAssistantPrompt,
    "지금 막힌 건 rAF 콜백 목록이 언제 확정되는지야. 그 단계부터 다시 잡아.",
  );
  assert.equal(
    result.thread.lastChallengePrompt,
    "좋아, 다시 간다. rAF 콜백 목록이 고정되는 시점을 단계로 설명해봐.",
  );
  assert.equal(store.attempts.at(-1)?.outcome, "blocked");
  assert.equal(store.memories.get("event-loop")?.learningState, "blocked");
  assert.equal(store.teachingMemories.length, 1);
  assert.equal(store.teachingMemories[0].topicId, "event-loop");
  assert.equal(
    store.teachingMemories[0].teachingSummary,
    "지금 막힌 건 rAF 콜백 목록이 언제 확정되는지야. 그 단계부터 다시 잡아.",
  );
  assert.equal(
    store.teachingMemories[0].challengeSummary,
    "좋아, 다시 간다. rAF 콜백 목록이 고정되는 시점을 단계로 설명해봐.",
  );
  assert.equal(result.shouldScheduleNextQuestion, false);
});

test("사용자가 명시적으로 막혔다고 하면 mastered 평가여도 blocked teaching 상태로 유지한다", async () => {
  const store = createInMemoryStore();
  store.threads.set(
    "111.334",
    createThreadState({
      slackThreadTs: "111.334",
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
            outcome: "mastered",
            rationale: "충분히 정확하다.",
            text: "흥, 이번엔 넘어간다.",
          };
        }

        if (type === "teach") {
          return {
            text: "좋아, 개념부터 다시 붙자. 이벤트 루프는 task를 하나 처리한 뒤 microtask를 모두 비우고 렌더 기회를 본다.",
            challengePrompt: "좋아, 다시. Promise.then이 setTimeout보다 먼저인 이유를 단계로 말해봐.",
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
    threadTs: "111.334",
    text: "나 잘 모르겠어.",
    now: new Date("2026-03-10T09:06:00+09:00"),
  });

  assert.deepEqual(llmCalls.map(({ type }) => type), [
    "evaluate",
    "teach",
  ]);
  assert.deepEqual(replies, [
    {
      threadTs: "111.334",
      text: "좋아, 개념부터 다시 붙자. 이벤트 루프는 task를 하나 처리한 뒤 microtask를 모두 비우고 렌더 기회를 본다.",
    },
    {
      threadTs: "111.334",
      text: "좋아, 다시. Promise.then이 setTimeout보다 먼저인 이유를 단계로 말해봐.",
    },
  ]);
  assert.equal(result.thread.status, "open");
  assert.equal(result.thread.blockedOnce, true);
  assert.equal(store.attempts.at(-1)?.outcome, "blocked");
  assert.equal(result.shouldScheduleNextQuestion, false);
});

test("counterquestion/teach/evaluate payload는 lastAssistantPrompt를 함께 넘긴다", async () => {
  const store = createInMemoryStore();
  store.threads.set(
    "111.888",
    createThreadState({
      slackThreadTs: "111.888",
      topicId: "event-loop",
      openedAt: new Date("2026-03-10T09:00:00+09:00"),
      lastAssistantPrompt: "process.nextTick이 Promise보다 먼저인 이유를 설명해봐.",
      lastChallengePrompt: "process.nextTick이 Promise보다 먼저인 이유를 설명해봐.",
    }),
  );
  const llmCalls = [];
  const bot = new TutorBot({
    store,
    topics: [],
    llmRunner: {
      async runTask(type, payload) {
        llmCalls.push({ type, payload });
        if (type === "answer_counterquestion") {
          return {
            text: "좋아, 그 질문 기준으로 설명한다.",
            resolved: true,
            codexSessionId: "study-session-2",
          };
        }
        if (type === "evaluate") {
          return {
            outcome: "blocked",
            rationale: "stuck",
            codexSessionId: "study-session-2",
          };
        }
        if (type === "teach") {
          return {
            text: "좋아, 지금 막힌 건 nextTick 우선순위야.",
            challengePrompt: "그럼 다시. nextTick이 Promise보다 먼저인 이유를 단계별로 설명해봐.",
            codexSessionId: "study-session-2",
          };
        }
        throw new Error(`unexpected task: ${type}`);
      },
    },
    slackClient: {
      async postDirectMessage() {
        throw new Error("should not be called");
      },
      async postThreadReply() {
        return { ok: true };
      },
    },
  });

  await bot.handleThreadMessage({
    threadTs: "111.888",
    text: "그건 왜인지 모르겠어?",
    now: new Date("2026-03-10T09:05:00+09:00"),
  });

  await bot.handleThreadMessage({
    threadTs: "111.888",
    text: "모르겠어",
    now: new Date("2026-03-10T09:06:00+09:00"),
  });

  assert.equal(llmCalls[0].type, "answer_counterquestion");
  assert.equal(
    llmCalls[0].payload.lastAssistantPrompt,
    "process.nextTick이 Promise보다 먼저인 이유를 설명해봐.",
  );
  assert.equal(llmCalls[0].payload.codexSessionId, null);
  assert.equal(llmCalls[1].type, "evaluate");
  assert.equal(
    llmCalls[1].payload.lastAssistantPrompt,
    "좋아, 그 질문 기준으로 설명한다.",
  );
  assert.equal(
    llmCalls[1].payload.lastChallengePrompt,
    "process.nextTick이 Promise보다 먼저인 이유를 설명해봐.",
  );
  assert.equal(llmCalls[1].payload.codexSessionId, "study-session-2");
  assert.equal(llmCalls[2].type, "teach");
  assert.equal(
    llmCalls[2].payload.lastAssistantPrompt,
    "좋아, 그 질문 기준으로 설명한다.",
  );
  assert.equal(
    llmCalls[2].payload.lastChallengePrompt,
    "process.nextTick이 Promise보다 먼저인 이유를 설명해봐.",
  );
  assert.equal(llmCalls[2].payload.codexSessionId, "study-session-2");
  assert.equal(store.threads.get("111.888")?.codexSessionId, "study-session-2");
  assert.equal(
    store.threads.get("111.888")?.lastChallengePrompt,
    "그럼 다시. nextTick이 Promise보다 먼저인 이유를 단계별로 설명해봐.",
  );
});

test("evaluate/followup/teach payload는 retrieval context를 함께 넘긴다", async () => {
  const store = createInMemoryStore();
  await store.saveTopicMemory("event-loop", {
    learningState: "fuzzy",
    timesAsked: 2,
    timesBlocked: 1,
    timesRecovered: 0,
    timesMasteredClean: 0,
    timesMasteredRecovered: 0,
    lastMisconceptionSummary: "microtask와 render 순서를 헷갈림",
    lastTeachingSummary: "rAF 이후 microtask checkpoint를 강조함",
    lastOutcome: "continue",
    nextReviewAt: null,
  });
  await store.saveAttempt({
    threadTs: "history.2",
    topicId: "event-loop",
    answer: "microtask가 뒤에 돈다",
    answerSummary: "순서 설명이 뒤집힘",
    misconceptionSummary: "microtask 우선 처리 규칙 누락",
    attemptKind: "evaluation",
    outcome: "continue",
    rationale: "핵심 순서 누락",
    recordedAt: new Date("2026-03-10T09:00:00+09:00"),
  });
  await store.saveTeachingMemory({
    topicId: "event-loop",
    threadTs: "teach.22",
    teachingSummary: "task 이후 microtask를 먼저 비운다고 설명함",
    challengeSummary: "Promise.then과 setTimeout(0) 순서를 다시 말해봐.",
    createdAt: new Date("2026-03-10T09:01:00+09:00"),
  });
  store.threads.set(
    "111.990",
    createThreadState({
      slackThreadTs: "111.990",
      topicId: "event-loop",
      openedAt: new Date("2026-03-10T09:02:00+09:00"),
      lastAssistantPrompt: "event loop 순서를 설명해봐.",
      lastChallengePrompt: "event loop 순서를 설명해봐.",
    }),
  );

  const llmCalls = [];
  const bot = new TutorBot({
    store,
    topics: [],
    llmRunner: {
      async runTask(type, payload) {
        llmCalls.push({ type, payload });
        if (type === "evaluate" && llmCalls.length === 1) {
          return {
            outcome: "continue",
            rationale: "설명이 모호함",
          };
        }
        if (type === "followup") {
          return {
            text: "좋아, 그럼 microtask가 render보다 먼저인 이유를 단계로 말해봐.",
          };
        }
        if (type === "evaluate" && llmCalls.length === 3) {
          return {
            outcome: "blocked",
            rationale: "핵심 개념 붕괴",
          };
        }
        if (type === "teach") {
          return {
            text: "좋아, microtask checkpoint부터 다시 잡자.",
            challengePrompt: "그럼 다시. Promise.then과 setTimeout(0) 순서를 설명해봐.",
          };
        }
        throw new Error(`unexpected task: ${type}`);
      },
    },
    slackClient: {
      async postDirectMessage() {
        throw new Error("should not be called");
      },
      async postThreadReply() {
        return { ok: true };
      },
    },
  });

  await bot.handleThreadMessage({
    threadTs: "111.990",
    text: "microtask가 나중에 돌아요",
    now: new Date("2026-03-10T09:03:00+09:00"),
  });
  await bot.handleThreadMessage({
    threadTs: "111.990",
    text: "잘 모르겠어",
    now: new Date("2026-03-10T09:04:00+09:00"),
  });

  const evaluatePayload = llmCalls[0].payload;
  const followupPayload = llmCalls[1].payload;
  const teachPayload = llmCalls[3].payload;
  assert.equal(evaluatePayload.topicMemory.learningState, "fuzzy");
  assert.equal(evaluatePayload.recentAttempts.length, 1);
  assert.equal(evaluatePayload.latestTeachingMemory?.threadTs, "teach.22");
  assert.equal(
    evaluatePayload.previousMisconceptionSummary,
    "microtask와 render 순서를 헷갈림",
  );
  assert.equal(
    evaluatePayload.previousTeachingSummary,
    "task 이후 microtask를 먼저 비운다고 설명함",
  );
  assert.equal(followupPayload.recentAttempts.length, 1);
  assert.equal(followupPayload.latestTeachingMemory?.threadTs, "teach.22");
  assert.equal(teachPayload.recentAttempts.length, 2);
  assert.equal(teachPayload.latestTeachingMemory?.threadTs, "teach.22");
  assert.equal(
    teachPayload.previousMisconceptionSummary,
    "microtask와 render 순서를 헷갈림",
  );
});

test("blocked teaching 이후 평가는 teach challengePrompt 기준으로 같은 지점을 다시 본다", async () => {
  const store = createInMemoryStore();
  store.threads.set(
    "111.889",
    createThreadState({
      slackThreadTs: "111.889",
      topicId: "event-loop",
      openedAt: new Date("2026-03-10T09:00:00+09:00"),
      lastAssistantPrompt: "requestAnimationFrame과 microtask checkpoint 순서를 설명해봐.",
      lastChallengePrompt: "requestAnimationFrame과 microtask checkpoint 순서를 설명해봐.",
    }),
  );

  const llmCalls = [];
  const replies = [];
  const bot = new TutorBot({
    store,
    topics: [],
    llmRunner: {
      async runTask(type, payload) {
        llmCalls.push({ type, payload });

        if (type === "evaluate" && llmCalls.length === 1) {
          return {
            outcome: "blocked",
            rationale: "메커니즘 누락",
          };
        }

        if (type === "teach") {
          return {
            text: "좋아, 핵심부터 다시. rAF 콜백 후 microtask checkpoint를 거쳐 렌더로 간다.",
            challengePrompt: "그럼 다시. rAF 콜백 안에서 Promise.then 등록 시 paint 전 순서를 말해봐.",
          };
        }

        if (type === "evaluate" && llmCalls.length === 3) {
          assert.equal(
            payload.lastChallengePrompt,
            "그럼 다시. rAF 콜백 안에서 Promise.then 등록 시 paint 전 순서를 말해봐.",
          );
          return {
            outcome: "continue",
            rationale: "핵심은 맞지만 단계 근거 부족",
          };
        }

        if (type === "followup") {
          return {
            text: "좋아, 그럼 같은 상황에서 setTimeout(0)은 왜 다음 task로 밀리는지 말해봐.",
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
    threadTs: "111.889",
    text: "잘 모르겠어.",
    now: new Date("2026-03-10T09:05:00+09:00"),
  });

  await bot.handleThreadMessage({
    threadTs: "111.889",
    text: "rAF 다음 microtask checkpoint가 먼저고 paint 전에 돈다.",
    now: new Date("2026-03-10T09:06:00+09:00"),
  });

  assert.deepEqual(llmCalls.map(({ type }) => type), [
    "evaluate",
    "teach",
    "evaluate",
    "followup",
  ]);
  assert.deepEqual(replies, [
    {
      threadTs: "111.889",
      text: "좋아, 핵심부터 다시. rAF 콜백 후 microtask checkpoint를 거쳐 렌더로 간다.",
    },
    {
      threadTs: "111.889",
      text: "그럼 다시. rAF 콜백 안에서 Promise.then 등록 시 paint 전 순서를 말해봐.",
    },
    {
      threadTs: "111.889",
      text: "좋아, 그럼 같은 상황에서 setTimeout(0)은 왜 다음 task로 밀리는지 말해봐.",
    },
  ]);
});

test("모호한 지시어 counterquestion도 직전 질문(lastAssistantPrompt)을 기준으로 답한다", async () => {
  const store = createInMemoryStore();
  store.threads.set(
    "111.777",
    createThreadState({
      slackThreadTs: "111.777",
      topicId: "event-loop",
      openedAt: new Date("2026-03-10T09:00:00+09:00"),
      lastAssistantPrompt: "process.nextTick이 Promise보다 먼저인 이유를 단계별로 설명해봐.",
    }),
  );

  const replies = [];
  const bot = new TutorBot({
    store,
    topics: [],
    llmRunner: {
      async runTask(type, payload) {
        if (type !== "answer_counterquestion") {
          throw new Error(`unexpected task: ${type}`);
        }

        assert.equal(
          payload.thread.lastAssistantPrompt,
          "process.nextTick이 Promise보다 먼저인 이유를 단계별로 설명해봐.",
        );
        return {
          text: "좋아, 그 질문 기준으로 설명한다. nextTick 큐를 먼저 비운 뒤 Promise microtask로 넘어간다.",
          resolved: true,
        };
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
    threadTs: "111.777",
    text: "그건 왜인지 모르겠어. 설명해줄래?",
    now: new Date("2026-03-10T09:06:00+09:00"),
  });

  assert.deepEqual(replies, [
    {
      threadTs: "111.777",
      text: "좋아, 그 질문 기준으로 설명한다. nextTick 큐를 먼저 비운 뒤 Promise microtask로 넘어간다.",
    },
  ]);
  assert.equal(result.thread.mode, "evaluation");
  assert.equal(
    result.thread.lastAssistantPrompt,
    "좋아, 그 질문 기준으로 설명한다. nextTick 큐를 먼저 비운 뒤 Promise microtask로 넘어간다.",
  );
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
      text: "...뭐야? 이걸 한 번에 이렇게 다 대답한다고? ...너 어디서 미리 답안지라도 외워왔어? 하, 착각하지 마. 이번 건 워낙 기초적인 거라 나도 대충 넘어가는 거니까. 우쭐대지 마. 다음엔 진짜 네 한계를 박살 내줄 테니까.",
    },
  ]);
  assert.equal(result.thread.status, "mastered");
  assert.equal(result.masteryKind, "clean");
  assert.equal(store.memories.get("rendering")?.lastMasteryKind, "clean");
  assert.equal(store.memories.get("rendering")?.learningState, "mastered_clean");
  assert.equal(store.memories.get("rendering")?.timesMasteredClean, 1);
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
      text: "이제야 겨우 알아듣네. 거봐, 내가 제대로 짚어주지 않았으면 넌 평생 그 얕은 논리에서 허우적대고 있었을 거 아냐. 넌 나 없으면 어떡할 뻔했냐? 오늘 내가 가르쳐준 거 머릿속에 꽉 박아둬. 잊어버리면 가만 안 둬.",
    },
  ]);
  assert.equal(result.thread.status, "mastered");
  assert.equal(result.masteryKind, "recovered");
  assert.equal(store.memories.get("btree")?.lastMasteryKind, "recovered");
  assert.equal(store.memories.get("btree")?.learningState, "mastered_recovered");
  assert.equal(store.memories.get("btree")?.timesRecovered, 1);
  assert.equal(store.memories.get("btree")?.timesMasteredRecovered, 1);
  assert.equal(result.shouldScheduleNextQuestion, true);
});

test("같은 topic에서 blocked 후 recovered mastery면 누적 카운터가 유지된다", async () => {
  const store = createInMemoryStore();
  store.threads.set(
    "111.666",
    createThreadState({
      slackThreadTs: "111.666",
      topicId: "event-loop",
      openedAt: new Date("2026-03-10T09:00:00+09:00"),
      blockedOnce: true,
    }),
  );

  const llmCalls = [];
  const bot = new TutorBot({
    store,
    topics: [],
    llmRunner: {
      async runTask(type) {
        llmCalls.push(type);
        if (type === "evaluate" && llmCalls.length === 1) {
          return {
            outcome: "blocked",
            rationale: "핵심 순서가 여전히 뒤섞임",
          };
        }

        if (type === "teach") {
          return {
            text: "좋아, 다시 정리한다.",
            challengePrompt: "다시. microtask checkpoint 순서를 설명해봐.",
          };
        }

        if (type === "evaluate" && llmCalls.length === 3) {
          return {
            outcome: "mastered",
            rationale: "순서를 정확히 교정함",
            text: "좋아, 이번엔 맞다.",
          };
        }

        throw new Error(`unexpected task: ${type}`);
      },
    },
    slackClient: {
      async postDirectMessage() {
        throw new Error("should not be called");
      },
      async postThreadReply() {
        return { ok: true };
      },
    },
  });

  await bot.handleThreadMessage({
    threadTs: "111.666",
    text: "모르겠어.",
    now: new Date("2026-03-10T09:06:00+09:00"),
  });
  await bot.handleThreadMessage({
    threadTs: "111.666",
    text: "task 끝난 뒤 microtask를 먼저 비운 다음 렌더 기회를 본다.",
    now: new Date("2026-03-10T09:10:00+09:00"),
  });

  const memory = store.memories.get("event-loop");
  assert.equal(memory?.timesBlocked, 1);
  assert.equal(memory?.timesRecovered, 1);
  assert.equal(memory?.timesMasteredRecovered, 1);
});

function createInMemoryStore() {
  return {
    session: null,
    threads: new Map(),
    memories: new Map(),
    topics: new Map(),
    attempts: [],
    teachingMemories: [],
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
    async getLatestIncompleteStudyThread() {
      const candidates = Array.from(this.threads.values())
        .filter((thread) => {
          if ((thread.kind ?? "study") !== "study") {
            return false;
          }

          return thread.status === "open" || thread.status === "stopped";
        })
        .sort((left, right) => {
          const leftClosed = (left.closedAt ?? left.openedAt).getTime();
          const rightClosed = (right.closedAt ?? right.openedAt).getTime();

          if (leftClosed !== rightClosed) {
            return rightClosed - leftClosed;
          }

          return right.openedAt.getTime() - left.openedAt.getTime();
        });
      return candidates[0] ?? null;
    },
    async getLatestIncompleteStudyThreadWithReplyState() {
      const thread = await this.getLatestIncompleteStudyThread();
      if (!thread) {
        return null;
      }

      return {
        thread,
        hasUserReply: Boolean(thread.lastUserReplyAt),
      };
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
    async listTopics() {
      return Array.from(this.topics.values());
    },
    async saveTopic(topic, now = new Date()) {
      this.topics.set(topic.id, {
        ...topic,
        createdAt: topic.createdAt ?? now,
        lastUsedAt: topic.lastUsedAt ?? null,
      });
    },
    async touchTopic(topicId, now = new Date()) {
      const current = this.topics.get(topicId);
      if (!current) {
        return;
      }
      this.topics.set(topicId, {
        ...current,
        lastUsedAt: now,
      });
    },
    async saveTopicMemory(topicId, memory) {
      this.memories.set(topicId, memory);
    },
    async saveAttempt(attempt) {
      this.attempts.push(attempt);
    },
    async listAttemptsByTopic(topicId, { limit = 5 } = {}) {
      return this.attempts
        .filter((attempt) => attempt.topicId === topicId)
        .slice(-limit)
        .reverse();
    },
    async saveTeachingMemory(teachingMemory) {
      this.teachingMemories.push(teachingMemory);
    },
    async getLatestTeachingMemory(topicId) {
      const matched = this.teachingMemories.filter((item) => item.topicId === topicId);
      return matched.at(-1) ?? null;
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
