import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { runWithRetry } from "./run-with-retry.js";
import { VECTOR_SYSTEM_PROMPT } from "../persona/vector-system-prompt.js";

const execFileAsync = promisify(execFile);
const NOOP_LOGGER = {
  debug() {},
  error() {},
};

export class CodexCliRunner {
  constructor({
    command = "codex",
    workdir = process.cwd(),
    model = null,
    env = {},
    logger = NOOP_LOGGER,
  } = {}) {
    this.command = command;
    this.workdir = workdir;
    this.model = model;
    this.env = normalizeEnvMap(env);
    this.logger = logger;
  }

  async runTask(taskType, payload) {
    return runWithRetry(
      () => this.#invoke(taskType, payload),
      {
        maxAttempts: 2,
        parser: (raw) => parseTaskResult(taskType, raw),
      },
    );
  }

  async #invoke(taskType, payload) {
    const prompt = buildTaskPrompt(taskType, payload);
    const tmpPath = await mkdtemp(join(tmpdir(), "vector-codex-"));
    const outputPath = join(tmpPath, "output.json");
    const startedAt = Date.now();

    try {
      this.logger.debug("llm.task.start", {
        taskType,
        command: this.command,
      });
      const args = buildCodexExecArgs({
        taskType,
        outputPath,
        prompt,
        model: this.model,
        codexSessionId: payload?.codexSessionId ?? null,
      });

      const { stdout = "" } = await execFileAsync(this.command, args, {
        cwd: this.workdir,
        env: {
          ...process.env,
          ...this.env,
        },
        maxBuffer: 1024 * 1024 * 4,
      });

      this.logger.debug("llm.task.success", {
        taskType,
        durationMs: Date.now() - startedAt,
      });
      return {
        outputText: await readFile(outputPath, "utf8"),
        codexThreadId: payload?.codexSessionId ?? parseCodexThreadIdFromStdout(stdout),
      };
    } catch (error) {
      this.logger.error("llm.task.error", {
        taskType,
        durationMs: Date.now() - startedAt,
        code: error.code ?? null,
        message: error.message,
      });
      throw error;
    } finally {
      await rm(tmpPath, { recursive: true, force: true });
    }
  }
}

function normalizeEnvMap(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .map(([key, envValue]) => [String(key), String(envValue)]),
  );
}

function buildTaskPrompt(taskType, payload) {
  return [
    VECTOR_SYSTEM_PROMPT,
    "",
    `Task type: ${taskType}`,
    buildTaskInstructions(taskType),
    "Return JSON only.",
    JSON.stringify(payload, null, 2),
  ].join("\n");
}

function buildTaskInstructions(taskType) {
  const instructions = TASK_INSTRUCTIONS[taskType];
  return instructions ?? 'Return a JSON object with a "text" string field.';
}

function parseTaskResult(taskType, raw) {
  const parsed = parseJsonObject(raw.outputText);
  const questionNormalized = normalizeSingleQuestionTasks(taskType, parsed);
  const directQaNormalized = normalizeDirectQaOperationContract(taskType, questionNormalized);
  const normalized = normalizeReplyStyle(taskType, directQaNormalized);

  if (!isSessionAwareTask(taskType)) {
    return normalized;
  }

  return {
    ...normalized,
    codexSessionId: raw.codexThreadId ?? null,
  };
}

function parseJsonObject(text) {
  const source = String(text ?? "").trim();

  try {
    return JSON.parse(source);
  } catch {
    // JSON 코드블록이나 부가 문구가 섞인 출력도 구조화 JSON만 추출해 파싱합니다.
  }

  const fenced = source.match(/```(?:json)?\s*([\s\S]*?)\s*```/iu);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1]);
    } catch {
      // fenced JSON 파싱 실패 시 일반 JSON 조각 추출로 진행합니다.
    }
  }

  const extracted = extractBalancedJson(source);
  if (extracted) {
    return JSON.parse(extracted);
  }

  return JSON.parse(source);
}

function extractBalancedJson(text) {
  const startIndex = text.search(/[{\[]/u);
  if (startIndex < 0) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = startIndex; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "{" || char === "[") {
      depth += 1;
      continue;
    }

    if (char === "}" || char === "]") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(startIndex, index + 1);
      }
    }
  }

  return null;
}

