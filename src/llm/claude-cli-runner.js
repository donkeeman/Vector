import { spawn } from "node:child_process";

import { runWithRetry } from "./run-with-retry.js";
import {
  buildTaskPrompt,
  isSessionAwareTask,
  parseTaskResult,
} from "./codex-cli-runner.js";

const NOOP_LOGGER = {
  debug() {},
  error() {},
};

export class ClaudeCliRunner {
  constructor({
    command = "claude",
    workdir = process.cwd(),
    model = null,
    timeoutMs = 120_000,
    logger = NOOP_LOGGER,
  } = {}) {
    this.command = command;
    this.workdir = workdir;
    this.model = model;
    this.timeoutMs = timeoutMs;
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
    const args = buildClaudeExecArgs({
      taskType,
      model: this.model,
      claudeSessionId: payload?.codexSessionId ?? null,
    });

    let stdout = "";
    const startedAt = Date.now();

    try {
      this.logger.debug("llm.task.start", {
        taskType,
        command: this.command,
      });

      ({ stdout } = await runClaudeWithStdin({
        command: this.command,
        args,
        prompt,
        cwd: this.workdir,
        timeoutMs: this.timeoutMs,
      }));
    } catch (error) {
      const envelope = parseClaudeResultEnvelope(error?.stdout ?? "");
      if (envelope?.isError) {
        throw new Error(`Claude CLI error: ${envelope.resultText}`);
      }

      this.logger.error("llm.task.error", {
        taskType,
        durationMs: Date.now() - startedAt,
        code: error.code ?? null,
        message: error.message,
      });
      throw error;
    }

    const envelope = parseClaudeResultEnvelope(stdout);
    if (!envelope) {
      this.logger.error("llm.task.error", {
        taskType,
        durationMs: Date.now() - startedAt,
        code: "CLAUDE_RESULT_PARSE_FAILED",
        message: "Failed to parse Claude CLI JSON envelope.",
      });
      throw new Error("Failed to parse Claude CLI JSON envelope.");
    }

    if (envelope.isError) {
      this.logger.error("llm.task.error", {
        taskType,
        durationMs: Date.now() - startedAt,
        code: "CLAUDE_RESULT_ERROR",
        message: envelope.resultText,
      });
      throw new Error(`Claude CLI error: ${envelope.resultText}`);
    }

    this.logger.debug("llm.task.success", {
      taskType,
      durationMs: Date.now() - startedAt,
    });
    return {
      outputText: envelope.resultText,
      codexThreadId: payload?.codexSessionId ?? envelope.sessionId ?? null,
    };
  }
}

export function buildClaudeExecArgs({
  taskType,
  model = null,
  claudeSessionId = null,
}) {
  const args = [];

  if (model) {
    args.push("--model", model);
  }

  args.push(
    "-p",
    "--output-format",
    "json",
    "--input-format",
    "text",
    "--tools",
    "",
    "--permission-mode",
    "bypassPermissions",
  );

  if (isSessionAwareTask(taskType) && claudeSessionId) {
    args.push("--resume", claudeSessionId);
  }

  return args;
}

export function parseClaudeResultEnvelope(stdout) {
  const lines = String(stdout ?? "")
    .split(/\r?\n/gu)
    .map((line) => line.trim())
    .filter(Boolean);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const payload = JSON.parse(lines[index]);
      if (typeof payload === "object" && payload !== null && "result" in payload) {
        return {
          resultText: typeof payload.result === "string"
            ? payload.result
            : JSON.stringify(payload.result),
          sessionId: typeof payload.session_id === "string" ? payload.session_id : null,
          isError: payload.is_error === true,
        };
      }
    } catch {
      // JSON이 아닌 출력 라인은 무시하고 역순으로 계속 탐색합니다.
    }
  }

  return null;
}

function runClaudeWithStdin({
  command,
  args,
  prompt,
  cwd,
  timeoutMs,
}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(attachOutput(error, { stdout, stderr }));
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      const error = new Error(
        timedOut
          ? `Claude CLI timed out after ${timeoutMs}ms`
          : `Command failed: ${command} ${args.join(" ")}`,
      );
      error.code = timedOut ? "ETIMEDOUT" : code;
      error.signal = signal;
      reject(attachOutput(error, { stdout, stderr }));
    });

    child.stdin.end(prompt);
  });
}

function attachOutput(error, { stdout, stderr }) {
  error.stdout = stdout;
  error.stderr = stderr;
  return error;
}
