import { looksLikeCounterQuestion } from "./counter-question.js";
import { appendStudyStackDebugText } from "./study-stack-debug.js";
import {
  closeThread,
  markThreadAsCounterQuestion,
  resolveCounterQuestion,
} from "../domain/thread-policy.js";
import {
  applyDirectQaOperation,
  createDirectQaStackState,
  getDirectQaTopPrompt,
  normalizeDirectQaStackState,
} from "../domain/direct-qa-stack-policy.js";
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
  includeStudyStackDebug = false,
  logger = NOOP_LOGGER,
}) {
  const decorateStudyMessage = (text, threadLike) =>
    appendStudyStackDebugText(text, threadLike, includeStudyStackDebug);

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

    const stackReadyThread = normalizeStudyThreadStack(thread, now);
    if (stackReadyThread !== thread) {
      await store.saveThread(stackReadyThread);
    }

    const repliedThread = applyUserReplyMetadata(stackReadyThread, now);
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

      await slackClient.postThreadReply(threadTs, decorateStudyMessage(answer.text, repliedThread));

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

    if (normalizedEvaluation.outcome === "continue") {
      const continuedMemory = updateTopicMemory(
        currentMemory,
        "continue",
        now,
        {
          lastMisconceptionSummary: normalizedEvaluation.misconceptionSummary ?? null,
        },
      );
      await store.saveTopicMemory(repliedThread.topicId, continuedMemory);

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
      const followUpPrompt = normalizeChallengePrompt(
        followUp.challengePrompt,
        followUp.text,
      );
      const transitioned = applyStudyStackTransition(sessionBoundThread, {
        operation: "stay",
        nextPrompt: followUpPrompt,
        now,
      });
      const activePrompt = getDirectQaTopPrompt(transitioned.stack) ?? followUpPrompt;
      const continuedThread = applyStudyStackState(
        setThreadPrompts(
          mergeCodexSessionId(sessionBoundThread, followUp.codexSessionId),
          {
            assistantPrompt: followUp.text,
            challengePrompt: activePrompt,
          },
        ),
        transitioned.stack,
      );

      await slackClient.postThreadReply(
        threadTs,
        decorateStudyMessage(followUp.text, continuedThread),
      );
      const waitingThread = applyAwaitingUserReplyMetadata(continuedThread, now);
      await store.saveThread(waitingThread);
      return {
        thread: waitingThread,
        memory: continuedMemory,
        shouldScheduleNextQuestion: false,
      };
    }

    if (normalizedEvaluation.outcome === "blocked") {
      const blockedBaseMemory = updateTopicMemory(
        currentMemory,
        "blocked",
        now,
        {
          lastMisconceptionSummary: normalizedEvaluation.misconceptionSummary ?? null,
        },
      );
      await store.saveTopicMemory(repliedThread.topicId, blockedBaseMemory);

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
          ...blockedBaseMemory,
          lastTeachingSummary: teachingSummary,
        }
        : blockedBaseMemory;

      if (typeof store.saveTeachingMemory === "function" && teachingSummary) {
        await store.saveTeachingMemory({
          topicId: repliedThread.topicId,
          threadTs,
          teachingSummary,
          challengeSummary,
          createdAt: now,
        });
      }
      if (blockedMemory !== blockedBaseMemory) {
        await store.saveTopicMemory(repliedThread.topicId, blockedMemory);
      }

      const transitioned = applyStudyStackTransition(
        {
          ...sessionBoundThread,
          blockedOnce: true,
        },
        {
          operation: "push",
          nextPrompt: challengePrompt,
          now,
        },
      );
      const activePrompt = getDirectQaTopPrompt(transitioned.stack) ?? challengePrompt;
      const blockedThread = applyStudyStackState(
        setThreadPrompts(
          {
            ...mergeCodexSessionId(sessionBoundThread, teaching.codexSessionId),
            blockedOnce: true,
          },
          {
            assistantPrompt: teaching.text,
            challengePrompt: activePrompt,
          },
        ),
        transitioned.stack,
      );

      await slackClient.postThreadReply(
        threadTs,
        decorateStudyMessage(teaching.text, blockedThread),
      );
      if (activePrompt && activePrompt !== teaching.text) {
        await slackClient.postThreadReply(
          threadTs,
          decorateStudyMessage(activePrompt, blockedThread),
        );
      }
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
    const transitioned = applyStudyStackTransition(sessionBoundThread, {
      operation: "pop",
      passQuality: "strong",
      now,
    });
    const poppedThread = applyStudyStackState(sessionBoundThread, transitioned.stack);

    await slackClient.postThreadReply(threadTs, decorateStudyMessage(reply, poppedThread));

    if (transitioned.shouldClose) {
      const masteryKind = sessionBoundThread.blockedOnce ? "recovered" : "clean";
      const masteredMemory = updateTopicMemory(
        currentMemory,
        "mastered",
        now,
        {
          masteryKind,
          lastMisconceptionSummary: normalizedEvaluation.misconceptionSummary ?? null,
        },
      );
      await store.saveTopicMemory(repliedThread.topicId, masteredMemory);

      const closedThread = closeThread(
        poppedThread,
        "mastered",
        now,
      );
      await store.saveThread(closedThread);
      return {
        thread: closedThread,
        memory: masteredMemory,
        masteryKind,
        shouldScheduleNextQuestion: true,
      };
    }

    const resumedPrompt = getDirectQaTopPrompt(transitioned.stack);
    const resumedMemory = updateTopicMemory(
      currentMemory,
      "continue",
      now,
      {
        lastMisconceptionSummary: normalizedEvaluation.misconceptionSummary ?? null,
      },
    );
    await store.saveTopicMemory(repliedThread.topicId, resumedMemory);

    if (resumedPrompt) {
      const resumedPromptThread = setThreadPrompts(poppedThread, {
        assistantPrompt: resumedPrompt,
        challengePrompt: resumedPrompt,
      });
      await slackClient.postThreadReply(
        threadTs,
        decorateStudyMessage(resumedPrompt, resumedPromptThread),
      );
    }

    const resumedThread = setThreadPrompts(poppedThread, {
      assistantPrompt: resumedPrompt,
      challengePrompt: resumedPrompt,
    });
    const waitingResumedThread = applyAwaitingUserReplyMetadata(resumedThread, now);
    await store.saveThread(waitingResumedThread);
    return {
      thread: waitingResumedThread,
      memory: resumedMemory,
      shouldScheduleNextQuestion: false,
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

function normalizeStudyThreadStack(thread, now) {
  if ((thread?.kind ?? "study") !== "study") {
    return thread;
  }

  const currentStack = normalizeDirectQaStackState(thread.directQaStack ?? createDirectQaStackState());
  if (thread.directQaStackSealed === true) {
    currentStack.sealed = true;
  }

  const fallbackPrompt = normalizeChallengePrompt(
    thread.lastChallengePrompt,
    thread.lastAssistantPrompt,
  );
  const needsRootPrompt = currentStack.frames.length === 0 && Boolean(fallbackPrompt);
  const transitioned = needsRootPrompt
    ? applyDirectQaOperation(currentStack, {
      operation: "push",
      nextPrompt: fallbackPrompt,
      now,
    })
    : {
      stack: currentStack,
    };

  const nextStack = transitioned.stack;
  const topPrompt = getDirectQaTopPrompt(nextStack);
  const round = Math.max(1, nextStack.frames.length || 1);
  const roundLimit = Math.max(1, nextStack.maxDepth || 5);
  const hasChanged = needsRootPrompt
    || !thread.directQaStack
    || thread.directQaStackSealed !== nextStack.sealed
    || thread.studyQuestionRound !== round
    || thread.studyQuestionRoundLimit !== roundLimit
    || (topPrompt && thread.lastChallengePrompt !== topPrompt);

  if (!hasChanged) {
    return thread;
  }

  return {
    ...thread,
    directQaStack: nextStack,
    directQaStackSealed: nextStack.sealed,
    studyQuestionRound: round,
    studyQuestionRoundLimit: roundLimit,
    lastChallengePrompt: topPrompt ?? thread.lastChallengePrompt ?? null,
  };
}

function applyStudyStackTransition(thread, { operation, nextPrompt = null, passQuality = null, now }) {
  const normalizedThread = normalizeStudyThreadStack(thread, now);
  return applyDirectQaOperation(normalizedThread.directQaStack, {
    operation,
    nextPrompt,
    passQuality,
    now,
  });
}

function applyStudyStackState(thread, stack) {
  if ((thread?.kind ?? "study") !== "study") {
    return thread;
  }

  const topPrompt = getDirectQaTopPrompt(stack);

  return {
    ...thread,
    directQaStack: stack,
    directQaStackSealed: stack.sealed,
    studyQuestionRound: Math.max(1, stack.frames.length || 1),
    studyQuestionRoundLimit: Math.max(1, stack.maxDepth || 5),
    lastChallengePrompt: topPrompt ?? thread.lastChallengePrompt ?? null,
  };
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
