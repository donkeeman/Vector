const START_EVENTS = new Set([
  "system_did_wake",
  "screen_unlocked",
]);

const STOP_EVENTS = new Set([
  "system_will_sleep",
  "screen_locked",
]);

const NOOP_LOGGER = {
  debug() {},
  error() {},
};

export class SessionLifecycleManager {
  constructor({
    tutorBot,
    now = () => new Date(),
    onControlCommandApplied = async () => {},
    logger = NOOP_LOGGER,
  }) {
    this.tutorBot = tutorBot;
    this.now = now;
    this.onControlCommandApplied = onControlCommandApplied;
    this.logger = logger;
  }

  async handleAppLaunch() {
    this.logger.debug("lifecycle.app_launch");
    await this.#closeOpenStudyThreadsAsStale();
    const session = await this.tutorBot.applyControlCommand("start", this.now());
    await this.onControlCommandApplied("start", session);
    return session;
  }

  async handleEvent(eventName) {
    if (START_EVENTS.has(eventName)) {
      await this.#closeOpenStudyThreadsAsStale();
      this.logger.debug("lifecycle.event", {
        eventName,
        command: "start",
      });
      const session = await this.tutorBot.applyControlCommand("start", this.now());
      await this.onControlCommandApplied("start", session);
      return session;
    }

    if (STOP_EVENTS.has(eventName)) {
      this.logger.debug("lifecycle.event", {
        eventName,
        command: "stop",
      });
      const session = await this.tutorBot.applyControlCommand("stop", this.now());
      await this.onControlCommandApplied("stop", session);
      return session;
    }

    this.logger.debug("lifecycle.event_ignored", {
      eventName,
    });
    return null;
  }

  async #closeOpenStudyThreadsAsStale() {
    if (typeof this.tutorBot.closeOpenStudyThreadsAsStale !== "function") {
      return [];
    }

    const closedThreads = await this.tutorBot.closeOpenStudyThreadsAsStale(this.now());
    this.logger.debug("lifecycle.stale_threads_closed", {
      count: closedThreads.length,
    });
    return closedThreads;
  }
}
