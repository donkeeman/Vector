import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { SqliteStore } from "../../src/storage/sqlite-store.js";

const execFileAsync = promisify(execFile);

test("sqlite store는 direct_qa thread와 message history를 저장하고 읽는다", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "vector-store-"));
  const databasePath = join(tempDir, "vector.sqlite");
  const store = new SqliteStore({ databasePath });
  const now = new Date("2026-03-11T20:00:00+09:00");

  try {
    await store.init();
    await store.saveThread({
      slackThreadTs: "2000.1",
      topicId: null,
      kind: "direct_qa",
      mode: "direct_qa",
      status: "open",
      openedAt: now,
      closedAt: null,
      lastCounterQuestionAt: null,
      lastCounterQuestionResolvedAt: null,
      codexSessionId: "codex-thread-1",
      directQaState: "open",
      lastAssistantPrompt: "벡터가 뭐야?",
      lastChallengePrompt: "[3, 4] 벡터의 길이는 얼마지?",
    });
    await store.saveDirectQaMessage({
      threadTs: "2000.1",
      role: "user",
      text: "RAG가 뭐야",
      recordedAt: now,
    });

    const thread = await store.getThread("2000.1");
    const history = await store.listDirectQaMessages("2000.1");

    assert.equal(thread.kind, "direct_qa");
    assert.equal(thread.mode, "direct_qa");
    assert.equal(thread.codexSessionId, "codex-thread-1");
    assert.equal(thread.directQaState, "open");
    assert.equal(thread.lastAssistantPrompt, "벡터가 뭐야?");
    assert.equal(thread.lastChallengePrompt, "[3, 4] 벡터의 길이는 얼마지?");
    assert.equal(thread.blockedOnce, false);
    assert.deepEqual(
      history.map(({ threadTs, role, text }) => ({ threadTs, role, text })),
      [
        {
          threadTs: "2000.1",
          role: "user",
          text: "RAG가 뭐야",
        },
      ],
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("sqlite store는 kind 없는 기존 thread row를 study로 읽는다", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "vector-store-"));
  const databasePath = join(tempDir, "legacy.sqlite");
  const store = new SqliteStore({ databasePath });

  try {
    await execFileAsync("sqlite3", [databasePath, `
      CREATE TABLE threads (
        slack_thread_ts TEXT PRIMARY KEY,
        topic_id TEXT NOT NULL,
        status TEXT NOT NULL,
        mode TEXT NOT NULL,
        opened_at TEXT NOT NULL,
        closed_at TEXT,
        last_counter_question_at TEXT,
        last_counter_question_resolved_at TEXT
      );
      INSERT INTO threads (
        slack_thread_ts,
        topic_id,
        status,
        mode,
        opened_at
      ) VALUES (
        'legacy.1',
        'event-loop',
        'open',
        'evaluation',
        '2026-03-11T10:00:00.000Z'
      );
    `]);

    await store.init();
    const thread = await store.getThread("legacy.1");

    assert.equal(thread.kind, "study");
    assert.equal(thread.blockedOnce, false);
    assert.equal(thread.lastChallengePrompt, null);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("sqlite store는 blockedOnce와 recovered learningState를 저장하고 읽는다", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "vector-store-"));
  const databasePath = join(tempDir, "recovery.sqlite");
  const store = new SqliteStore({ databasePath });
  const now = new Date("2026-03-11T20:00:00+09:00");

  try {
    await store.init();
    await store.saveThread({
      slackThreadTs: "3000.1",
      topicId: "event-loop",
      kind: "study",
      mode: "evaluation",
      status: "open",
      openedAt: now,
      closedAt: null,
      lastCounterQuestionAt: null,
      lastCounterQuestionResolvedAt: null,
      blockedOnce: true,
      codexSessionId: null,
      directQaState: null,
      lastAssistantPrompt: null,
    });
    await store.saveTopicMemory("event-loop", {
      learningState: "mastered_recovered",
      timesAsked: 4,
      timesBlocked: 2,
      timesRecovered: 1,
      timesMasteredClean: 1,
      timesMasteredRecovered: 1,
      lastOutcome: "mastered",
      nextReviewAt: new Date("2026-03-13T09:00:00+09:00"),
      masteredStreak: 1,
    });

    const thread = await store.getThread("3000.1");
    const memory = await store.getTopicMemory("event-loop");

    assert.equal(thread.blockedOnce, true);
    assert.equal(memory.learningState, "mastered_recovered");
    assert.equal("lastMasteryKind" in memory, false);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("sqlite store는 가장 최근 incomplete study 스레드 하나를 재개 대상으로 조회한다", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "vector-store-"));
  const databasePath = join(tempDir, "resume.sqlite");
  const store = new SqliteStore({ databasePath });

  try {
    await store.init();
    await store.saveThread({
      slackThreadTs: "resume.1",
      topicId: "event-loop",
      kind: "study",
      mode: "evaluation",
      status: "stopped",
      openedAt: new Date("2026-03-11T10:00:00.000Z"),
      closedAt: new Date("2026-03-11T10:10:00.000Z"),
      lastCounterQuestionAt: null,
      lastCounterQuestionResolvedAt: null,
      blockedOnce: false,
      codexSessionId: null,
      directQaState: null,
      lastAssistantPrompt: "microtask checkpoint를 설명해봐.",
      lastChallengePrompt: "microtask checkpoint를 설명해봐.",
    });
    await store.saveThread({
      slackThreadTs: "resume.2",
      topicId: "rendering",
      kind: "study",
      mode: "evaluation",
      status: "stopped",
      openedAt: new Date("2026-03-11T10:05:00.000Z"),
      closedAt: new Date("2026-03-11T10:20:00.000Z"),
      lastCounterQuestionAt: null,
      lastCounterQuestionResolvedAt: null,
      blockedOnce: false,
      codexSessionId: null,
      directQaState: null,
      lastAssistantPrompt: "layout과 paint 차이를 설명해봐.",
      lastChallengePrompt: "layout과 paint 차이를 설명해봐.",
    });
    await store.saveThread({
      slackThreadTs: "resume.3",
      topicId: "cache",
      kind: "study",
      mode: "evaluation",
      status: "open",
      openedAt: new Date("2026-03-11T10:25:00.000Z"),
      closedAt: null,
      lastCounterQuestionAt: null,
      lastCounterQuestionResolvedAt: null,
      blockedOnce: false,
      codexSessionId: null,
      directQaState: null,
      lastAssistantPrompt: "ETag와 Last-Modified 차이를 설명해봐.",
      lastChallengePrompt: "ETag와 Last-Modified 차이를 설명해봐.",
    });
    await store.saveThread({
      slackThreadTs: "resume.4",
      topicId: null,
      kind: "direct_qa",
      mode: "direct_qa",
      status: "stopped",
      openedAt: new Date("2026-03-11T10:06:00.000Z"),
      closedAt: new Date("2026-03-11T10:30:00.000Z"),
      lastCounterQuestionAt: null,
      lastCounterQuestionResolvedAt: null,
      blockedOnce: false,
      codexSessionId: null,
      directQaState: "open",
      lastAssistantPrompt: "RAG가 뭐야?",
      lastChallengePrompt: "RAG가 뭐야?",
    });

    const thread = await store.getLatestIncompleteStudyThread();

    assert.equal(thread?.slackThreadTs, "resume.3");
    assert.equal(thread?.kind, "study");
    assert.equal(thread?.status, "open");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("sqlite store는 blocked status로 saveThread해도 open으로 정규화해 저장한다", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "vector-store-"));
  const databasePath = join(tempDir, "blocked-normalize.sqlite");
  const store = new SqliteStore({ databasePath });

  try {
    await store.init();
    await store.saveThread({
      slackThreadTs: "blocked.normalize.1",
      topicId: "event-loop",
      kind: "study",
      mode: "evaluation",
      status: "blocked",
      openedAt: new Date("2026-03-11T10:00:00.000Z"),
      closedAt: new Date("2026-03-11T10:02:00.000Z"),
      lastCounterQuestionAt: null,
      lastCounterQuestionResolvedAt: null,
      blockedOnce: true,
      codexSessionId: null,
      directQaState: null,
      lastAssistantPrompt: "event loop 설명해봐.",
      lastChallengePrompt: "event loop 설명해봐.",
    });

    const thread = await store.getThread("blocked.normalize.1");
    const rows = await execFileAsync("sqlite3", ["-json", databasePath, `
      SELECT status, closed_at
      FROM threads
      WHERE slack_thread_ts = 'blocked.normalize.1';
    `]);
    const persisted = JSON.parse(rows.stdout)[0];

    assert.equal(thread.status, "open");
    assert.equal(thread.closedAt, null);
    assert.equal(persisted.status, "open");
    assert.equal(persisted.closed_at, null);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("sqlite store는 topic catalog를 저장/조회하고 last_used_at을 갱신한다", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "vector-store-"));
  const databasePath = join(tempDir, "topic-catalog.sqlite");
  const store = new SqliteStore({ databasePath });
  const now = new Date("2026-03-12T14:50:00+09:00");

  try {
    await store.init();
    await store.saveTopic({
      id: "memory-model",
      title: "Memory Model",
      category: "language-runtime",
      promptSeed: "Explain what a memory model is and why it exists.",
      weight: 4,
    }, now);

    const listed = await store.listTopics();
    assert.equal(listed.length, 1);
    assert.equal(listed[0].id, "memory-model");
    assert.equal(listed[0].title, "Memory Model");
    assert.equal(listed[0].category, "language-runtime");
    assert.equal(listed[0].weight, 4);

    const touchedAt = new Date("2026-03-12T15:00:00+09:00");
    await store.touchTopic("memory-model", touchedAt);
    const refreshed = await store.listTopics();
    assert.equal(
      refreshed[0].lastUsedAt?.toISOString(),
      touchedAt.toISOString(),
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("sqlite store는 last_mastery_kind가 없는 기존 topic_memory에도 마이그레이션을 적용한다", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "vector-store-"));
  const databasePath = join(tempDir, "legacy-memory.sqlite");
  const store = new SqliteStore({ databasePath });

  try {
    await execFileAsync("sqlite3", [databasePath, `
      CREATE TABLE topic_memory (
        topic_id TEXT PRIMARY KEY,
        mastery_score REAL NOT NULL,
        attempt_count INTEGER NOT NULL,
        success_count INTEGER NOT NULL,
        failure_count INTEGER NOT NULL,
        last_outcome TEXT,
        next_review_at TEXT,
        mastered_streak INTEGER NOT NULL
      );
      CREATE TABLE threads (
        slack_thread_ts TEXT PRIMARY KEY,
        topic_id TEXT NOT NULL,
        status TEXT NOT NULL,
        mode TEXT NOT NULL,
        opened_at TEXT NOT NULL,
        closed_at TEXT,
        last_counter_question_at TEXT,
        last_counter_question_resolved_at TEXT
      );
    `]);

    await store.init();
    await store.saveTopicMemory("cache", {
      learningState: "fuzzy",
      timesAsked: 2,
      timesBlocked: 1,
      timesRecovered: 0,
      timesMasteredClean: 1,
      timesMasteredRecovered: 0,
      lastOutcome: "continue",
      nextReviewAt: null,
      masteredStreak: 0,
    });

    const memory = await store.getTopicMemory("cache");
    assert.equal(memory.learningState, "fuzzy");
    assert.equal("lastMasteryKind" in memory, false);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("sqlite store는 structured topic_memory 필드를 저장/복원한다", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "vector-store-"));
  const databasePath = join(tempDir, "structured-topic-memory.sqlite");
  const store = new SqliteStore({ databasePath });
  const now = new Date("2026-03-13T14:10:00+09:00");

  try {
    await store.init();
    await store.saveTopicMemory("event-loop", {
      learningState: "blocked",
      timesAsked: 3,
      timesBlocked: 2,
      timesRecovered: 1,
      timesMasteredClean: 0,
      timesMasteredRecovered: 1,
      lastMisconceptionSummary: "call stack과 task queue 순서를 뒤집어 설명함",
      lastTeachingSummary: "microtask checkpoint와 macrotask 전환 지점을 재설명함",
      lastAskedAt: new Date("2026-03-13T13:40:00+09:00"),
      lastAnsweredAt: now,
      lastOutcome: "blocked",
      nextReviewAt: new Date("2026-03-14T10:00:00+09:00"),
    });

    const memory = await store.getTopicMemory("event-loop");
    assert.equal(memory.learningState, "blocked");
    assert.equal(memory.timesAsked, 3);
    assert.equal(memory.timesBlocked, 2);
    assert.equal(memory.timesRecovered, 1);
    assert.equal(memory.timesMasteredClean, 0);
    assert.equal(memory.timesMasteredRecovered, 1);
    assert.equal(
      memory.lastMisconceptionSummary,
      "call stack과 task queue 순서를 뒤집어 설명함",
    );
    assert.equal(
      memory.lastTeachingSummary,
      "microtask checkpoint와 macrotask 전환 지점을 재설명함",
    );
    assert.equal(
      memory.lastAskedAt?.toISOString(),
      "2026-03-13T04:40:00.000Z",
    );
    assert.equal(memory.lastAnsweredAt?.toISOString(), now.toISOString());
    assert.equal(memory.nextReviewAt?.toISOString(), "2026-03-14T01:00:00.000Z");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("sqlite store는 retrieval용 attempt memory를 저장/복원한다", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "vector-store-"));
  const databasePath = join(tempDir, "attempt-memory.sqlite");
  const store = new SqliteStore({ databasePath });
  const recordedAt = new Date("2026-03-13T15:00:00+09:00");

  try {
    await store.init();
    await store.saveAttempt({
      threadTs: "attempt.1",
      topicId: "cache",
      answer: "ETag는 서버가 임의 문자열을 내려주는 거",
      answerSummary: "ETag 의미를 캐시 검증 토큰으로 연결하지 못함",
      misconceptionSummary: "strong/weak validator 구분을 모름",
      attemptKind: "evaluation",
      outcome: "blocked",
      rationale: "검증 헤더의 의미와 재검증 흐름을 설명하지 못함",
      recordedAt,
    });

    const attempts = await store.listAttemptsByTopic("cache", { limit: 5 });
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0].attemptKind, "evaluation");
    assert.equal(
      attempts[0].answerSummary,
      "ETag 의미를 캐시 검증 토큰으로 연결하지 못함",
    );
    assert.equal(
      attempts[0].misconceptionSummary,
      "strong/weak validator 구분을 모름",
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("sqlite store는 teaching_memory를 저장하고 최신 항목을 조회한다", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "vector-store-"));
  const databasePath = join(tempDir, "teaching-memory.sqlite");
  const store = new SqliteStore({ databasePath });

  try {
    await store.init();
    await store.saveTeachingMemory({
      topicId: "event-loop",
      threadTs: "teach.1",
      teachingSummary: "microtask는 macrotask 종료 직후 drain된다고 설명함",
      challengeSummary: "Promise.then과 setTimeout(0) 순서를 다시 말해봐",
      createdAt: new Date("2026-03-13T15:10:00+09:00"),
    });
    await store.saveTeachingMemory({
      topicId: "event-loop",
      threadTs: "teach.2",
      teachingSummary: "render step 이전에 microtask가 비워진다는 점을 강조함",
      challengeSummary: "render blocking 시나리오에서 순서를 다시 설명해봐",
      createdAt: new Date("2026-03-13T15:20:00+09:00"),
    });

    const latest = await store.getLatestTeachingMemory("event-loop");
    assert.equal(latest?.topicId, "event-loop");
    assert.equal(latest?.threadTs, "teach.2");
    assert.equal(
      latest?.teachingSummary,
      "render step 이전에 microtask가 비워진다는 점을 강조함",
    );
    assert.equal(
      latest?.challengeSummary,
      "render blocking 시나리오에서 순서를 다시 설명해봐",
    );
    assert.equal(latest?.createdAt.toISOString(), "2026-03-13T06:20:00.000Z");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("sqlite store는 unanswered/re-reminder thread 메타데이터를 저장/복원한다", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "vector-store-"));
  const databasePath = join(tempDir, "thread-reminder.sqlite");
  const store = new SqliteStore({ databasePath });

  try {
    await store.init();
    await store.saveThread({
      slackThreadTs: "thread.meta.1",
      topicId: "event-loop",
      kind: "study",
      mode: "evaluation",
      status: "open",
      openedAt: new Date("2026-03-13T15:00:00+09:00"),
      closedAt: null,
      lastCounterQuestionAt: null,
      lastCounterQuestionResolvedAt: null,
      blockedOnce: false,
      codexSessionId: null,
      directQaState: null,
      lastAssistantPrompt: "event loop를 설명해봐.",
      lastChallengePrompt: "event loop를 설명해봐.",
      awaitingUserReplyAt: new Date("2026-03-13T15:01:00+09:00"),
      lastUserReplyAt: new Date("2026-03-13T15:05:00+09:00"),
      reminderSentAt: new Date("2026-03-13T15:08:00+09:00"),
    });

    const thread = await store.getThread("thread.meta.1");
    assert.equal(
      thread.awaitingUserReplyAt?.toISOString(),
      "2026-03-13T06:01:00.000Z",
    );
    assert.equal(
      thread.lastUserReplyAt?.toISOString(),
      "2026-03-13T06:05:00.000Z",
    );
    assert.equal(
      thread.reminderSentAt?.toISOString(),
      "2026-03-13T06:08:00.000Z",
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
