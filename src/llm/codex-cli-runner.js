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

  if (!isSessionAwareTask(taskType)) {
    return parsed;
  }

  return {
    ...parsed,
    codexSessionId: raw.codexThreadId ?? null,
  };
}

const TASK_INSTRUCTIONS = {
  question:
    'Return {"text":"..."} with one concise CS question only. The tone must be 도발적, playful, and openly competitive, like a genius rival testing weak points.',
  evaluate:
    'Return {"outcome":"continue|blocked|mastered","rationale":"...","text":"optional closing reply when mastered"} based on the answer quality.',
  followup:
    'Return {"text":"..."} with one sharper follow-up question only. Keep the tone 도발적 and irritated, as if the user barely earned the next question.',
  teach:
    'Return {"text":"..."} with a brief explanation that directly fixes the exact 막힌 지점. Rebuild a short 정답 구조 for the precise question they failed, not a generic recap. The tone should 비웃듯 sharp and competitive, not kind.',
  answer_counterquestion:
    'Return {"text":"...","resolved":true|false}. Set resolved=false only if the user will likely continue the side question. Answer in a 라이벌 tone that still keeps the discussion moving.',
  direct_question:
    'The user asked a direct question in Slack DM. Interpret the latest question literally first. Do not invent confusion, hidden intent, or background that the user did not say. If a technical term overlaps with the bot name, answer the technical meaning first instead of roleplaying the ambiguity. Return {"text":"...","nextState":"open|awaiting_answer","challengePrompt":"question or null"} with a concise but sharp Vector-style answer in Korean 반말. Do not grade the user. Keep a genius 라이벌 tone, slightly mocking and clearly competitive.',
  direct_thread_turn:
    'The user replied inside an ongoing direct Q&A Slack thread. Use the provided history to answer the latest turn in Korean 반말. Interpret the latest message literally first. Do not invent confusion, hidden intent, or background that the user did not say. Use the thread state and last assistant prompt to decide whether the latest user turn is an answer attempt, a same-context follow-up, or a pivot to a new question. Treat short paraphrase, restatement, clarification, and understanding-check turns such as "말하자면", "즉", "그러니까", "~인 건가?", or tentative confirm/correct attempts as same-context technical turns. If the thread is awaiting an answer, evaluate the latest user message as an answer attempt before anything else. Short, tentative, partial, or plainly wrong replies to the current challenge are still answer attempts. Do not reject brief answers like guesses, rough summaries, or incomplete reasoning just because they are vague. If the user gives up and pivots to a new question in the same message, briefly close the failed challenge and then answer the pivot. Return {"text":"...","nextState":"open|awaiting_answer","challengePrompt":"question or null"} only. Keep the reply 도발적, tight, rival-like, and capable of handling answer attempt, same-context paraphrase confirmation, and pivot cleanly.',
};

const TASK_EXECUTION_PROFILE = {
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
  return taskType === "direct_question"
    || taskType === "direct_thread_turn";
}

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