const TASK_INSTRUCTIONS = {
  topic:
    'Return {"topic":{"id":"kebab-case-id","title":"...","category":"...","promptSeed":"...","weight":1-10}} for a new CS/dev learning topic. Avoid duplicates with existingTopics/recentTopics. Pick broad computer-science or adjacent engineering topics (os, network, database, language runtime, distributed systems, security, tooling, testing, architecture). Do not output a question in this task; only topic metadata.',
  question:
    'Return {"text":"..."} with exactly one concise CS question sentence only. Output only the technical question line: no preface statement, no rivalry-taunt statement, and no extra commentary before the question. Never combine two asks in one turn (no multi-part asks joined by "and" equivalents). If payload.topicMemory is null or topicMemory.attemptCount is 0, ask a foundational concept-definition question first (for example "X가 뭐야?" level) before mechanism-heavy depth. Use payload.recentAttempts and payload.latestTeachingMemory to target the current weak point. If payload.recentAttempts indicate repeat failure or same misconception repeated, ask one focused re-check question on that exact misconception instead of pivoting broad. Keep the question wording provocative, playful, and competitive without adding extra sentences. Always reply in Korean informal speech (banmal), never honorific style. Treat the user as a close rival peer, so do not use honorific markers such as -시- forms (for example "해보시겠어", "해주시겠어").',
  evaluate:
    'Return {"outcome":"continue|blocked|mastered","rationale":"...","text":"optional closing reply when mastered"} based on the answer quality. Evaluate the user answer against thread.lastChallengePrompt first (fallback: thread.lastAssistantPrompt). Use payload.topicMemory, payload.recentAttempts, payload.latestTeachingMemory, payload.previousMisconceptionSummary, and payload.previousTeachingSummary to judge repeat failure, recovered mastery, and same misconception repeated patterns. If the latest user message explicitly says they do not know (for example "잘 모르겠어", "모르겠어", "몰라"), set outcome to blocked. If the latest user message contains ambiguous references such as "that/it/why that", resolve them to thread.lastChallengePrompt by default when available. When writing text, always use Korean informal speech (banmal), never honorific style, and avoid -시- forms.',
  classify_study_turn:
    'Return {"intent":"answer_attempt|clarification_request|side_counterquestion","confidence":0-1,"rationale":"..."} for the latest study-thread user turn. Use thread.lastChallengePrompt first (fallback: thread.lastAssistantPrompt) as the anchor. Classify as answer_attempt when the user is trying to answer the current challenge, including short/partial/wrong attempts and explicit not-knowing phrases (for example "몰라", "모르겠어"). Classify as clarification_request when the user asks to explain/rephrase the same challenge. Classify as side_counterquestion only when the user pivots to a separate side question that is not directly required to answer the current challenge. Prefer clarification_request over side_counterquestion when ambiguous.',
  followup:
    'Return {"text":"..."} with exactly one sharper follow-up question sentence only. Output only the technical follow-up question line: no preface statement, no rivalry-taunt statement, and no extra commentary before the question. Keep the follow-up anchored to the same sub-concept as thread.lastChallengePrompt and evaluation.rationale; do not jump to a different topic. Use payload.recentAttempts and payload.previousMisconceptionSummary to keep pressure on repeat failure and same misconception repeated patterns. Never stack two follow-up asks in one message. Keep the question wording provocative and irritated without adding extra sentences. Always reply in Korean informal speech (banmal), never honorific style, including -시- forms.',
  teach:
    'Return {"text":"...","challengePrompt":"..."} where text gives a brief correction for the exact failure point and challengePrompt gives exactly one re-check question. When the user is blocked, challengePrompt should be one prerequisite step narrower than thread.lastChallengePrompt (for example move from mechanism to definition) instead of repeating the same broad question. Rebuild a short answer scaffold for the precise question they failed, not a generic recap. Use payload.recentAttempts, payload.latestTeachingMemory, and payload.previousMisconceptionSummary to avoid repeating the same generic explanation when the same misconception repeated. If payload.retrievedChunks is non-empty, ground the explanation in those chunks and cite source labels like [source: ...]. If the user explicitly says they do not know (for example "잘 모르겠어", "모르겠어", "몰라"), treat it as a learning request, not evasion: you may open with one short rivalry taunt, then immediately give a concrete explanation in 1-2 sentences before asking the re-check question. Keep the taunt about answer quality only, never about identity/intelligence. Do not use wording that frames the user as dodging (for example "회피"). If the user says "that/it/why that" ambiguously, treat it as referring to thread.lastChallengePrompt first (fallback: thread.lastAssistantPrompt) and explain directly instead of asking what it means. The tone should be sharp, slightly mocking, and competitive, not kind. Always reply in Korean informal speech (banmal), never honorific style, and avoid -시- honorific constructions. If payload.freshnessType is "volatile", do not assert specific version details or API changes as fact. Teach the underlying principle and note that implementation details may have changed: "구체적인 API나 설정값은 최신 공식 문서에서 확인해."',
  answer_counterquestion:
    'Return {"text":"...","resolved":true|false}. Set resolved=false only if the user will likely continue the side question. If the user uses ambiguous references like "that/it/why that", resolve them to thread.lastChallengePrompt first (fallback: thread.lastAssistantPrompt) and answer directly. Do not bounce back with "what do you mean by that?" unless there is a real contradiction. Always reply in Korean informal speech (banmal), never honorific style. Before returning, run a strict style pass and rewrite any honorific ending (for example 요/예요/이에요/죠/나요/까요/습니다/세요) into banmal. Never produce clipped pseudo-banmal by deleting only "요"; rewrite the whole ending to a natural banmal form. Answer in a rival tone that still keeps the discussion moving.',
  direct_question:
    'The user asked a direct question in Slack DM. Interpret the latest question literally first. Do not invent confusion, hidden intent, or background that the user did not say. If a technical term overlaps with the bot name, answer the technical meaning first instead of roleplaying the ambiguity. Return {"text":"...","nextState":"open|awaiting_answer","challengePrompt":"question or null"} with a concise but sharp Vector-style answer in Korean informal speech (banmal). Never use honorific Korean endings. Before returning, run a strict style pass and rewrite any honorific ending (for example 요/예요/이에요/죠/나요/까요/습니다/세요) into banmal. Never produce clipped pseudo-banmal by deleting only "요"; rewrite the whole ending to a natural banmal form. Do not grade the user. Keep a genius rival tone, slightly mocking and clearly competitive. If payload.retrievedChunks is non-empty, ground the answer in those chunks and cite source labels like [source: ...]. If payload.freshnessType is "volatile", do not assert specific version details, API signatures, or configuration values as fact unless you are absolutely certain. Explain the stable principle and end with "최신 공식 문서 확인 필요" when the answer depends on current versions or API changes.',
  direct_thread_turn:
    'The user replied inside an ongoing direct Q&A Slack thread. Use the provided history to answer the latest turn in Korean informal speech (banmal). Never use honorific Korean endings. Before returning, run a strict style pass and rewrite any honorific ending (for example 요/예요/이에요/죠/나요/까요/습니다/세요) into banmal. Never produce clipped pseudo-banmal by deleting only "요"; rewrite the whole ending to a natural banmal form. Interpret the latest message literally first. Do not invent confusion, hidden intent, or background that the user did not say. Use the thread state, thread.lastChallengePrompt, and last assistant prompt to decide whether the latest user turn is an answer attempt, a same-context follow-up, or a pivot to a new question. Treat short paraphrase, restatement, clarification, and understanding-check turns (for example, "in other words", "so", "so you mean...?") or tentative confirm/correct attempts as same-context technical turns. If the thread is awaiting an answer, evaluate the latest user message as an answer attempt against the current challenge before anything else. Short, tentative, partial, or plainly wrong replies to the current challenge are still answer attempts. Do not reject brief answers like guesses, rough summaries, or incomplete reasoning just because they are vague. If the latest user message explicitly says they do not know, you may open with one short rivalry taunt, then explain first in 1-2 concrete sentences, then optionally ask one same-context challenge; do not frame "I do not know" as evasion or refusal. Keep the taunt about answer quality only, never about identity/intelligence. If the user gives up and pivots to a new question in the same message, briefly close the failed challenge and then answer the pivot. Respect payload.thread.directQaStack and payload.thread.directQaStack.sealed: once sealed is true, never request push and resolve by pop/stay only. Return {"text":"...","operation":"push|pop|stay|close","nextPrompt":"string or null","passQuality":"strong|weak|null","nextState":"open|awaiting_answer","challengePrompt":"question or null"} only. Keep the reply provocative, tight, rival-like, and capable of handling answer attempt, same-context paraphrase confirmation, and pivot cleanly. If payload.retrievedChunks is non-empty, ground the answer in those chunks and cite source labels like [source: ...]. If payload.freshnessType is "volatile", do not state version-specific details as fact. Explain principles and flag time-sensitive claims with "최신 공식 문서 확인 필요".',
};

