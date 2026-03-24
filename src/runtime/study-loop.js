import { createDispatchDelayMs } from "../app/interval-policy.js";

const NOOP_LOGGER = {
  debug() {},
  error() {},
};

export class StudyLoop {
  constructor({
    tutorBot,
    createDelayMs = () => createDispatchDelayMs(),
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
    now = () => new Date(),
    logger = NOOP_LOGGER,
  }) {
    this.tutorBot = tutorBot;
    this.createDelayMs = createDelayMs;
    this.setTimeoutFn = setTimeoutFn;
    this.clearTimeoutFn = clearTimeoutFn;
    this.now = now;
    this.logger = logger;
    this.pendingTimer = null;
    this.loopEnabled = false;
  }

  scheduleNextQuestion() {
    this.loopEnabled = true;
    this.cancelPendingDispatch("reschedule");

    const delayMs = this.createDelayMs();
    this.logger.debug("study_loop.scheduled", {
      delayMs,
    });
    this.pendingTimer = this.setTimeoutFn(async () => {
      this.pendingTimer = null;
      this.logger.debug("study_loop.fired", {
        delayMs,
      });

      try {
        await this.tutorBot.dispatchNextQuestion(this.now());
      } catch (error) {
        this.logger.error("study_loop.dispatch_failed", {
          message: error.message,
        });
      } finally {
        if (this.loopEnabled) {
          this.scheduleNextQuestion();
        }
      }
    }, delayMs);

    return delayMs;
  }

  handleControlCommand(command) {
    if (command === "stop") {
      this.loopEnabled = false;
    }

    if (command === "start" || command === "stop") {
      this.cancelPendingDispatch(`control:${command}`);
    }
  }

  cancelPendingDispatch(reason = "cancelled") {
    if (!this.pendingTimer) {
      return false;
    }

    this.clearTimeoutFn(this.pendingTimer);
    this.pendingTimer = null;
    this.logger.debug("study_loop.cancelled", {
      reason,
    });
    return true;
  }
}
