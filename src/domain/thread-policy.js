export function createThreadState({
  slackThreadTs,
  topicId = null,
  openedAt,
  kind = "study",
  mode = kind === "direct_qa" ? "direct_qa" : "evaluation",
  blockedOnce = false,
  codexSessionId = null,
  directQaState = kind === "direct_qa" ? "open" : null,
  lastAssistantPrompt = null,
}) {
  return {
    slackThreadTs,
    topicId,
    kind,
    openedAt,
    closedAt: null,
    mode,
    status: "open",
    blockedOnce,
    lastCounterQuestionAt: null,
    lastCounterQuestionResolvedAt: null,
    codexSessionId,
    directQaState,
    lastAssistantPrompt,
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
