export function createThreadState({ slackThreadTs, topicId, openedAt }) {
  return {
    slackThreadTs,
    topicId,
    openedAt,
    closedAt: null,
    mode: "evaluation",
    status: "open",
    lastCounterQuestionAt: null,
    lastCounterQuestionResolvedAt: null,
  };
}

export function markThreadAsCounterQuestion(thread, now = new Date()) {
  return {
    ...thread,
    mode: "counterquestion",
    lastCounterQuestionAt: now,
  };
}

export function resolveCounterQuestion(thread, now = new Date()) {
  return {
    ...thread,
    mode: "evaluation",
    lastCounterQuestionResolvedAt: now,
  };
}

export function closeThread(thread, status, now) {
  return {
    ...thread,
    status,
    closedAt: now,
  };
}
