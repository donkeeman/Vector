import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { runWithRetry } from "./run-with-retry.js";
import { VECTOR_SYSTEM_PROMPT } from "../persona/vector-system-prompt.js";

const execFileAsync = promisify(execFile);

export class CodexCliRunner {
  constructor({ command = "codex", workdir = process.cwd(), model = null } = {}) {
    this.command = command;
    this.workdir = workdir;
    this.model = model;
  }

  async runTask(taskType, payload) {
    return runWithRetry(
      () => this.#invoke(taskType, payload),
      {
        maxAttempts: 2,
        parser: (raw) => JSON.parse(raw),
      },
    );
  }

  async #invoke(taskType, payload) {
    const prompt = buildTaskPrompt(taskType, payload);
    const tmpPath = await mkdtemp(join(tmpdir(), "vector-codex-"));
    const outputPath = join(tmpPath, "output.json");

    try {
      const args = [
        "exec",
        "--skip-git-repo-check",
        "--sandbox",
        "read-only",
        "--output-last-message",
        outputPath,
        prompt,
      ];

      if (this.model) {
        args.unshift(this.model);
        args.unshift("--model");
      }

      await execFileAsync(this.command, args, {
        cwd: this.workdir,
        maxBuffer: 1024 * 1024 * 4,
      });

      return await readFile(outputPath, "utf8");
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

const TASK_INSTRUCTIONS = {
  question: 'Return {"text":"..."} with one concise CS question only.',
  evaluate:
    'Return {"outcome":"continue|blocked|mastered","rationale":"...","text":"optional closing reply when mastered"} based on the answer quality.',
  followup: 'Return {"text":"..."} with one sharper follow-up question only.',
  teach: 'Return {"text":"..."} with a brief explanation and correction.',
  answer_counterquestion:
    'Return {"text":"...","resolved":true|false}. Set resolved=false only if the user will likely continue the side question.',
  direct_question:
    'The user asked a direct CS question in Slack DM. Return {"text":"..."} with a concise but sharp Vector-style answer. Do not grade the user.',
};