const TASK_EXECUTION_PROFILE = {
  topic: { reasoningEffort: "medium" },
  question: { reasoningEffort: "medium" },
  evaluate: { reasoningEffort: "high" },
  classify_study_turn: { reasoningEffort: "medium" },
  followup: { reasoningEffort: "medium" },
  teach: { reasoningEffort: "medium" },
  answer_counterquestion: { reasoningEffort: "medium" },
  direct_question: { reasoningEffort: "medium" },
  direct_thread_turn: { reasoningEffort: "medium" },
  default: { reasoningEffort: "medium" },
};

export function buildCodexExecArgs({
  taskType,
  outputPath,
  prompt,
  model = null,
  codexSessionId = null,
}) {
  const profile = TASK_EXECUTION_PROFILE[taskType] ?? TASK_EXECUTION_PROFILE.default;
  const args = [];

  if (model) {
    args.push("--model", model);
  }

  if (isSessionAwareTask(taskType) && codexSessionId) {
    args.push(
      "exec",
      "resume",
      "--skip-git-repo-check",
      "-c",
      `model_reasoning_effort="${profile.reasoningEffort}"`,
      "--output-last-message",
      outputPath,
      codexSessionId,
      prompt,
    );
    return args;
  }

  args.push(
    "exec",
    "--skip-git-repo-check",
  );

  if (isSessionAwareTask(taskType)) {
    args.push("--json");
  } else {
    args.push(
      "--sandbox",
      "read-only",
      "--ephemeral",
    );
  }

  args.push(
    "-c",
    `model_reasoning_effort="${profile.reasoningEffort}"`,
    "--output-last-message",
    outputPath,
    prompt,
  );

  return args;
}

