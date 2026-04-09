import { normalizeDirectQaStackState } from "../domain/direct-qa-stack-policy.js";

const DEFAULT_STUDY_ROUND = 1;
const DEFAULT_STUDY_ROUND_LIMIT = 5;

export function appendStudyStackDebugText(text, threadLike, enabled = false) {
  const baseText = String(text ?? "");

  if (!enabled || !isStudyThreadLike(threadLike)) {
    return baseText;
  }

  const { depth, depthLimit, path } = resolveStudyStackDebug(threadLike);
  const blockedOnce = Boolean(threadLike?.blockedOnce);
  const debugLine = path
    ? `[debug] study-stack depth=${depth}/${depthLimit} blockedOnce=${blockedOnce} path=${path}`
    : `[debug] study-stack depth=${depth}/${depthLimit} blockedOnce=${blockedOnce}`;

  return `${baseText}\n${debugLine}`;
}

function isStudyThreadLike(threadLike) {
  return (threadLike?.kind ?? "study") === "study";
}

function resolveStudyRound(threadLike) {
  const parsed = Number(threadLike?.studyQuestionRound ?? DEFAULT_STUDY_ROUND);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_STUDY_ROUND;
  }

  return Math.max(1, Math.round(parsed));
}

function resolveStudyRoundLimit(threadLike) {
  const parsed = Number(threadLike?.studyQuestionRoundLimit ?? DEFAULT_STUDY_ROUND_LIMIT);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_STUDY_ROUND_LIMIT;
  }

  return Math.max(1, Math.round(parsed));
}

function resolveStudyStackDebug(threadLike) {
  const stack = normalizeDirectQaStackState(threadLike?.directQaStack ?? null);
  const hasStackFrames = stack.frames.length > 0;
  const depth = hasStackFrames ? stack.frames.length : resolveStudyRound(threadLike);
  const depthLimit = hasStackFrames ? stack.maxDepth : resolveStudyRoundLimit(threadLike);
  const path = hasStackFrames
    ? stack.frames
      .map((frame) => sanitizePrompt(frame.prompt))
      .filter(Boolean)
      .join(" > ")
    : "";

  return {
    depth,
    depthLimit,
    path,
  };
}

function sanitizePrompt(prompt) {
  if (typeof prompt !== "string") {
    return "";
  }

  const normalized = prompt.replace(/\s+/gu, " ").trim();
  if (!normalized) {
    return "";
  }

  const maxLength = 64;
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength - 1)}…`
    : normalized;
}
