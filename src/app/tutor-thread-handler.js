import { looksLikeCounterQuestion } from "./counter-question.js";
import {
  closeThread,
  markThreadAsCounterQuestion,
  resolveCounterQuestion,
} from "../domain/thread-policy.js";
import {
  createEmptyTopicMemory,
  updateTopicMemory,
} from "../domain/topic-memory.js";

const NOOP_LOGGER = {
  debug() {},
  error() {},
};

export function createTutorThreadHandler({
  store,
  llmRunner,
  slackClient,
  logger = NOOP_LOGGER,
}) {
  async function handleThreadMessage({ threadTs, text, now = new Date() }) {
    const thread = await store.getThread(threadTs);

    if (!thread) {
      logger.debug("tutor_bot.thread_missing", {
        threadTs,
      });
      return null;
    }

    if (thread.status !== "open") {
      logger.debug("tutor_bot.thread_ignored_not_open", {
        threadTs,
        status: thread.status,
      });
      return null;
    }

    const repliedThread = applyUserReplyMetadata(thread, now);
    await store.saveThread(repliedThread);

    if (looksLikeCounterQuestion(text)) {
      const counterThread = markThreadAsCounterQuestion(repliedThread, now);
      await store.saveThread(counterThread);

      const answer = await llmRunner.runTask("answer_counterquestion", {
        thread: counterThread,
        text,
        lastAssistantPrompt: counterThread.lastAssistantPrompt ?? null,
        lastChallengePrompt: getChallengePrompt(counterThread),
        codexSessionId: counterThread.codexSessionId ?? null,
      });

      await slackClient.postThreadReply(threadTs, answer.text);

      const resolvedThread = answer.resolved === false
        ? counterThread
        : resolveCounterQuestion(counterThread, now);
      const updatedThread = setThreadPrompts(
        mergeCodexSessionId(resolvedThread, answer.codexSessionId),
        {
          assistantPrompt: answer.text,
          challengePrompt: getChallengePrompt(counterThread),
        },
      );
      await store.saveThread(updatedThread);
      return {
        thread: updatedThread,
        shouldScheduleNextQuestion: false,
      };
    }

    const currentMemory =
      (await store.getTopicMemory(repliedThread.topicId)) ?? createEmptyTopicMemory();
    const retrievalContext = await loadRetrievalContext({
      store,
      topicId: repliedThread.topicId,
      topicMemory: currentMemory,
    });
    const evaluation = await llmRunner.runTask("evaluate", {
      thread: repliedThread,
      text,
      lastAssistantPrompt: repliedThread.lastAssistantPrompt ?? null,
      lastChallengePrompt: getChallengePrompt(repliedThread),
      codexSessionId: repliedThread.codexSessionId ?? null,
      topicMemory: currentMemory,
      recentAttempts: retrievalContext.recentAttempts,
      latestTeachingMemory: retrievalContext.latestTeachingMemory,
      previousMisconceptionSummary: retrievalContext.previousMisconceptionSummary,
      previousTeachingSummary: retrievalContext.previousTeachingSummary,
    });
    const normalizedEvaluation = normalizeEvaluationResult(text, evaluation);
    const sessionBoundThread = mergeCodexSessionId(repliedThread, normalizedEvaluation.codexSessionId);

    await store.saveAttempt({
      threadTs,
      topicId: repliedThread.topicId,
      answer: text,
      answerSummary: normalizedEvaluation.answerSummary ?? null,
      misconceptionSummary: normalizedEvaluation.misconceptionSummary ?? null,
      attemptKind: normalizedEvaluation.attemptKind ?? "evaluation",
      outcome: normalizedEvaluation.outcome,
      recordedAt: now,
      rationale: normalizedEvaluation.rationale ?? null,
    });

    const masteryKind = normalizedEvaluation.outcome === "mastered"
      ? (sessionBoundThread.blockedOnce ? "recovered" : "clean")
      : undefined;
    const nextMemory = updateTopicMemory(
      currentMemory,
      normalizedEvaluation.outcome,
      now,
      {
        ...(masteryKind ? { masteryKind } : {}),
        lastMisconceptionSummary: normalizedEvaluation.misconceptionSummary ?? null,
      },
    );
    await store.saveTopicMemory(repliedThread.topicId, nextMemory);

    if (normalizedEvaluation.outcome === "continue") {
      const followUp = await llmRunner.runTask("followup", {
        thread: sessionBoundThread,
        text,
        evaluation: normalizedEvaluation,
        lastAssistantPrompt: sessionBoundThread.lastAssistantPrompt ?? null,
        lastChallengePrompt: getChallengePrompt(sessionBoundThread),
        codexSessionId: sessionBoundThread.codexSessionId ?? null,
        topicMemory: currentMemory,
        recentAttempts: retrievalContext.recentAttempts,
        latestTeachingMemory: retrievalContext.latestTeachingMemory,
        previousMisconceptionSummary: retrievalContext.previousMisconceptionSummary,
        previousTeachingSummary: retrievalContext.previousTeachingSummary,
      });

      await slackClient.postThreadReply(threadTs, followUp.text);
      const continuedThread = setThreadPrompts(
        mergeCodexSessionId(sessionBoundThread, followUp.codexSessionId),
        {
          assistantPrompt: followUp.text,
          challengePrompt: followUp.challengePrompt ?? followUp.text,
        },
      );
      const waitingThread = applyAwaitingUserReplyMetadata(continuedThread, now);
      await store.saveThread(waitingThread);
      return {
        thread: waitingThread,
        memory: nextMemory,
        shouldScheduleNextQuestion: false,
      };
    }

    if (normalizedEvaluation.outcome === "blocked") {
      const teaching = await llmRunner.runTask("teach", {
        thread: sessionBoundThread,
        text,
        evaluation: normalizedEvaluation,
        lastAssistantPrompt: sessionBoundThread.lastAssistantPrompt ?? null,
        lastChallengePrompt: getChallengePrompt(sessionBoundThread),
        codexSessionId: sessionBoundThread.codexSessionId ?? null,
        topicMemory: currentMemory,
        recentAttempts: retrievalContext.recentAttempts,
        latestTeachingMemory: retrievalContext.latestTeachingMemory,
        previousMisconceptionSummary: retrievalContext.previousMisconceptionSummary,
        previousTeachingSummary: retrievalContext.previousTeachingSummary,
      });

      const challengePrompt = normalizeChallengePrompt(
        teaching.challengePrompt,
        getChallengePrompt(sessionBoundThread),
      );
      const teachingSummary = normalizeTextOrNull(teaching.teachingSummary ?? teaching.text);
      const challengeSummary = normalizeTextOrNull(teaching.challengeSummary ?? challengePrompt);
      const blockedMemory = teachingSummary
        ? {
          ...nextMemory,
          lastTeachingSummary: teachingSummary,
        }
        : nextMemory;

      if (typeof store.saveTeachingMemory === "function" && teachingSummary) {
        await store.saveTeachingMemory({
          topicId: repliedThread.topicId,
          threadTs,
          teachingSummary,
          challengeSummary,
          createdAt: now,
        });
      }
      if (blockedMemory !== nextMemory) {
        await store.saveTopicMemory(repliedThread.topicId, blockedMemory);
      }
      await slackClient.postThreadReply(threadTs, teaching.text);
      if (challengePrompt && challengePrompt !== teaching.text) {
        await slackClient.postThreadReply(threadTs, challengePrompt);
      }
      const blockedThread = setThreadPrompts(
        {
          ...mergeCodexSessionId(sessionBoundThread, teaching.codexSessionId),
          blockedOnce: true,
        },
        {
          assistantPrompt: teaching.text,
          challengePrompt,
        },
      );
      const waitingBlockedThread = applyAwaitingUserReplyMetadata(blockedThread, now);
      await store.saveThread(waitingBlockedThread);
      return {
        thread: waitingBlockedThread,
        memory: blockedMemory,
        shouldScheduleNextQuestion: false,
      };
    }

    const reply = normalizeTextOrNull(normalizedEvaluation.text)
      ?? "흥, 이번엔 넘어간다. 다음엔 더 깊게 물어볼 거야.";
    await slackClient.postThreadReply(threadTs, reply);
    const closedThread = closeThread(sessionBoundThread, "mastered", now);
    await store.saveThread(closedThread);
    return {
      thread: closedThread,
      memory: nextMemory,
      masteryKind,
      shouldScheduleNextQuestion: true,
    };
  }

  return {
    handleThreadMessage,
  };
}