function isSessionAwareTask(taskType) {
  return SESSION_AWARE_TASKS.has(taskType);
}

function normalizeSingleQuestionTasks(taskType, parsed) {
  if (taskType !== "question" && taskType !== "followup") {
    return parsed;
  }

  if (!parsed || typeof parsed.text !== "string") {
    return parsed;
  }

  return {
    ...parsed,
    text: keepSingleQuestion(parsed.text),
  };
}

function normalizeReplyStyle(taskType, parsed) {
  if (!parsed || typeof parsed !== "object") {
    return parsed;
  }

  if (!BANMAL_TASK_TYPES.has(taskType)) {
    return parsed;
  }

  const normalized = { ...parsed };
  if (typeof normalized.text === "string") {
    normalized.text = normalizeBanmalText(normalized.text);
  }
  if (typeof normalized.challengePrompt === "string") {
    normalized.challengePrompt = normalizeBanmalText(normalized.challengePrompt);
  }

  return normalized;
}

function normalizeDirectQaOperationContract(taskType, parsed) {
  if (!parsed || typeof parsed !== "object") {
    return parsed;
  }

  if (taskType !== "direct_question" && taskType !== "direct_thread_turn") {
    return parsed;
  }

  const operation = normalizeOperation(parsed.operation);
  const nextPrompt = normalizeNullableText(parsed.nextPrompt);
  const passQuality = parsed.passQuality === "weak" || parsed.passQuality === "strong"
    ? parsed.passQuality
    : null;
  const legacyNextState = parsed.nextState === "awaiting_answer" ? "awaiting_answer" : "open";
  const legacyChallengePrompt = normalizeNullableText(parsed.challengePrompt);

  let normalizedOperation = operation;
  let normalizedNextPrompt = nextPrompt;

  if (!normalizedOperation) {
    if (legacyNextState === "awaiting_answer" && legacyChallengePrompt) {
      normalizedOperation = "push";
      normalizedNextPrompt = normalizedNextPrompt ?? legacyChallengePrompt;
    } else if (legacyNextState === "open" && legacyChallengePrompt) {
      normalizedOperation = "stay";
      normalizedNextPrompt = normalizedNextPrompt ?? legacyChallengePrompt;
    } else {
      normalizedOperation = "stay";
    }
  }

  if ((normalizedOperation === "push" || normalizedOperation === "stay") && !normalizedNextPrompt) {
    normalizedNextPrompt = legacyChallengePrompt;
  }

  return {
    ...parsed,
    operation: normalizedOperation,
    nextPrompt: normalizedNextPrompt ?? null,
    passQuality,
  };
}

