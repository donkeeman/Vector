import { loadConfig } from "./config.js";
import { SlackMessageRouter } from "./app/slack-message-router.js";
import { TutorBot } from "./app/tutor-bot.js";
import { CodexCliRunner } from "./llm/codex-cli-runner.js";
import { SlackWebApiClient } from "./runtime/slack/slack-web-api-client.js";
import { SocketModeTransport } from "./runtime/slack/socket-mode-transport.js";
import { SqliteStore } from "./storage/sqlite-store.js";
import { DEFAULT_TOPICS } from "./topics/default-topics.js";

async function main() {
  const config = loadConfig();
  const store = new SqliteStore({ databasePath: config.databasePath });
  await store.init();

  const bot = new TutorBot({
    store,
    topics: DEFAULT_TOPICS,
    llmRunner: new CodexCliRunner({
      command: config.codexCommand,
      model: config.codexModel,
    }),
    slackClient: new SlackWebApiClient({
      botToken: config.slackBotToken,
      channelId: config.slackChannelId,
    }),
  });
  const router = new SlackMessageRouter({
    store,
    tutorBot: bot,
    llmRunner: bot.llmRunner,
    slackClient: bot.slackClient,
  });

  console.log("Vector bot core is initialized.");
  console.log("TutorBot instance ready:", Boolean(bot));

  if (config.slackAppToken) {
    try {
      const transport = new SocketModeTransport({
        appToken: config.slackAppToken,
        onMessageEvent: (event) => router.handleMessageEvent(event),
      });
      await transport.start();
    } catch (error) {
      console.error(String(error));
      console.error("Socket Mode transport failed to start.");
    }
  } else {
    console.log("SLACK_APP_TOKEN is missing. Slack transport was not started.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
