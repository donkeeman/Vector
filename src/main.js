import { loadConfig } from "./config.js";
import { SlackMessageRouter } from "./app/slack-message-router.js";
import { createDebugLogger } from "./debug/debug-logger.js";
import { TutorBot } from "./app/tutor-bot.js";
import { CodexCliRunner } from "./llm/codex-cli-runner.js";
import { ClaudeCliRunner } from "./llm/claude-cli-runner.js";
import { SlackWebApiClient } from "./runtime/slack/slack-web-api-client.js";
import { SocketModeTransport } from "./runtime/slack/socket-mode-transport.js";
import { SessionLifecycleManager } from "./runtime/macos/session-lifecycle-manager.js";
import { SessionLifecycleMonitor } from "./runtime/macos/session-lifecycle-monitor.js";
import { StudyLoop } from "./runtime/study-loop.js";
import { SqliteStore } from "./storage/sqlite-store.js";

async function main() {
  const config = loadConfig();
  const logger = createDebugLogger({
    enabled: config.debugEnabled,
  });
  const store = new SqliteStore({ databasePath: config.databasePath });
  await store.init();
  const llmRunner = createLlmRunner({ config, logger });

  const bot = new TutorBot({
    store,
    topics: [],
    llmRunner,
    slackClient: new SlackWebApiClient({
      botToken: config.slackBotToken,
      channelId: config.slackChannelId,
      logger,
    }),
  });
  const studyLoop = new StudyLoop({
    tutorBot: bot,
    logger,
  });
  const router = new SlackMessageRouter({
    store,
    tutorBot: bot,
    llmRunner: bot.llmRunner,
    slackClient: bot.slackClient,
    onControlCommandApplied: async (command, session) => {
      studyLoop.handleControlCommand(command);
      if (command === "start" && session?.state === "active") {
        studyLoop.scheduleNextQuestion();
      }
    },
    onStudyThreadClosed: async (result) => {
      if (result?.shouldScheduleNextQuestion) {
        studyLoop.scheduleNextQuestion();
      }
    },
    logger,
  });
  const lifecycleManager = new SessionLifecycleManager({
    tutorBot: bot,
    onControlCommandApplied: async (command, session) => {
      studyLoop.handleControlCommand(command);
      if (command === "start" && session?.state === "active") {
        studyLoop.scheduleNextQuestion();
      }
    },
    logger,
  });
  const canAutoControlSession = Boolean(config.slackBotToken && config.slackChannelId);

  console.log("Vector bot core is initialized.");
  console.log("TutorBot instance ready:", Boolean(bot));
  console.log(`LLM provider: ${config.llmProvider}`);

  if (config.slackAppToken) {
    try {
      const transport = new SocketModeTransport({
        appToken: config.slackAppToken,
        onMessageEvent: (event) => router.handleMessageEvent(event),
        logger,
      });
      await transport.start();
    } catch (error) {
      console.error(String(error));
      console.error("Socket Mode transport failed to start.");
    }
  } else {
    console.log("SLACK_APP_TOKEN is missing. Slack transport was not started.");
  }

  if (config.autoStartEnabled && canAutoControlSession) {
    try {
      await lifecycleManager.handleAppLaunch();
      console.log("Vector auto-start is active.");
    } catch (error) {
      console.error(String(error));
      console.error("Auto session start failed.");
    }
  } else if (config.autoStartEnabled) {
    console.log("Auto session start was skipped because Slack bot credentials are incomplete.");
  }

  if (config.macosLifecycleEnabled && canAutoControlSession) {
    try {
      const monitor = new SessionLifecycleMonitor({
        onEvent: (eventName) => lifecycleManager.handleEvent(eventName),
        logger,
      });
      await monitor.start();
    } catch (error) {
      console.error(String(error));
      console.error("macOS lifecycle monitor failed to start.");
    }
  }
}

function createLlmRunner({ config, logger }) {
  if (config.llmProvider === "claude") {
    return new ClaudeCliRunner({
      command: config.claudeCommand,
      model: config.claudeModel,
      timeoutMs: config.claudeTimeoutMs,
      logger,
    });
  }

  return new CodexCliRunner({
    command: config.codexCommand,
    model: config.codexModel,
    logger,
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
