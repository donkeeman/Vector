import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { createInactiveSession } from "../domain/session-policy.js";

const execFileAsync = promisify(execFile);

export class SqliteStore {
  constructor({ databasePath }) {
    this.databasePath = databasePath;
  }

  async init() {
    await mkdir(dirname(this.databasePath), { recursive: true });

    await this.#execute(`
      CREATE TABLE IF NOT EXISTS session_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        state TEXT NOT NULL,
        started_at TEXT,
        paused_at TEXT,
        ended_at TEXT,
        expires_at TEXT
      );

      CREATE TABLE IF NOT EXISTS topic_memory (
        topic_id TEXT PRIMARY KEY,
        mastery_score REAL NOT NULL,
        attempt_count INTEGER NOT NULL,
        success_count INTEGER NOT NULL,
        failure_count INTEGER NOT NULL,
        last_outcome TEXT,
        next_review_at TEXT,
        mastered_streak INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS threads (
        slack_thread_ts TEXT PRIMARY KEY,
        topic_id TEXT NOT NULL,
        status TEXT NOT NULL,
        mode TEXT NOT NULL,
        opened_at TEXT NOT NULL,
        closed_at TEXT,
        last_counter_question_at TEXT,
        last_counter_question_resolved_at TEXT
      );

      CREATE TABLE IF NOT EXISTS attempts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_ts TEXT NOT NULL,
        topic_id TEXT NOT NULL,
        answer TEXT NOT NULL,
        outcome TEXT NOT NULL,
        rationale TEXT,
        recorded_at TEXT NOT NULL
      );
    `);
  }

  async getSession() {
    const rows = await this.#query("SELECT * FROM session_state WHERE id = 1;");
    const row = rows[0];

    if (!row) {
      return createInactiveSession();
    }

    return {
      state: row.state,
      startedAt: parseNullableDate(row.started_at),
      pausedAt: parseNullableDate(row.paused_at),
      endedAt: parseNullableDate(row.ended_at),
      expiresAt: parseNullableDate(row.expires_at),
    };
  }

  async saveSession(session) {
    await this.#execute(`
      INSERT INTO session_state (id, state, started_at, paused_at, ended_at, expires_at)
      VALUES (
        1,
        ${toSqlString(session.state)},
        ${toSqlDate(session.startedAt)},
        ${toSqlDate(session.pausedAt)},
        ${toSqlDate(session.endedAt)},
        ${toSqlDate(session.expiresAt)}
      )
      ON CONFLICT(id) DO UPDATE SET
        state = excluded.state,
        started_at = excluded.started_at,
        paused_at = excluded.paused_at,
        ended_at = excluded.ended_at,
        expires_at = excluded.expires_at;
    `);
  }

  async listOpenThreads() {
    const rows = await this.#query("SELECT * FROM threads WHERE status = 'open';");
    return rows.map(mapThreadRow);
  }

  async getThread(threadTs) {
    const rows = await this.#query(
      `SELECT * FROM threads WHERE slack_thread_ts = ${toSqlString(threadTs)};`,
    );
    return rows[0] ? mapThreadRow(rows[0]) : null;
  }

  async saveThread(thread) {
    await this.#execute(`
      INSERT INTO threads (
        slack_thread_ts,
        topic_id,
        status,
        mode,
        opened_at,
        closed_at,
        last_counter_question_at,
        last_counter_question_resolved_at
      ) VALUES (
        ${toSqlString(thread.slackThreadTs)},
        ${toSqlString(thread.topicId)},
        ${toSqlString(thread.status)},
        ${toSqlString(thread.mode)},
        ${toSqlDate(thread.openedAt)},
        ${toSqlDate(thread.closedAt)},
        ${toSqlDate(thread.lastCounterQuestionAt)},
        ${toSqlDate(thread.lastCounterQuestionResolvedAt)}
      )
      ON CONFLICT(slack_thread_ts) DO UPDATE SET
        topic_id = excluded.topic_id,
        status = excluded.status,
        mode = excluded.mode,
        opened_at = excluded.opened_at,
        closed_at = excluded.closed_at,
        last_counter_question_at = excluded.last_counter_question_at,
        last_counter_question_resolved_at = excluded.last_counter_question_resolved_at;
    `);
  }

  async getTopicMemories() {
    const rows = await this.#query("SELECT * FROM topic_memory;");
    return new Map(rows.map((row) => [row.topic_id, mapMemoryRow(row)]));
  }

  async getTopicMemory(topicId) {
    const rows = await this.#query(
      `SELECT * FROM topic_memory WHERE topic_id = ${toSqlString(topicId)};`,
    );
    return rows[0] ? mapMemoryRow(rows[0]) : null;
  }

  async saveTopicMemory(topicId, memory) {
    await this.#execute(`
      INSERT INTO topic_memory (
        topic_id,
        mastery_score,
        attempt_count,
        success_count,
        failure_count,
        last_outcome,
        next_review_at,
        mastered_streak
      ) VALUES (
        ${toSqlString(topicId)},
        ${memory.masteryScore},
        ${memory.attemptCount},
        ${memory.successCount},
        ${memory.failureCount},
        ${toSqlString(memory.lastOutcome)},
        ${toSqlDate(memory.nextReviewAt)},
        ${memory.masteredStreak}
      )
      ON CONFLICT(topic_id) DO UPDATE SET
        mastery_score = excluded.mastery_score,
        attempt_count = excluded.attempt_count,
        success_count = excluded.success_count,
        failure_count = excluded.failure_count,
        last_outcome = excluded.last_outcome,
        next_review_at = excluded.next_review_at,
        mastered_streak = excluded.mastered_streak;
    `);
  }

  async saveAttempt(attempt) {
    await this.#execute(`
      INSERT INTO attempts (
        thread_ts,
        topic_id,
        answer,
        outcome,
        rationale,
        recorded_at
      ) VALUES (
        ${toSqlString(attempt.threadTs)},
        ${toSqlString(attempt.topicId)},
        ${toSqlString(attempt.answer)},
        ${toSqlString(attempt.outcome)},
        ${toSqlString(attempt.rationale)},
        ${toSqlDate(attempt.recordedAt)}
      );
    `);
  }

  async #query(sql) {
    const { stdout } = await execFileAsync("sqlite3", ["-json", this.databasePath, sql], {
      maxBuffer: 1024 * 1024 * 4,
    });

    if (!stdout.trim()) {
      return [];
    }

    return JSON.parse(stdout);
  }

  async #execute(sql) {
    await execFileAsync("sqlite3", [this.databasePath, sql], {
      maxBuffer: 1024 * 1024 * 4,
    });
  }
}

function parseNullableDate(value) {
  return value ? new Date(value) : null;
}

function toSqlDate(value) {
  return value ? toSqlString(value.toISOString()) : "NULL";
}

function toSqlString(value) {
  if (value === null || value === undefined) {
    return "NULL";
  }

  return `'${String(value).replaceAll("'", "''")}'`;
}

function mapThreadRow(row) {
  return {
    slackThreadTs: row.slack_thread_ts,
    topicId: row.topic_id,
    status: row.status,
    mode: row.mode,
    openedAt: new Date(row.opened_at),
    closedAt: parseNullableDate(row.closed_at),
    lastCounterQuestionAt: parseNullableDate(row.last_counter_question_at),
    lastCounterQuestionResolvedAt: parseNullableDate(row.last_counter_question_resolved_at),
  };
}

function mapMemoryRow(row) {
  return {
    masteryScore: row.mastery_score,
    attemptCount: row.attempt_count,
    successCount: row.success_count,
    failureCount: row.failure_count,
    lastOutcome: row.last_outcome,
    nextReviewAt: parseNullableDate(row.next_review_at),
    masteredStreak: row.mastered_streak,
  };
}
