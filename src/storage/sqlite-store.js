import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { createInactiveSession } from "../domain/session-policy.js";

const execFileAsync = promisify(execFile);
const DIRECT_QA_TOPIC_SENTINEL = "__direct_qa__";

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
        expires_at TEXT
      );

      CREATE TABLE IF NOT EXISTS topic_memory (
        topic_id TEXT PRIMARY KEY,
        learning_state TEXT NOT NULL DEFAULT 'new',
        times_asked INTEGER NOT NULL DEFAULT 0,
        times_blocked INTEGER NOT NULL DEFAULT 0,
        times_recovered INTEGER NOT NULL DEFAULT 0,
        times_mastered_clean INTEGER NOT NULL DEFAULT 0,
        times_mastered_recovered INTEGER NOT NULL DEFAULT 0,
        last_misconception_summary TEXT,
        last_teaching_summary TEXT,
        last_asked_at TEXT,
        last_answered_at TEXT,
        mastery_score REAL NOT NULL,
        attempt_count INTEGER NOT NULL,
        success_count INTEGER NOT NULL,
        failure_count INTEGER NOT NULL,
        last_outcome TEXT,
        last_mastery_kind TEXT,
        next_review_at TEXT,
        mastered_streak INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS topic_catalog (
        topic_id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        category TEXT NOT NULL,
        prompt_seed TEXT NOT NULL,
        weight INTEGER NOT NULL DEFAULT 3,
        created_at TEXT NOT NULL,
        last_used_at TEXT
      );

      CREATE TABLE IF NOT EXISTS threads (
        slack_thread_ts TEXT PRIMARY KEY,
        topic_id TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'study',
        status TEXT NOT NULL,
        mode TEXT NOT NULL,
        codex_session_id TEXT,
        direct_qa_state TEXT,
        last_assistant_prompt TEXT,
        last_challenge_prompt TEXT,
        blocked_once INTEGER NOT NULL DEFAULT 0,
        awaiting_user_reply_at TEXT,
        last_user_reply_at TEXT,
        reminder_sent_at TEXT,
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
        answer_summary TEXT,
        misconception_summary TEXT,
        attempt_kind TEXT,
        outcome TEXT NOT NULL,
        rationale TEXT,
        recorded_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS teaching_memory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        topic_id TEXT NOT NULL,
        thread_ts TEXT NOT NULL,
        teaching_summary TEXT NOT NULL,
        challenge_summary TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS direct_qa_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_ts TEXT NOT NULL,
        role TEXT NOT NULL,
        text TEXT NOT NULL,
        recorded_at TEXT NOT NULL
      );
    `);

    await this.#ensureThreadColumns();
    await this.#ensureTopicMemoryColumns();
    await this.#ensureAttemptColumns();
  }

  async getSession() {
    const rows = await this.#query(`
      SELECT state, started_at, expires_at
      FROM session_state
      WHERE id = 1;
    `);
    const row = rows[0];

    if (!row) {
      return createInactiveSession();
    }

    return {
      state: row.state,
      startedAt: parseNullableDate(row.started_at),
      expiresAt: parseNullableDate(row.expires_at),
    };
  }

  async saveSession(session) {
    await this.#execute(`
      INSERT INTO session_state (id, state, started_at, expires_at)
      VALUES (
        1,
        ${toSqlString(session.state)},
        ${toSqlDate(session.startedAt)},
        ${toSqlDate(session.expiresAt)}
      )
      ON CONFLICT(id) DO UPDATE SET
        state = excluded.state,
        started_at = excluded.started_at,
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

  async getLatestIncompleteStudyThread() {
    const rows = await this.#query(`
      SELECT *
      FROM threads
      WHERE status IN ('open', 'stopped')
        AND kind = 'study'
      ORDER BY COALESCE(closed_at, opened_at) DESC, opened_at DESC
      LIMIT 1;
    `);
    return rows[0] ? mapThreadRow(rows[0]) : null;
  }

  async saveThread(thread) {
    const normalizedStatus = normalizeThreadStatusForPersistence(thread.status);
    const normalizedClosedAt = normalizedStatus === "open" ? null : thread.closedAt;

    await this.#execute(`
      INSERT INTO threads (
        slack_thread_ts,
        topic_id,
        kind,
        status,
        mode,
        codex_session_id,
        direct_qa_state,
        last_assistant_prompt,
        last_challenge_prompt,
        blocked_once,
        awaiting_user_reply_at,
        last_user_reply_at,
        reminder_sent_at,
        opened_at,
        closed_at,
        last_counter_question_at,
        last_counter_question_resolved_at
      ) VALUES (
        ${toSqlString(thread.slackThreadTs)},
        ${toSqlString(toStoredTopicId(thread.topicId))},
        ${toSqlString(thread.kind ?? "study")},
        ${toSqlString(normalizedStatus)},
        ${toSqlString(thread.mode)},
        ${toSqlString(thread.codexSessionId)},
        ${toSqlString(thread.directQaState)},
        ${toSqlString(thread.lastAssistantPrompt)},
        ${toSqlString(thread.lastChallengePrompt)},
        ${toSqlInteger(thread.blockedOnce)},
        ${toSqlDate(thread.awaitingUserReplyAt)},
        ${toSqlDate(thread.lastUserReplyAt)},
        ${toSqlDate(thread.reminderSentAt)},
        ${toSqlDate(thread.openedAt)},
        ${toSqlDate(normalizedClosedAt)},
        ${toSqlDate(thread.lastCounterQuestionAt)},
        ${toSqlDate(thread.lastCounterQuestionResolvedAt)}
      )
      ON CONFLICT(slack_thread_ts) DO UPDATE SET
        topic_id = excluded.topic_id,
        kind = excluded.kind,
        status = excluded.status,
        mode = excluded.mode,
        codex_session_id = excluded.codex_session_id,
        direct_qa_state = excluded.direct_qa_state,
        last_assistant_prompt = excluded.last_assistant_prompt,
        last_challenge_prompt = excluded.last_challenge_prompt,
        blocked_once = excluded.blocked_once,
        awaiting_user_reply_at = excluded.awaiting_user_reply_at,
        last_user_reply_at = excluded.last_user_reply_at,
        reminder_sent_at = excluded.reminder_sent_at,
        opened_at = excluded.opened_at,
        closed_at = excluded.closed_at,
        last_counter_question_at = excluded.last_counter_question_at,
        last_counter_question_resolved_at = excluded.last_counter_question_resolved_at;
    `);
  }

  async listDirectQaMessages(threadTs) {
    const rows = await this.#query(
      `SELECT * FROM direct_qa_messages WHERE thread_ts = ${toSqlString(threadTs)} ORDER BY id ASC;`,
    );
    return rows.map((row) => ({
      threadTs: row.thread_ts,
      role: row.role,
      text: row.text,
      recordedAt: new Date(row.recorded_at),
    }));
  }

  async saveDirectQaMessage(message) {
    await this.#execute(`
      INSERT INTO direct_qa_messages (
        thread_ts,
        role,
        text,
        recorded_at
      ) VALUES (
        ${toSqlString(message.threadTs)},
        ${toSqlString(message.role)},
        ${toSqlString(message.text)},
        ${toSqlDate(message.recordedAt)}
      );
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

  async listTopics() {
    const rows = await this.#query("SELECT * FROM topic_catalog ORDER BY created_at ASC;");
    return rows.map(mapTopicRow);
  }

  async saveTopic(topic, now = new Date()) {
    const parsedWeight = Number(topic.weight ?? 3);
    const weight = Number.isFinite(parsedWeight)
      ? Math.max(1, Math.round(parsedWeight))
      : 3;

    await this.#execute(`
      INSERT INTO topic_catalog (
        topic_id,
        title,
        category,
        prompt_seed,
        weight,
        created_at,
        last_used_at
      ) VALUES (
        ${toSqlString(topic.id)},
        ${toSqlString(topic.title)},
        ${toSqlString(topic.category ?? "general")},
        ${toSqlString(topic.promptSeed)},
        ${weight},
        ${toSqlDate(topic.createdAt ?? now)},
        ${toSqlDate(topic.lastUsedAt ?? null)}
      )
      ON CONFLICT(topic_id) DO UPDATE SET
        title = excluded.title,
        category = excluded.category,
        prompt_seed = excluded.prompt_seed,
        weight = excluded.weight;
    `);
  }

  async touchTopic(topicId, now = new Date()) {
    await this.#execute(`
      UPDATE topic_catalog
      SET last_used_at = ${toSqlDate(now)}
      WHERE topic_id = ${toSqlString(topicId)};
    `);
  }

  async saveTopicMemory(topicId, memory) {
    const normalized = normalizeMemoryForPersistence(memory);

    await this.#execute(`
      INSERT INTO topic_memory (
        topic_id,
        learning_state,
        times_asked,
        times_blocked,
        times_recovered,
        times_mastered_clean,
        times_mastered_recovered,
        last_misconception_summary,
        last_teaching_summary,
        last_asked_at,
        last_answered_at,
        mastery_score,
        attempt_count,
        success_count,
        failure_count,
        last_outcome,
        last_mastery_kind,
        next_review_at,
        mastered_streak
      ) VALUES (
        ${toSqlString(topicId)},
        ${toSqlString(normalized.learningState)},
        ${normalized.timesAsked},
        ${normalized.timesBlocked},
        ${normalized.timesRecovered},
        ${normalized.timesMasteredClean},
        ${normalized.timesMasteredRecovered},
        ${toSqlString(normalized.lastMisconceptionSummary)},
        ${toSqlString(normalized.lastTeachingSummary)},
        ${toSqlDate(normalized.lastAskedAt)},
        ${toSqlDate(normalized.lastAnsweredAt)},
        ${normalized.masteryScore},
        ${normalized.attemptCount},
        ${normalized.successCount},
        ${normalized.failureCount},
        ${toSqlString(normalized.lastOutcome)},
        ${toSqlString(normalized.lastMasteryKind)},
        ${toSqlDate(normalized.nextReviewAt)},
        ${normalized.masteredStreak}
      )
      ON CONFLICT(topic_id) DO UPDATE SET
        learning_state = excluded.learning_state,
        times_asked = excluded.times_asked,
        times_blocked = excluded.times_blocked,
        times_recovered = excluded.times_recovered,
        times_mastered_clean = excluded.times_mastered_clean,
        times_mastered_recovered = excluded.times_mastered_recovered,
        last_misconception_summary = excluded.last_misconception_summary,
        last_teaching_summary = excluded.last_teaching_summary,
        last_asked_at = excluded.last_asked_at,
        last_answered_at = excluded.last_answered_at,
        mastery_score = excluded.mastery_score,
        attempt_count = excluded.attempt_count,
        success_count = excluded.success_count,
        failure_count = excluded.failure_count,
        last_outcome = excluded.last_outcome,
        last_mastery_kind = excluded.last_mastery_kind,
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
        answer_summary,
        misconception_summary,
        attempt_kind,
        outcome,
        rationale,
        recorded_at
      ) VALUES (
        ${toSqlString(attempt.threadTs)},
        ${toSqlString(attempt.topicId)},
        ${toSqlString(attempt.answer)},
        ${toSqlString(attempt.answerSummary ?? null)},
        ${toSqlString(attempt.misconceptionSummary ?? null)},
        ${toSqlString(attempt.attemptKind ?? null)},
        ${toSqlString(attempt.outcome)},
        ${toSqlString(attempt.rationale)},
        ${toSqlDate(attempt.recordedAt)}
      );
    `);
  }

  async listAttemptsByTopic(topicId, { limit = 5 } = {}) {
    const parsedLimit = Number(limit);
    const safeLimit = Number.isFinite(parsedLimit)
      ? Math.max(1, Math.round(parsedLimit))
      : 5;
    const rows = await this.#query(`
      SELECT *
      FROM attempts
      WHERE topic_id = ${toSqlString(topicId)}
      ORDER BY recorded_at DESC, id DESC
      LIMIT ${safeLimit};
    `);
    return rows.map((row) => ({
      threadTs: row.thread_ts,
      topicId: row.topic_id,
      answer: row.answer,
      answerSummary: row.answer_summary ?? null,
      misconceptionSummary: row.misconception_summary ?? null,
      attemptKind: row.attempt_kind ?? null,
      outcome: row.outcome,
      rationale: row.rationale ?? null,
      recordedAt: new Date(row.recorded_at),
    }));
  }

  async saveTeachingMemory(teachingMemory) {
    await this.#execute(`
      INSERT INTO teaching_memory (
        topic_id,
        thread_ts,
        teaching_summary,
        challenge_summary,
        created_at
      ) VALUES (
        ${toSqlString(teachingMemory.topicId)},
        ${toSqlString(teachingMemory.threadTs)},
        ${toSqlString(teachingMemory.teachingSummary)},
        ${toSqlString(teachingMemory.challengeSummary ?? null)},
        ${toSqlDate(teachingMemory.createdAt)}
      );
    `);
  }

  async getLatestTeachingMemory(topicId) {
    const rows = await this.#query(`
      SELECT *
      FROM teaching_memory
      WHERE topic_id = ${toSqlString(topicId)}
      ORDER BY created_at DESC, id DESC
      LIMIT 1;
    `);
    const row = rows[0];
    if (!row) {
      return null;
    }

    return {
      topicId: row.topic_id,
      threadTs: row.thread_ts,
      teachingSummary: row.teaching_summary,
      challengeSummary: row.challenge_summary ?? null,
      createdAt: new Date(row.created_at),
    };
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

  async #ensureThreadColumns() {
    const columns = await this.#query("PRAGMA table_info(threads);");
    await this.#ensureColumn("threads", columns, "kind", "TEXT NOT NULL DEFAULT 'study'");
    await this.#ensureColumn("threads", columns, "codex_session_id", "TEXT");
    await this.#ensureColumn("threads", columns, "direct_qa_state", "TEXT");
    await this.#ensureColumn("threads", columns, "last_assistant_prompt", "TEXT");
    await this.#ensureColumn("threads", columns, "last_challenge_prompt", "TEXT");
    await this.#ensureColumn("threads", columns, "blocked_once", "INTEGER NOT NULL DEFAULT 0");
    await this.#ensureColumn("threads", columns, "awaiting_user_reply_at", "TEXT");
    await this.#ensureColumn("threads", columns, "last_user_reply_at", "TEXT");
    await this.#ensureColumn("threads", columns, "reminder_sent_at", "TEXT");
  }

  async #ensureTopicMemoryColumns() {
    const columns = await this.#query("PRAGMA table_info(topic_memory);");
    await this.#ensureColumn("topic_memory", columns, "learning_state", "TEXT NOT NULL DEFAULT 'new'");
    await this.#ensureColumn("topic_memory", columns, "times_asked", "INTEGER NOT NULL DEFAULT 0");
    await this.#ensureColumn("topic_memory", columns, "times_blocked", "INTEGER NOT NULL DEFAULT 0");
    await this.#ensureColumn("topic_memory", columns, "times_recovered", "INTEGER NOT NULL DEFAULT 0");
    await this.#ensureColumn("topic_memory", columns, "times_mastered_clean", "INTEGER NOT NULL DEFAULT 0");
    await this.#ensureColumn("topic_memory", columns, "times_mastered_recovered", "INTEGER NOT NULL DEFAULT 0");
    await this.#ensureColumn("topic_memory", columns, "last_misconception_summary", "TEXT");
    await this.#ensureColumn("topic_memory", columns, "last_teaching_summary", "TEXT");
    await this.#ensureColumn("topic_memory", columns, "last_asked_at", "TEXT");
    await this.#ensureColumn("topic_memory", columns, "last_answered_at", "TEXT");
    await this.#ensureColumn("topic_memory", columns, "last_mastery_kind", "TEXT");
  }

  async #ensureAttemptColumns() {
    const columns = await this.#query("PRAGMA table_info(attempts);");
    await this.#ensureColumn("attempts", columns, "answer_summary", "TEXT");
    await this.#ensureColumn("attempts", columns, "misconception_summary", "TEXT");
    await this.#ensureColumn("attempts", columns, "attempt_kind", "TEXT");
  }

  async #ensureColumn(tableName, columns, name, definition) {
    const hasColumn = columns.some((column) => column.name === name);

    if (!hasColumn) {
      await this.#execute(`ALTER TABLE ${tableName} ADD COLUMN ${name} ${definition};`);
    }
  }
}

function parseNullableDate(value) {
  return value ? new Date(value) : null;
}

function toSqlDate(value) {
  if (!value) {
    return "NULL";
  }

  if (value instanceof Date) {
    return toSqlString(value.toISOString());
  }

  return toSqlString(new Date(value).toISOString());
}

function toSqlString(value) {
  if (value === null || value === undefined) {
    return "NULL";
  }

  return `'${String(value).replaceAll("'", "''")}'`;
}

function toSqlInteger(value) {
  return value ? 1 : 0;
}

function mapThreadRow(row) {
  const status = row.status;

  return {
    slackThreadTs: row.slack_thread_ts,
    topicId: fromStoredTopicId(row.topic_id),
    kind: row.kind ?? "study",
    status,
    mode: row.mode,
    codexSessionId: row.codex_session_id ?? null,
    directQaState: row.direct_qa_state ?? null,
    lastAssistantPrompt: row.last_assistant_prompt ?? null,
    lastChallengePrompt: row.last_challenge_prompt ?? null,
    blockedOnce: Number(row.blocked_once ?? 0) === 1,
    awaitingUserReplyAt: parseNullableDate(row.awaiting_user_reply_at),
    lastUserReplyAt: parseNullableDate(row.last_user_reply_at),
    reminderSentAt: parseNullableDate(row.reminder_sent_at),
    openedAt: new Date(row.opened_at),
    closedAt: status === "open" ? null : parseNullableDate(row.closed_at),
    lastCounterQuestionAt: parseNullableDate(row.last_counter_question_at),
    lastCounterQuestionResolvedAt: parseNullableDate(row.last_counter_question_resolved_at),
  };
}

function normalizeThreadStatusForPersistence(status) {
  // blocked는 "막힌 학습 상태"일 뿐 닫힌 스레드 상태가 아니므로 저장 단계에서 open으로 고정합니다.
  if (status === "blocked") {
    return "open";
  }

  return status;
}

function toStoredTopicId(topicId) {
  return topicId ?? DIRECT_QA_TOPIC_SENTINEL;
}

function fromStoredTopicId(topicId) {
  return topicId === DIRECT_QA_TOPIC_SENTINEL ? null : topicId;
}

function mapMemoryRow(row) {
  return {
    learningState: row.learning_state ?? inferLearningStateFromLegacyRow(row),
    timesAsked: Number(row.times_asked ?? row.attempt_count ?? 0),
    timesBlocked: Number(row.times_blocked ?? row.failure_count ?? 0),
    timesRecovered: Number(
      row.times_recovered
        ?? row.times_mastered_recovered
        ?? (row.last_mastery_kind === "recovered" ? row.success_count ?? 0 : 0),
    ),
    timesMasteredClean: Number(
      row.times_mastered_clean
        ?? Math.max(
          0,
          Number(row.success_count ?? 0) - Number(
            row.times_mastered_recovered
              ?? (row.last_mastery_kind === "recovered" ? row.success_count ?? 0 : 0),
          ),
        ),
    ),
    timesMasteredRecovered: Number(
      row.times_mastered_recovered
        ?? (row.last_mastery_kind === "recovered" ? row.success_count ?? 0 : 0),
    ),
    lastMisconceptionSummary: row.last_misconception_summary ?? null,
    lastTeachingSummary: row.last_teaching_summary ?? null,
    lastAskedAt: parseNullableDate(row.last_asked_at),
    lastAnsweredAt: parseNullableDate(row.last_answered_at),
    masteryScore: row.mastery_score,
    attemptCount: row.attempt_count,
    successCount: row.success_count,
    failureCount: row.failure_count,
    lastOutcome: row.last_outcome,
    lastMasteryKind: row.last_mastery_kind ?? null,
    nextReviewAt: parseNullableDate(row.next_review_at),
    masteredStreak: row.mastered_streak,
  };
}

function mapTopicRow(row) {
  return {
    id: row.topic_id,
    title: row.title,
    category: row.category,
    promptSeed: row.prompt_seed,
    weight: Number(row.weight ?? 3),
    createdAt: parseNullableDate(row.created_at),
    lastUsedAt: parseNullableDate(row.last_used_at),
  };
}

function inferLearningStateFromLegacyRow(row) {
  if (row.last_outcome === "blocked") {
    return "blocked";
  }

  if (row.last_outcome === "continue") {
    return "fuzzy";
  }

  if (row.last_outcome === "mastered") {
    return row.last_mastery_kind === "recovered"
      ? "mastered_recovered"
      : "mastered_clean";
  }

  return "new";
}

function normalizeMemoryForPersistence(memory = {}) {
  const successCount = Number(memory.successCount ?? 0);
  const timesMasteredRecovered = Number(
    memory.timesMasteredRecovered
      ?? (memory.lastMasteryKind === "recovered" ? successCount : 0),
  );
  const timesMasteredClean = Number(
    memory.timesMasteredClean ?? Math.max(0, successCount - timesMasteredRecovered),
  );
  const attemptCount = Number(memory.attemptCount ?? memory.timesAsked ?? 0);
  const failureCount = Number(memory.failureCount ?? memory.timesBlocked ?? 0);

  return {
    learningState: memory.learningState ?? inferLearningStateFromLegacyValue(memory),
    timesAsked: Number(memory.timesAsked ?? attemptCount),
    timesBlocked: Number(memory.timesBlocked ?? failureCount),
    timesRecovered: Number(memory.timesRecovered ?? timesMasteredRecovered),
    timesMasteredClean,
    timesMasteredRecovered,
    lastMisconceptionSummary: memory.lastMisconceptionSummary ?? null,
    lastTeachingSummary: memory.lastTeachingSummary ?? null,
    lastAskedAt: memory.lastAskedAt ?? null,
    lastAnsweredAt: memory.lastAnsweredAt ?? null,
    masteryScore: Number(memory.masteryScore ?? 0),
    attemptCount,
    successCount,
    failureCount,
    lastOutcome: memory.lastOutcome ?? null,
    lastMasteryKind: memory.lastMasteryKind ?? null,
    nextReviewAt: memory.nextReviewAt ?? null,
    masteredStreak: Number(memory.masteredStreak ?? 0),
  };
}

function inferLearningStateFromLegacyValue(memory) {
  if (memory.lastOutcome === "blocked") {
    return "blocked";
  }

  if (memory.lastOutcome === "continue") {
    return "fuzzy";
  }

  if (memory.lastOutcome === "mastered") {
    return memory.lastMasteryKind === "recovered"
      ? "mastered_recovered"
      : "mastered_clean";
  }

  return "new";
}
