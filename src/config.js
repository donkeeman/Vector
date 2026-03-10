import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export function loadConfig(env = process.env) {
  const fileEnv = loadDotEnv();
  const mergedEnv = {
    ...fileEnv,
    ...env,
  };

  return {
    slackBotToken: mergedEnv.SLACK_BOT_TOKEN ?? "",
    slackAppToken: mergedEnv.SLACK_APP_TOKEN ?? "",
    slackChannelId: mergedEnv.SLACK_DM_CHANNEL_ID ?? "",
    codexCommand: mergedEnv.CODEX_COMMAND ?? "codex",
    codexModel: mergedEnv.CODEX_MODEL ?? null,
    databasePath: resolve(mergedEnv.DATABASE_PATH ?? "./data/vector.sqlite"),
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
