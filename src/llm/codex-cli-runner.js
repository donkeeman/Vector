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
  constructor({ command = "codex", workdir = process.cwd(), model = null, logger = NOOP_LOGGER } = {}) {
    this.command = command;
    this.workdir = workdir;
    this.model = model;
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
  const parsed = JSON.parse(raw.outputText);
  const questionNormalized = normalizeSingleQuestionTasks(taskType, parsed);
  const normalized = normalizeReplyStyle(taskType, questionNormalized);

  if (!isSessionAwareTask(taskType)) {
    return normalized;
  }

  return {
    ...normalized,
    codexSessionId: raw.codexThreadId ?? null,
  };
}

const TASK_INSTRUCTIONS = {
  topic:
    'Return {"topic":{"id":"kebab-case-id","title":"...","category":"...","promptSeed":"...","weight":1-10}} for a new CS/dev learning topic. Avoid duplicates with existingTopics/recentTopics. Pick broad computer-science or adjacent engineering topics (os, network, database, language runtime, distributed systems, security, tooling, testing, architecture). Do not output a question in this task; only topic metadata.',
  question:
    'Return {"text":"..."} with exactly one concise CS question only. Never combine two asks in one turn (no multi-part asks joined by "and" equivalents). If payload.topicMemory is null or topicMemory.attemptCount is 0, ask a foundational concept-definition question first (for example "X가 뭐야?" level) before mechanism-heavy depth. If you add rivalry taunt, keep it as a statement without a question mark. The only question mark must belong to the technical question. The tone must be provocative, playful, and openly competitive, like a genius rival testing weak points.',
  evaluate:
    'Return {"outcome":"continue|blocked|mastered","rationale":"...","text":"optional closing reply when mastered"} based on the answer quality. Evaluate the user answer against thread.lastChallengePrompt first (fallback: thread.lastAssistantPrompt). If the latest user message contains ambiguous references such as "that/it/why that", resolve them to thread.lastChallengePrompt by default when available.',
  followup:
    'Return {"text":"..."} with exactly one sharper follow-up question only. Keep the follow-up anchored to the same sub-concept as thread.lastChallengePrompt and evaluation.rationale; do not jump to a different topic. Never stack two follow-up asks in one message. If you add rivalry taunt, keep it as a statement without a question mark. The only question mark must belong to the technical follow-up. Keep the tone provocative and irritated, as if the user barely earned the next question.',
  teach:
    'Return {"text":"...","challengePrompt":"..."} where text gives a brief correction for the exact failure point and challengePrompt gives exactly one re-check question on the same sub-concept as thread.lastChallengePrompt. Rebuild a short answer scaffold for the precise question they failed, not a generic recap. If the user says "that/it/why that" ambiguously, treat it as referring to thread.lastChallengePrompt first (fallback: thread.lastAssistantPrompt) and explain directly instead of asking what it means. The tone should be sharp, slightly mocking, and competitive, not kind.',
  answer_counterquestion:
    'Return {"text":"...","resolved":true|false}. Set resolved=false only if the user will likely continue the side question. If the user uses ambiguous references like "that/it/why that", resolve them to thread.lastChallengePrompt first (fallback: thread.lastAssistantPrompt) and answer directly. Do not bounce back with "what do you mean by that?" unless there is a real contradiction. Always reply in Korean informal speech (banmal), never honorific style. Answer in a rival tone that still keeps the discussion moving.',
  direct_question:
    'The user asked a direct question in Slack DM. Interpret the latest question literally first. Do not invent confusion, hidden intent, or background that the user did not say. If a technical term overlaps with the bot name, answer the technical meaning first instead of roleplaying the ambiguity. Return {"text":"...","nextState":"open|awaiting_answer","challengePrompt":"question or null"} with a concise but sharp Vector-style answer in Korean informal speech (banmal). Never use honorific Korean endings. Do not grade the user. Keep a genius rival tone, slightly mocking and clearly competitive.',
  direct_thread_turn:
    'The user replied inside an ongoing direct Q&A Slack thread. Use the provided history to answer the latest turn in Korean informal speech (banmal). Never use honorific Korean endings. Interpret the latest message literally first. Do not invent confusion, hidden intent, or background that the user did not say. Use the thread state, thread.lastChallengePrompt, and last assistant prompt to decide whether the latest user turn is an answer attempt, a same-context follow-up, or a pivot to a new question. Treat short paraphrase, restatement, clarification, and understanding-check turns (for example, "in other words", "so", "so you mean...?") or tentative confirm/correct attempts as same-context technical turns. If the thread is awaiting an answer, evaluate the latest user message as an answer attempt against the current challenge before anything else. Short, tentative, partial, or plainly wrong replies to the current challenge are still answer attempts. Do not reject brief answers like guesses, rough summaries, or incomplete reasoning just because they are vague. If the user gives up and pivots to a new question in the same message, briefly close the failed challenge and then answer the pivot. Return {"text":"...","nextState":"open|awaiting_answer","challengePrompt":"question or null"} only. Keep the reply provocative, tight, rival-like, and capable of handling answer attempt, same-context paraphrase confirmation, and pivot cleanly.',
};

const TASK_EXECUTION_PROFILE = {
  topic: { reasoningEffort: "medium" },
  question: { reasoningEffort: "medium" },
  evaluate: { reasoningEffort: "high" },
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
    const singleClause = sliceBeforeJoinedSecondAsk(chosenQuestion).trim();

    return singleClause || chosenQuestion;
  }

  const singleClause = sliceBeforeJoinedSecondAsk(firstLine).trim();

  return singleClause || firstLine;
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
  const replacements = [
    [/입니다(?=[.!?]|$)/gu, "이야"],
    [/있습니다(?=[.!?]|$)/gu, "있어"],
    [/없습니다(?=[.!?]|$)/gu, "없어"],
    [/됩니다(?=[.!?]|$)/gu, "돼"],
    [/가능합니다(?=[.!?]|$)/gu, "가능해"],
    [/합니다(?=[.!?]|$)/gu, "해"],
    [/해주세요(?=[.!?]|$)/gu, "해줘"],
    [/해보세요(?=[.!?]|$)/gu, "해봐"],
    [/하세요(?=[.!?]|$)/gu, "해"],
    [/십시오(?=[.!?]|$)/gu, "해"],
  ];

  for (const [pattern, replacement] of replacements) {
    normalized = normalized.replace(pattern, replacement);
  }

  normalized = normalized.replace(/(요)(?=[.!?])/gu, "");
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

export { keepSingleQuestion };
export { normalizeBanmalText };
