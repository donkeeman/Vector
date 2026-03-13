import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export function loadConfig(env = process.env) {
  const fileEnv = loadDotEnv();
  const mergedEnv = {
    ...fileEnv,
    ...env,
  };
  const llmProvider = String(mergedEnv.LLM_PROVIDER ?? "codex").trim().toLowerCase();
  const claudeTimeoutMs = Number.parseInt(mergedEnv.CLAUDE_TIMEOUT_MS ?? "120000", 10);

  return {
    slackBotToken: mergedEnv.SLACK_BOT_TOKEN ?? "",
    slackAppToken: mergedEnv.SLACK_APP_TOKEN ?? "",
    slackChannelId: mergedEnv.SLACK_DM_CHANNEL_ID ?? "",
    llmProvider: llmProvider === "claude" ? "claude" : "codex",
    codexCommand: mergedEnv.CODEX_COMMAND ?? "codex",
    codexModel: mergedEnv.CODEX_MODEL ?? null,
    claudeCommand: mergedEnv.CLAUDE_COMMAND ?? "claude",
    claudeModel: mergedEnv.CLAUDE_MODEL ?? null,
    claudeTimeoutMs: Number.isFinite(claudeTimeoutMs) && claudeTimeoutMs > 0
      ? claudeTimeoutMs
      : 120_000,
    databasePath: resolve(mergedEnv.DATABASE_PATH ?? "./data/vector.sqlite"),
    debugEnabled: mergedEnv.VECTOR_DEBUG === "1",
    autoStartEnabled: mergedEnv.VECTOR_AUTO_START !== "0",
    macosLifecycleEnabled: mergedEnv.VECTOR_MACOS_LIFECYCLE !== "0",
  };
}

function loadDotEnv(path = ".env") {
  if (!existsSync(path)) {
    return {};
  }

  const content = readFileSync(path, "utf8");
  const entries = content
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && line.startsWith("#") === false)
    .map((line) => {
      const [key, ...rest] = line.split("=");
      return [key, rest.join("=")];
    });

  return Object.fromEntries(entries);
}
