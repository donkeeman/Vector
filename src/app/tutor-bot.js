import { normalizeControlCommand } from "./control-command.js";
import {
  createTutorQuestionDispatcher,
  pickTopicForContinuousFlow,
} from "./tutor-question-dispatcher.js";
import { createTutorSessionController } from "./tutor-session-controller.js";
import { createTutorThreadHandler } from "./tutor-thread-handler.js";

const NOOP_LOGGER = {
  debug() {},
  error() {},
};

export class TutorBot {
  constructor({
    store,
    llmRunner,
    slackClient,
    topics,
    topicSelector = pickTopicForContinuousFlow,
    random = Math.random,
    logger = NOOP_LOGGER,
  }) {
    this.store = store;
    this.llmRunner = llmRunner;
    this.slackClient = slackClient;
    this.topics = topics;
    this.topicSelector = topicSelector;
    this.random = random;
    this.logger = logger;

    this.questionDispatcher = createTutorQuestionDispatcher({
      store: this.store,
      llmRunner: this.llmRunner,
      slackClient: this.slackClient,
      topics: this.topics,
      topicSelector: this.topicSelector,
      random: this.random,
      logger: this.logger,
    });
    this.sessionController = createTutorSessionController({
      store: this.store,
      slackClient: this.slackClient,
      dispatchNextQuestion: (now) => this.dispatchNextQuestion(now),
      logger: this.logger,
    });
    this.threadHandler = createTutorThreadHandler({
      store: this.store,
      llmRunner: this.llmRunner,
      slackClient: this.slackClient,
      logger: this.logger,
    });
  }

  async handleControlInput(input, now = new Date()) {
    const command = normalizeControlCommand(input);

    if (!command) {
      return null;
    }

    return this.applyControlCommand(command, now);
  }

  async applyControlCommand(command, now = new Date()) {
    return this.sessionController.applyControlCommand(command, now);
  }

  async reopenLatestIncompleteStudyThread() {
    return this.sessionController.reopenLatestIncompleteStudyThread();
  }

  async closeOpenStudyThreadsAsStopped(now = new Date()) {
    return this.sessionController.closeOpenStudyThreadsAsStopped(now);
  }

  async dispatchNextQuestion(now = new Date()) {
    return this.questionDispatcher.dispatchNextQuestion(now);
  }

  async handleThreadMessage({ threadTs, text, now = new Date() }) {
    return this.threadHandler.handleThreadMessage({
      threadTs,
      text,
      now,
    });
  }
}