function normalizeOperation(operation) {
  if (operation === "push" || operation === "pop" || operation === "stay" || operation === "close") {
    return operation;
  }

  return null;
}

function normalizeNullableText(value) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
}

function keepSingleQuestion(text) {
  const compact = String(text ?? "")
    .replace(/\s+/gu, " ")
    .trim();

  if (!compact) {
    return compact;
  }

  const firstLine = compact.split(/\r?\n/u, 1)[0].trim();
  const questionCandidates = extractQuestionCandidates(firstLine);

  if (questionCandidates.length > 0) {
    const chosenQuestion = pickMainQuestionCandidate(questionCandidates);
    const trimmedQuestion = stripLeadingStatementBeforeQuestion(chosenQuestion);
    const singleClause = sliceBeforeJoinedSecondAsk(trimmedQuestion).trim();

    return singleClause || trimmedQuestion;
  }

  const singleClause = sliceBeforeJoinedSecondAsk(firstLine).trim();

  return singleClause || firstLine;
}

function stripLeadingStatementBeforeQuestion(text) {
  const normalized = String(text ?? "").trim();
  if (!/[?？]/u.test(normalized)) {
    return normalized;
  }

  const questionChunk = normalized.match(/[^?？]+[?？]/u)?.[0]?.trim() ?? normalized;
  let pivot = -1;
  for (const match of questionChunk.matchAll(/[.!…](?=\s+)/gu)) {
    if (typeof match.index === "number") {
      pivot = match.index;
    }
  }

  if (pivot < 0) {
    return questionChunk;
  }

  const stripped = questionChunk.slice(pivot + 1).trim();
  return stripped || questionChunk;
}

function extractQuestionCandidates(text) {
  return text
    .match(/[^?？]+[?？]/gu)?.map((item) => item.trim()) ?? [];
}

function pickMainQuestionCandidate(candidates) {
  for (const candidate of candidates) {
    if (!isLikelyTauntQuestion(candidate)) {
      return candidate;
    }
  }

  return candidates[0];
}

