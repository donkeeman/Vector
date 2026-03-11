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
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("sqlite store는 blockedOnce와 lastMasteryKind를 저장하고 읽는다", async () => {
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
      masteryScore: 0.65,
      attemptCount: 4,
      successCount: 2,
      failureCount: 2,
      lastOutcome: "mastered",
      lastMasteryKind: "recovered",
      nextReviewAt: new Date("2026-03-13T09:00:00+09:00"),
      masteredStreak: 1,
    });

    const thread = await store.getThread("3000.1");
    const memory = await store.getTopicMemory("event-loop");

    assert.equal(thread.blockedOnce, true);
    assert.equal(memory.lastMasteryKind, "recovered");
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
      masteryScore: 0.4,
      attemptCount: 2,
      successCount: 1,
      failureCount: 1,
      lastOutcome: "continue",
      lastMasteryKind: null,
      nextReviewAt: null,
      masteredStreak: 0,
    });

    const memory = await store.getTopicMemory("cache");
    assert.equal(memory.lastMasteryKind, null);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
