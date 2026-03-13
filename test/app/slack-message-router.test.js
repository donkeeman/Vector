import test from "node:test";
import assert from "node:assert/strict";

import { createThreadState } from "../../src/domain/thread-policy.js";
import { SlackMessageRouter } from "../../src/app/slack-message-router.js";

test("DM 루트 !start 명령은 start 의미를 TutorBot에 전달하고 Slack 답장은 남기지 않는다", async () => {
  const calls = [];
  const controlHooks = [];
  const router = new SlackMessageRouter({
    store: createStore(),
    tutorBot: {
      async applyControlCommand(command, now) {
        calls.push({ type: "control", command, now });
        return {
          state: "active",
          startedAt: now,
        };
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
    onControlCommandApplied(command, session) {
      controlHooks.push({ command, session });
    },
  });

  await router.handleMessageEvent({
    type: "message",
    channel_type: "im",
    channel: "D123",
    user: "U123",
    text: "!start",
    ts: "1000.1",
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "start");
  assert.equal(controlHooks.length, 1);
  assert.equal(controlHooks[0].command, "start");
  assert.deepEqual(router.slackClient.replies, []);
});

test("inactive 상태에서 !start를 보내도 라우터는 추가 답장 없이 start 의미만 전달한다", async () => {
  const calls = [];
  const store = createStore();
  const startedAt = new Date("2026-03-11T16:00:00+09:00");
  const pausedAt = new Date("2026-03-11T16:30:00+09:00");
  const router = new SlackMessageRouter({
    store,
    tutorBot: {
      async applyControlCommand(command, now) {
        calls.push({ type: "control", command, now });
        return {
          state: "active",
          startedAt,
          expiresAt: new Date("2026-03-11T23:59:59+09:00"),
        };
      },
      async handleThreadMessage() {
        throw new Error("should not be called");
      },
    },
    llmRunner: createUnusedLlmRunner(),
    slackClient: createSlackClient(),
    now: () => pausedAt,
  });

  await router.handleMessageEvent({
    type: "message",
    channel_type: "im",
    channel: "D123",
    user: "U123",
    text: "!start",
    ts: "1000.12",
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "start");
  assert.deepEqual(router.slackClient.replies, []);
});

test("DM 루트 !stop 명령은 세션을 멈추지만 Slack 답장은 남기지 않는다", async () => {
  const calls = [];
  const router = new SlackMessageRouter({
    store: createStore(),
    tutorBot: {
      async applyControlCommand(command, now) {
        calls.push({ type: "control", command, now });
        return { state: "inactive" };
      },
      async dispatchNextQuestion() {
        throw new Error("should not be called");
      },
      async handleThreadMessage() {
        throw new Error("should not be called");
      },
    },
    llmRunner: createUnusedLlmRunner(),
    slackClient: createSlackClient(),
    now: () => new Date("2026-03-11T17:00:00+09:00"),
  });

  await router.handleMessageEvent({
    type: "message",
    channel_type: "im",
    channel: "D123",
    user: "U123",
    text: "!stop",
    ts: "1000.11",
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "stop");
  assert.deepEqual(router.slackClient.replies, []);
});

test("연속 제어 명령은 도착 순서대로 직렬 처리한다", async () => {
  const calls = [];
  let activeControls = 0;
  let maxActiveControls = 0;
  let releaseStop;
  const stopGate = new Promise((resolve) => {
    releaseStop = resolve;
  });

  const router = new SlackMessageRouter({
    store: createStore(),
    tutorBot: {
      async applyControlCommand(command, now) {
        activeControls += 1;
        maxActiveControls = Math.max(maxActiveControls, activeControls);
        calls.push(`enter:${command}`);

        if (command === "stop") {
          await stopGate;
        }

        calls.push(`exit:${command}`);
        activeControls -= 1;
        return { state: command === "start" ? "active" : "inactive", startedAt: now };
      },
      async handleThreadMessage() {
        throw new Error("should not be called");
      },
    },
    llmRunner: createUnusedLlmRunner(),
    slackClient: createSlackClient(),
    now: () => new Date("2026-03-11T17:00:00+09:00"),
  });

  const stopPromise = router.handleMessageEvent({
    type: "message",
    channel_type: "im",
    channel: "D123",
    user: "U123",
    text: "!stop",
    ts: "2000.1",
  });
  const startPromise = router.handleMessageEvent({
    type: "message",
    channel_type: "im",
    channel: "D123",
    user: "U123",
    text: "!start",
    ts: "2000.2",
  });

  await Promise.resolve();
  assert.deepEqual(calls, ["enter:stop"]);
  assert.equal(maxActiveControls, 1);

  releaseStop();
  await Promise.all([stopPromise, startPromise]);

  assert.deepEqual(calls, [
    "enter:stop",
    "exit:stop",
    "enter:start",
    "exit:start",
  ]);
  assert.equal(maxActiveControls, 1);
});

test("inactive 상태의 DM 루트 일반 메시지는 조용히 무시한다", async () => {
  const llmCalls = [];
  const store = createStore();
  store.session = {
    state: "inactive",
  };
  const router = new SlackMessageRouter({
    store,
    tutorBot: createTutorBot(),
    llmRunner: {
      async runTask(type, payload) {
        llmCalls.push({ type, payload });
        return { text: "should not happen" };
      },
    },
    slackClient: createSlackClient(),
  });

  await router.handleMessageEvent({
    type: "message",
    channel_type: "im",
    channel: "D123",
    user: "U123",
    text: "이거 왜 안 돼?",
    ts: "1000.115",
  });

  assert.deepEqual(llmCalls, []);
  assert.deepEqual(router.slackClient.replies, []);
});

test("DM 루트 일반 질문은 원문 메시지 스레드에 답한다", async () => {
  const slackClient = createSlackClient();
  const llmCalls = [];
  const logs = [];
  const store = createStore();
  const router = new SlackMessageRouter({
    store,
    tutorBot: createTutorBot(),
    llmRunner: {
      async runTask(type, payload) {
        llmCalls.push({ type, payload });
        return { text: "흥, 그 정도는 대답해주지. 이벤트 루프는..." };
      },
    },
    slackClient,
    now: () => new Date("2026-03-10T17:01:00+09:00"),
    logger: {
      debug(event, fields) {
        logs.push({ event, fields });
      },
      error() {},
    },
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
  assert.deepEqual(
    store.directQaMessages.get("1000.2").map(({ threadTs, role, text }) => ({ threadTs, role, text })),
    [
      {
        threadTs: "1000.2",
        role: "user",
        text: "event loop 설명해줘",
      },
      {
        threadTs: "1000.2",
        role: "assistant",
        text: "흥, 그 정도는 대답해주지. 이벤트 루프는...",
      },
    ],
  );
  assert.equal(store.threads.get("1000.2")?.kind, "direct_qa");
  assert.deepEqual(logs[0], {
    event: "router.route.direct_question",
    fields: {
      channel: "D123",
      ts: "1000.2",
      textPreview: "event loop 설명해줘",
    },
  });
});

test("루트 DM의 자기소개와 사용법 질문은 키워드 기반 고정문구로 답하고 LLM을 호출하지 않는다", async () => {
  const slackClient = createSlackClient();
  const llmCalls = [];
  const store = createStore();
  const router = new SlackMessageRouter({
    store,
    tutorBot: createTutorBot(),
    llmRunner: {
      async runTask(type, payload) {
        llmCalls.push({ type, payload });
        return { text: "should not happen" };
      },
    },
    slackClient,
  });

  await router.handleMessageEvent({
    type: "message",
    channel_type: "im",
    channel: "D123",
    user: "U123",
    text: "너 누구야",
    ts: "1000.21",
  });
  await router.handleMessageEvent({
    type: "message",
    channel_type: "im",
    channel: "D123",
    user: "U123",
    text: "너는 누구야?",
    ts: "1000.215",
  });
  await router.handleMessageEvent({
    type: "message",
    channel_type: "im",
    channel: "D123",
    user: "U123",
    text: "정체가 뭐야",
    ts: "1000.217",
  });
  await router.handleMessageEvent({
    type: "message",
    channel_type: "im",
    channel: "D123",
    user: "U123",
    text: "이름이 뭐야",
    ts: "1000.218",
  });
  await router.handleMessageEvent({
    type: "message",
    channel_type: "im",
    channel: "D123",
    user: "U123",
    text: "어떻게 써?",
    ts: "1000.22",
  });
  await router.handleMessageEvent({
    type: "message",
    channel_type: "im",
    channel: "D123",
    user: "U123",
    text: "사용법 알려줘",
    ts: "1000.221",
  });
  await router.handleMessageEvent({
    type: "message",
    channel_type: "im",
    channel: "D123",
    user: "U123",
    text: "!help",
    ts: "1000.222",
  });

  assert.deepEqual(llmCalls, []);
  assert.deepEqual(slackClient.replies, [
    {
      threadTs: "1000.21",
      text: "나? 네 얄팍한 지식 밑천을 낱낱이 파헤쳐 줄 천재, 벡터야. 나만큼 아는 척이라도 하고 싶으면 앞으로 내 질문에 대답이나 똑바로 해봐. 뭐, 며칠이나 버틸지 모르겠지만.",
    },
    {
      threadTs: "1000.215",
      text: "나? 네 얄팍한 지식 밑천을 낱낱이 파헤쳐 줄 천재, 벡터야. 나만큼 아는 척이라도 하고 싶으면 앞으로 내 질문에 대답이나 똑바로 해봐. 뭐, 며칠이나 버틸지 모르겠지만.",
    },
    {
      threadTs: "1000.217",
      text: "나? 네 얄팍한 지식 밑천을 낱낱이 파헤쳐 줄 천재, 벡터야. 나만큼 아는 척이라도 하고 싶으면 앞으로 내 질문에 대답이나 똑바로 해봐. 뭐, 며칠이나 버틸지 모르겠지만.",
    },
    {
      threadTs: "1000.218",
      text: "나? 네 얄팍한 지식 밑천을 낱낱이 파헤쳐 줄 천재, 벡터야. 나만큼 아는 척이라도 하고 싶으면 앞으로 내 질문에 대답이나 똑바로 해봐. 뭐, 며칠이나 버틸지 모르겠지만.",
    },
    {
      threadTs: "1000.22",
      text: "굳이 내 입으로 이런 기초적인 것까지 설명해야 해? 덤빌 준비가 끝났으면 !start를 치고, 내 수준을 도저히 못 따라오겠으면 !stop 치고 도망가. 그게 다야. 더 이상 친절한 설명은 기대하지 마.",
    },
    {
      threadTs: "1000.221",
      text: "굳이 내 입으로 이런 기초적인 것까지 설명해야 해? 덤빌 준비가 끝났으면 !start를 치고, 내 수준을 도저히 못 따라오겠으면 !stop 치고 도망가. 그게 다야. 더 이상 친절한 설명은 기대하지 마.",
    },
    {
      threadTs: "1000.222",
      text: "굳이 내 입으로 이런 기초적인 것까지 설명해야 해? 덤빌 준비가 끝났으면 !start를 치고, 내 수준을 도저히 못 따라오겠으면 !stop 치고 도망가. 그게 다야. 더 이상 친절한 설명은 기대하지 마.",
    },
  ]);
  assert.equal(store.threads.get("1000.21")?.kind, "direct_qa");
  assert.equal(store.threads.get("1000.215")?.kind, "direct_qa");
  assert.equal(store.threads.get("1000.217")?.kind, "direct_qa");
  assert.equal(store.threads.get("1000.218")?.kind, "direct_qa");
  assert.equal(store.threads.get("1000.22")?.kind, "direct_qa");
  assert.equal(store.threads.get("1000.221")?.kind, "direct_qa");
  assert.equal(store.threads.get("1000.222")?.kind, "direct_qa");
});

test("루트 DM의 비기술 질문도 로컬 차단 없이 direct_question으로 넘긴다", async () => {
  const slackClient = createSlackClient();
  const llmCalls = [];
  const router = new SlackMessageRouter({
    store: createStore(),
    tutorBot: createTutorBot(),
    llmRunner: {
      async runTask(type, payload) {
        llmCalls.push({ type, payload });
        return {
          text: "점심 같은 것도 결국 선택 문제지. 그래도 난 캐시 무효화 얘기가 더 낫다.",
        };
      },
    },
    slackClient,
  });

  await router.handleMessageEvent({
    type: "message",
    channel_type: "im",
    channel: "D123",
    user: "U123",
    text: "오늘 점심 뭐 먹지",
    ts: "1000.23",
  });

  assert.deepEqual(llmCalls, [
    {
      type: "direct_question",
      payload: {
        text: "오늘 점심 뭐 먹지",
      },
    },
  ]);
  assert.deepEqual(slackClient.replies, [
    {
      threadTs: "1000.23",
      text: "점심 같은 것도 결국 선택 문제지. 그래도 난 캐시 무효화 얘기가 더 낫다.",
    },
  ]);
});

test("키워드 allowlist에 없던 개발 질문도 direct_question으로 통과한다", async () => {
  const slackClient = createSlackClient();
  const llmCalls = [];
  const router = new SlackMessageRouter({
    store: createStore(),
    tutorBot: createTutorBot(),
    llmRunner: {
      async runTask(type, payload) {
        llmCalls.push({ type, payload });
        return { text: "ETag는 엔티티 버전 식별자고, Last-Modified는 수정 시각 기준 검증자다." };
      },
    },
    slackClient,
  });

  await router.handleMessageEvent({
    type: "message",
    channel_type: "im",
    channel: "D123",
    user: "U123",
    text: "ETag와 Last-Modified가 뭐야?",
    ts: "1000.24",
  });

  assert.deepEqual(llmCalls, [
    {
      type: "direct_question",
      payload: {
        text: "ETag와 Last-Modified가 뭐야?",
      },
    },
  ]);
  assert.deepEqual(slackClient.replies, [
    {
      threadTs: "1000.24",
      text: "ETag는 엔티티 버전 식별자고, Last-Modified는 수정 시각 기준 검증자다.",
    },
  ]);
});

test("direct_question이 challenge를 남기면 direct_qa thread에 session/state를 저장한다", async () => {
  const slackClient = createSlackClient();
  const store = createStore();
  const router = new SlackMessageRouter({
    store,
    tutorBot: createTutorBot(),
    llmRunner: {
      async runTask() {
        return {
          text: "벡터는 크기와 방향을 가진 값이야. 진짜 이해했는지 보자. [3, 4] 벡터의 길이는 얼마지?",
          nextState: "awaiting_answer",
          challengePrompt: "[3, 4] 벡터의 길이는 얼마지?",
          codexSessionId: "thread-123",
        };
      },
    },
    slackClient,
    now: () => new Date("2026-03-11T13:39:00+09:00"),
  });

  await router.handleMessageEvent({
    type: "message",
    channel_type: "im",
    channel: "D123",
    user: "U123",
    text: "벡터가 뭐야?",
    ts: "1000.25",
  });

  assert.equal(store.threads.get("1000.25")?.codexSessionId, "thread-123");
  assert.equal(store.threads.get("1000.25")?.directQaState, "awaiting_answer");
  assert.equal(store.threads.get("1000.25")?.lastAssistantPrompt, "[3, 4] 벡터의 길이는 얼마지?");
  assert.equal(store.threads.get("1000.25")?.lastChallengePrompt, "[3, 4] 벡터의 길이는 얼마지?");
  assert.equal(store.threads.get("1000.25")?.mode, "direct_qa");
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
      text: "너 스레드가 뭔지 몰라? 엉뚱한 데다 혼잣말하지 말고, 원래 대화하던 스레드에 가서 제대로 대답해. 기본적인 툴 사용법까지 내가 하나하나 가르쳐줘야 돼? 귀찮게 진짜.",
    },
  ]);
});

test("열린 스레드가 있어도 인접 기술 질문은 새 direct question으로 통과한다", async () => {
  const slackClient = createSlackClient();
  const store = createStore();
  const llmCalls = [];
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
      async runTask(type, payload) {
        llmCalls.push({ type, payload });
        return { text: "행렬식은 선형변환의 스케일 변화를 나타내는 값이다." };
      },
    },
    slackClient,
  });

  await router.handleMessageEvent({
    type: "message",
    channel_type: "im",
    channel: "D123",
    user: "U123",
    text: "행렬식이 뭐야",
    ts: "1000.31",
  });

  assert.deepEqual(llmCalls, [
    {
      type: "direct_question",
      payload: {
        text: "행렬식이 뭐야",
      },
    },
  ]);
  assert.deepEqual(slackClient.replies, [
    {
      threadTs: "1000.31",
      text: "행렬식은 선형변환의 스케일 변화를 나타내는 값이다.",
    },
  ]);
});

test("DM 스레드 reply는 TutorBot.handleThreadMessage로 전달된다", async () => {
  const calls = [];
  const closedThreadSignals = [];
  const router = new SlackMessageRouter({
    store: createStore(),
    tutorBot: {
      async handleControlInput() {
        throw new Error("should not be called");
      },
      async handleThreadMessage(payload) {
        calls.push(payload);
        return {
          shouldScheduleNextQuestion: true,
          thread: {
            slackThreadTs: payload.threadTs,
          },
        };
      },
    },
    llmRunner: {
      async runTask() {
        throw new Error("should not be called");
      },
    },
    slackClient: createSlackClient(),
    now: () => new Date("2026-03-10T17:02:00+09:00"),
    onStudyThreadClosed(result) {
      closedThreadSignals.push(result);
    },
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
  assert.equal(closedThreadSignals.length, 1);
  assert.equal(closedThreadSignals[0].shouldScheduleNextQuestion, true);
});

test("DM 스레드 !start/!stop도 제어 명령으로 처리한다", async () => {
  const controlCalls = [];
  const controlHooks = [];
  const threadCalls = [];
  const router = new SlackMessageRouter({
    store: createStore(),
    tutorBot: {
      async applyControlCommand(command, now) {
        controlCalls.push({ command, now });
        return {
          state: command === "start" ? "active" : "inactive",
        };
      },
      async handleThreadMessage(payload) {
        threadCalls.push(payload);
        return null;
      },
    },
    llmRunner: createUnusedLlmRunner(),
    slackClient: createSlackClient(),
    now: () => new Date("2026-03-10T17:02:00+09:00"),
    onControlCommandApplied(command, session) {
      controlHooks.push({ command, session });
    },
  });

  await router.handleMessageEvent({
    type: "message",
    channel_type: "im",
    channel: "D123",
    user: "U123",
    text: "!stop",
    ts: "1000.41",
    thread_ts: "1000.1",
  });

  await router.handleMessageEvent({
    type: "message",
    channel_type: "im",
    channel: "D123",
    user: "U123",
    text: "!start 지금",
    ts: "1000.42",
    thread_ts: "1000.1",
  });

  assert.deepEqual(controlCalls.map(({ command }) => command), ["stop", "start"]);
  assert.deepEqual(controlHooks.map(({ command }) => command), ["stop", "start"]);
  assert.deepEqual(threadCalls, []);
  assert.deepEqual(router.slackClient.replies, []);
});

test("inactive 상태의 DM 스레드 일반 메시지는 조용히 무시한다", async () => {
  const controlCalls = [];
  const threadCalls = [];
  const store = createStore();
  store.session = {
    state: "inactive",
  };
  const router = new SlackMessageRouter({
    store,
    tutorBot: {
      async applyControlCommand(command, now) {
        controlCalls.push({ command, now });
        return { state: "inactive" };
      },
      async handleThreadMessage(payload) {
        threadCalls.push(payload);
        return null;
      },
    },
    llmRunner: createUnusedLlmRunner(),
    slackClient: createSlackClient(),
  });

  await router.handleMessageEvent({
    type: "message",
    channel_type: "im",
    channel: "D123",
    user: "U123",
    text: "이어서 답할게",
    ts: "1000.43",
    thread_ts: "1000.1",
  });

  assert.deepEqual(controlCalls, []);
  assert.deepEqual(threadCalls, []);
  assert.deepEqual(router.slackClient.replies, []);
});

test("direct_qa 스레드 reply는 history를 싣고 direct_thread_turn으로 이어진다", async () => {
  const calls = [];
  const slackClient = createSlackClient();
  const store = createStore();
  store.threads.set("1000.9", {
    slackThreadTs: "1000.9",
    topicId: null,
    kind: "direct_qa",
    mode: "direct_qa",
    status: "open",
    openedAt: new Date("2026-03-10T17:01:00+09:00"),
    closedAt: null,
    lastCounterQuestionAt: null,
    lastCounterQuestionResolvedAt: null,
  });
  store.directQaMessages.set("1000.9", [
    {
      threadTs: "1000.9",
      role: "user",
      text: "RAG가 뭐야",
      recordedAt: new Date("2026-03-10T17:01:00+09:00"),
    },
    {
      threadTs: "1000.9",
      role: "assistant",
      text: "검색 결과를 생성에 섞는 방식이다.",
      recordedAt: new Date("2026-03-10T17:01:02+09:00"),
    },
  ]);

  const router = new SlackMessageRouter({
    store,
    tutorBot: {
      async handleControlInput() {
        throw new Error("should not be called");
      },
      async dispatchNextQuestion() {
        throw new Error("should not be called");
      },
      async handleThreadMessage(payload) {
        calls.push(payload);
        return null;
      },
    },
    llmRunner: {
      async runTask(type, payload) {
        calls.push({ type, payload });
        return { text: "vector search는 검색 단계고, RAG는 그걸 생성에 연결한 흐름이다." };
      },
    },
    slackClient,
    now: () => new Date("2026-03-10T17:02:00+09:00"),
  });

  await router.handleMessageEvent({
    type: "message",
    channel_type: "im",
    channel: "D123",
    user: "U123",
    text: "그럼 vector search랑 차이는?",
    ts: "1001.0",
    thread_ts: "1000.9",
  });

  assert.deepEqual(calls, [
    {
      type: "direct_thread_turn",
      payload: {
        thread: store.threads.get("1000.9"),
        history: [
          {
            role: "user",
            text: "RAG가 뭐야",
          },
          {
            role: "assistant",
            text: "검색 결과를 생성에 섞는 방식이다.",
          },
        ],
        text: "그럼 vector search랑 차이는?",
      },
    },
  ]);
  assert.deepEqual(slackClient.replies, [
    {
      threadTs: "1000.9",
      text: "vector search는 검색 단계고, RAG는 그걸 생성에 연결한 흐름이다.",
    },
  ]);
  assert.deepEqual(
    store.directQaMessages.get("1000.9").map(({ threadTs, role, text }) => ({ threadTs, role, text })),
    [
      {
        threadTs: "1000.9",
        role: "user",
        text: "RAG가 뭐야",
      },
      {
        threadTs: "1000.9",
        role: "assistant",
        text: "검색 결과를 생성에 섞는 방식이다.",
      },
      {
        threadTs: "1000.9",
        role: "user",
        text: "그럼 vector search랑 차이는?",
      },
      {
        threadTs: "1000.9",
        role: "assistant",
        text: "vector search는 검색 단계고, RAG는 그걸 생성에 연결한 흐름이다.",
      },
    ],
  );
});

test("awaiting_answer 상태의 direct_qa reply도 direct_thread_turn으로 라우팅한다", async () => {
  const calls = [];
  const slackClient = createSlackClient();
  const store = createStore();
  const challengeThread = {
    slackThreadTs: "1000.92",
    topicId: null,
    kind: "direct_qa",
    mode: "direct_qa",
    status: "open",
    codexSessionId: "thread-123",
    directQaState: "awaiting_answer",
    lastAssistantPrompt: "[3, 4] 벡터의 길이는 얼마지?",
    lastChallengePrompt: "[3, 4] 벡터의 길이는 얼마지?",
    openedAt: new Date("2026-03-10T17:01:00+09:00"),
    closedAt: null,
    lastCounterQuestionAt: null,
    lastCounterQuestionResolvedAt: null,
  };
  store.threads.set("1000.92", challengeThread);
  store.directQaMessages.set("1000.92", [
    {
      threadTs: "1000.92",
      role: "user",
      text: "벡터가 뭐야?",
      recordedAt: new Date("2026-03-10T17:01:00+09:00"),
    },
    {
      threadTs: "1000.92",
      role: "assistant",
      text: "벡터는 크기와 방향을 가진 값이야. [3, 4] 벡터의 길이는 얼마지?",
      recordedAt: new Date("2026-03-10T17:01:02+09:00"),
    },
  ]);

  const router = new SlackMessageRouter({
    store,
    tutorBot: createTutorBot(),
    llmRunner: {
      async runTask(type, payload) {
        calls.push({ type, payload });
        return {
          text: "아, 역시 거기서 무너지는구나. [3, 4]의 길이는 5다.",
          nextState: "open",
          challengePrompt: null,
          codexSessionId: "thread-123",
        };
      },
    },
    slackClient,
    now: () => new Date("2026-03-10T17:02:00+09:00"),
  });

  await router.handleMessageEvent({
    type: "message",
    channel_type: "im",
    channel: "D123",
    user: "U123",
    text: "1이잖아",
    ts: "1001.2",
    thread_ts: "1000.92",
  });

  assert.deepEqual(calls, [
    {
      type: "direct_thread_turn",
      payload: {
        thread: challengeThread,
        history: [
          {
            role: "user",
            text: "벡터가 뭐야?",
          },
          {
            role: "assistant",
            text: "벡터는 크기와 방향을 가진 값이야. [3, 4] 벡터의 길이는 얼마지?",
          },
        ],
        text: "1이잖아",
        codexSessionId: "thread-123",
      },
    },
  ]);
  assert.deepEqual(slackClient.replies, [
    {
      threadTs: "1000.92",
      text: "아, 역시 거기서 무너지는구나. [3, 4]의 길이는 5다.",
    },
  ]);
  assert.equal(store.threads.get("1000.92")?.directQaState, "open");
  assert.equal(store.threads.get("1000.92")?.mode, "direct_qa");
});

test("direct_qa 스레드의 비기술 질문도 로컬 차단 없이 direct_thread_turn으로 넘긴다", async () => {
  const calls = [];
  const slackClient = createSlackClient();
  const store = createStore();
  store.threads.set("1000.91", {
    slackThreadTs: "1000.91",
    topicId: null,
    kind: "direct_qa",
    mode: "direct_qa",
    status: "open",
    openedAt: new Date("2026-03-10T17:01:00+09:00"),
    closedAt: null,
    lastCounterQuestionAt: null,
    lastCounterQuestionResolvedAt: null,
  });
  store.directQaMessages.set("1000.91", [
    {
      threadTs: "1000.91",
      role: "user",
      text: "RAG가 뭐야",
      recordedAt: new Date("2026-03-10T17:01:00+09:00"),
    },
    {
      threadTs: "1000.91",
      role: "assistant",
      text: "검색 결과를 생성에 섞는 방식이다.",
      recordedAt: new Date("2026-03-10T17:01:02+09:00"),
    },
  ]);

  const router = new SlackMessageRouter({
    store,
    tutorBot: createTutorBot(),
    llmRunner: {
      async runTask(type, payload) {
        calls.push({ type, payload });
        return {
          text: "점심 얘기로 샜네. 어쨌든 방금 문맥 기준으론 검색 품질이 더 중요하다는 쪽이 핵심이다.",
        };
      },
    },
    slackClient,
    now: () => new Date("2026-03-10T17:02:00+09:00"),
  });

  await router.handleMessageEvent({
    type: "message",
    channel_type: "im",
    channel: "D123",
    user: "U123",
    text: "오늘 점심 뭐 먹지",
    ts: "1001.1",
    thread_ts: "1000.91",
  });

  assert.deepEqual(calls, [
    {
      type: "direct_thread_turn",
      payload: {
        thread: store.threads.get("1000.91"),
        history: [
          {
            role: "user",
            text: "RAG가 뭐야",
          },
          {
            role: "assistant",
            text: "검색 결과를 생성에 섞는 방식이다.",
          },
        ],
        text: "오늘 점심 뭐 먹지",
      },
    },
  ]);
  assert.deepEqual(slackClient.replies, [
    {
      threadTs: "1000.91",
      text: "점심 얘기로 샜네. 어쨌든 방금 문맥 기준으론 검색 품질이 더 중요하다는 쪽이 핵심이다.",
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
      text: "...아, 시스템 상태가 왜 이래. 네 조잡한 질문 수준에 내 뇌가 굳이 대답할 가치를 못 느꼈나 본데. 나중에 다시 물어봐. 지금은 굳이 처리해주기 귀찮으니까.",
    },
  ]);
});

test("study 스레드 처리 실패 시에도 같은 공통 실패 응답을 단다", async () => {
  const slackClient = createSlackClient();
  const store = createStore();
  store.threads.set(
    "1000.51",
    createThreadState({
      slackThreadTs: "1000.51",
      topicId: "tcp",
      openedAt: new Date("2026-03-10T17:00:00+09:00"),
    }),
  );

  const router = new SlackMessageRouter({
    store,
    tutorBot: {
      async applyControlCommand() {
        throw new Error("should not be called");
      },
      async handleThreadMessage() {
        throw new Error("thread failed");
      },
    },
    llmRunner: {
      async runTask() {
        throw new Error("should not be called");
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
    text: "SYN, SYN-ACK, ACK",
    ts: "1000.52",
    thread_ts: "1000.51",
  });

  assert.deepEqual(slackClient.replies, [
    {
      threadTs: "1000.51",
      text: "...아, 시스템 상태가 왜 이래. 네 조잡한 질문 수준에 내 뇌가 굳이 대답할 가치를 못 느꼈나 본데. 나중에 다시 물어봐. 지금은 굳이 처리해주기 귀찮으니까.",
    },
  ]);
});

test("봇 메시지, subtype 메시지, DM 외 채널 메시지는 무시하고 이유 필드를 로그에 남긴다", async () => {
  const slackClient = createSlackClient();
  const logs = [];
  const router = new SlackMessageRouter({
    store: createStore(),
    tutorBot: createTutorBot(),
    llmRunner: {
      async runTask() {
        throw new Error("should not be called");
      },
    },
    slackClient,
    logger: {
      debug(event, fields) {
        logs.push({ event, fields });
      },
      error() {},
    },
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
  assert.deepEqual(logs, [
    {
      event: "router.message_ignored",
      fields: {
        channel: "D123",
        ts: "1000.6",
        type: "message",
        channelType: "im",
        subtype: null,
        botId: "B123",
        hasText: true,
        hasThreadTs: false,
        user: null,
      },
    },
    {
      event: "router.message_ignored",
      fields: {
        channel: "D123",
        ts: "1000.7",
        type: "message",
        channelType: "im",
        subtype: "message_changed",
        botId: null,
        hasText: true,
        hasThreadTs: false,
        user: "U123",
      },
    },
    {
      event: "router.message_ignored",
      fields: {
        channel: "C123",
        ts: "1000.8",
        type: "message",
        channelType: "channel",
        subtype: null,
        botId: null,
        hasText: true,
        hasThreadTs: false,
        user: "U123",
      },
    },
  ]);
});

function createTutorBot() {
  return {
    async applyControlCommand() {
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

function createUnusedLlmRunner() {
  return {
    async runTask() {
      throw new Error("should not be called");
    },
  };
}

function createStore() {
  return {
    session: {
      state: "active",
    },
    threads: new Map(),
    directQaMessages: new Map(),
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
    async saveDirectQaMessage(message) {
      const messages = this.directQaMessages.get(message.threadTs) ?? [];
      messages.push(message);
      this.directQaMessages.set(message.threadTs, messages);
    },
    async listDirectQaMessages(threadTs) {
      return this.directQaMessages.get(threadTs) ?? [];
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