function isLikelyTauntQuestion(text) {
  const normalized = String(text ?? "").toLowerCase();
  const hasTauntCue = /(이 정도는|안 틀리겠지|버티겠지|알겠지|설마|모르면 실망|긴장|기초 중의 기초|운이 좋았네)/u
    .test(normalized);
  const hasTechnicalSignal = /[`()[\]{}]|[a-z]{2,}|(?:이벤트 루프|마이크로태스크|렌더링|캐시|네트워크|스레드|프로세스|인덱스|트랜잭션)/iu
    .test(text);

  return hasTauntCue && !hasTechnicalSignal;
}

function sliceBeforeJoinedSecondAsk(text) {
  const match = text.match(/,\s*(?:그리고|and)\s+/iu);
  if (!match || typeof match.index !== "number") {
    return text;
  }

  return text.slice(0, match.index).trim();
}

function normalizeBanmalText(text) {
  const raw = String(text ?? "");
  if (!raw) {
    return raw;
  }

  let normalized = raw;
  const endingBoundary = String.raw`(?=\s*(?:["'”’)\]]*[.!?,…~]|$))`;
  const questionBoundary = String.raw`(?=\s*(?:["'”’)\]]*[?!]|$))`;
  const replacements = [
    [new RegExp(`해보시겠어요${questionBoundary}`, "gu"), "해볼래"],
    [new RegExp(`해보시겠어${questionBoundary}`, "gu"), "해볼래"],
    [new RegExp(`해주시겠어요${questionBoundary}`, "gu"), "해줄래"],
    [new RegExp(`해주시겠어${questionBoundary}`, "gu"), "해줄래"],
    [new RegExp(`시겠어요${questionBoundary}`, "gu"), "겠어"],
    [new RegExp(`시겠어${questionBoundary}`, "gu"), "겠어"],
    [new RegExp(`시겠습니다${endingBoundary}`, "gu"), "겠어"],
    [new RegExp(`이죠${endingBoundary}`, "gu"), "이지"],
    [new RegExp(`죠${endingBoundary}`, "gu"), "지"],
    [new RegExp(`뭐예요${questionBoundary}`, "gu"), "뭐야"],
    [new RegExp(`뭐예${questionBoundary}`, "gu"), "뭐야"],
    [new RegExp(`이에요${endingBoundary}`, "gu"), "이야"],
    [new RegExp(`예요${endingBoundary}`, "gu"), "야"],
    [new RegExp(`입니다${endingBoundary}`, "gu"), "이야"],
    [new RegExp(`있습니다${endingBoundary}`, "gu"), "있어"],
    [new RegExp(`없습니다${endingBoundary}`, "gu"), "없어"],
    [new RegExp(`알겠습니다${endingBoundary}`, "gu"), "알겠어"],
    [new RegExp(`겠습니다${endingBoundary}`, "gu"), "겠어"],
    [new RegExp(`겠어요${endingBoundary}`, "gu"), "겠어"],
    [new RegExp(`됩니다${endingBoundary}`, "gu"), "돼"],
    [new RegExp(`가능합니다${endingBoundary}`, "gu"), "가능해"],
    [new RegExp(`합니다${endingBoundary}`, "gu"), "해"],
    [new RegExp(`해주세요${endingBoundary}`, "gu"), "해줘"],
    [new RegExp(`해보세요${endingBoundary}`, "gu"), "해봐"],
    [new RegExp(`하세요${endingBoundary}`, "gu"), "해"],
    [new RegExp(`십시오${endingBoundary}`, "gu"), "해"],
    [new RegExp(`인가요${endingBoundary}`, "gu"), "인가"],
    [new RegExp(`나요${questionBoundary}`, "gu"), "나"],
    [new RegExp(`까요${questionBoundary}`, "gu"), "까"],
    [new RegExp(`해요${endingBoundary}`, "gu"), "해"],
    [new RegExp(`돼요${endingBoundary}`, "gu"), "돼"],
    [new RegExp(`있어요${endingBoundary}`, "gu"), "있어"],
    [new RegExp(`없어요${endingBoundary}`, "gu"), "없어"],
    [new RegExp(`맞아요${endingBoundary}`, "gu"), "맞아"],
    [new RegExp(`아니에요${endingBoundary}`, "gu"), "아니야"],
    [new RegExp(`그래요${endingBoundary}`, "gu"), "그래"],
  ];

  for (const [pattern, replacement] of replacements) {
    normalized = normalized.replace(pattern, replacement);
  }

  normalized = normalized.replace(/요$/gu, "");

  return normalized;
}

const BANMAL_TASK_TYPES = new Set([
  "question",
  "followup",
  "teach",
  "answer_counterquestion",
  "direct_question",
  "direct_thread_turn",
  "evaluate",
]);

const SESSION_AWARE_TASKS = new Set([
  "question",
  "classify_study_turn",
  "evaluate",
  "followup",
  "teach",
  "answer_counterquestion",
  "direct_question",
  "direct_thread_turn",
]);

export function parseCodexThreadIdFromStdout(stdout) {
  for (const line of String(stdout ?? "").split("\n")) {
    const trimmed = line.trim();

    if (!trimmed.startsWith("{")) {
      continue;
    }

    try {
      const event = JSON.parse(trimmed);
      if (event.type === "thread.started" && typeof event.thread_id === "string") {
        return event.thread_id;
      }
    } catch {
      // JSONL 사이에 섞여 들어온 경고 라인은 무시합니다.
    }
  }

  return null;
}

export { buildTaskPrompt };
export { parseTaskResult };
export { isSessionAwareTask };
export { keepSingleQuestion };
export { normalizeBanmalText };