function normalizeEvaluationResult(text, evaluation) {
  if (evaluation.outcome !== "blocked" && looksExplicitlyStuckAnswer(text)) {
    return {
      ...evaluation,
      outcome: "blocked",
      rationale: mergeRationale(
        evaluation.rationale,
        "The user explicitly signaled they are stuck or do not know the mechanism.",
      ),
    };
  }

  return evaluation;
}

function looksExplicitlyStuckAnswer(text) {
  const normalized = String(text ?? "").toLowerCase();
  return /모르겠|잘 모르|정확히는 모르|헷갈|까먹|기억 안 나|모르는데|모르겠는데/u.test(normalized);
}

function mergeRationale(rationale, addition) {
  if (!rationale) {
    return addition;
  }

  return `${rationale} ${addition}`;
}

function setThreadPrompts(thread, { assistantPrompt, challengePrompt }) {
  return {
    ...thread,
    lastAssistantPrompt: assistantPrompt ?? null,
    lastChallengePrompt: challengePrompt ?? null,
  };
}

function mergeCodexSessionId(thread, codexSessionId) {
  if (!codexSessionId) {
    return thread;
  }

  return {
    ...thread,
    codexSessionId,
  };
}

function getChallengePrompt(thread) {
  return thread.lastChallengePrompt ?? thread.lastAssistantPrompt ?? null;
}

function normalizeChallengePrompt(primary, fallback) {
  const primaryText = typeof primary === "string" ? primary.trim() : "";
  if (primaryText) {
    return primaryText;
  }

  const fallbackText = typeof fallback === "string" ? fallback.trim() : "";
  return fallbackText || null;
}

function normalizeTextOrNull(value) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized || null;
}

function applyUserReplyMetadata(thread, now) {
  return {
    ...thread,
    lastUserReplyAt: now,
    awaitingUserReplyAt: null,
    reminderSentAt: null,
  };
}

function applyAwaitingUserReplyMetadata(thread, now) {
  return {
    ...thread,
    awaitingUserReplyAt: now,
    reminderSentAt: null,
  };
}

async function loadRetrievalContext({ store, topicId, topicMemory }) {
  const recentAttempts = typeof store.listAttemptsByTopic === "function"
    ? await store.listAttemptsByTopic(topicId, { limit: 5 })
    : [];
  const latestTeachingMemory = typeof store.getLatestTeachingMemory === "function"
    ? await store.getLatestTeachingMemory(topicId)
    : null;
  const previousMisconceptionSummary =
    topicMemory?.lastMisconceptionSummary
    ?? recentAttempts.find((attempt) => attempt.misconceptionSummary)?.misconceptionSummary
    ?? null;
  const previousTeachingSummary =
    latestTeachingMemory?.teachingSummary
    ?? topicMemory?.lastTeachingSummary
    ?? null;

  return {
    recentAttempts,
    latestTeachingMemory,
    previousMisconceptionSummary,
    previousTeachingSummary,
  };
}
