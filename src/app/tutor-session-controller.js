import {
  createInactiveSession,
  createStartedSession,
  deactivateSession,
} from "../domain/session-policy.js";
import { closeThread } from "../domain/thread-policy.js";

const RESUME_THREAD_REPLY = "도망은 거기까지지. 아까 막히던 데서 그대로 이어가자.";
const NOOP_LOGGER = {
  debug() {},
  error() {},
};

export function createTutorSessionController({
  store,
  slackClient,
  dispatchNextQuestion,
  logger = NOOP_LOGGER,
}) {
  async function applyControlCommand(command, now = new Date()) {
    const session = (await store.getSession()) ?? createInactiveSession();
    let nextSession = session;

    if (command === "start") {
      if (session.state === "inactive") {
        nextSession = createStartedSession(now);
      }
    } else if (command === "stop") {
      nextSession = session.state === "active"
        ? deactivateSession(session, now)
        : session;
    }

    await store.saveSession(nextSession);

    if (command === "stop") {
      const closedThreads = await closeOpenStudyThreadsAsStopped(now);
      logger.debug("tutor_bot.stop_closed_threads", {
        count: closedThreads.length,
      });
    }

    if (command === "start") {
      const resumedThread = await reopenLatestIncompleteStudyThread();

      if (resumedThread) {
        return nextSession;
      }

      const openThreads = await store.listOpenThreads();
      const hasOpenStudyThread = openThreads.some((thread) => (thread.kind ?? "study") === "study");

      if (nextSession.state === "active" && hasOpenStudyThread === false) {
        try {
          await dispatchNextQuestion(now);
        } catch (error) {
          logger.error("tutor_bot.start_dispatch_failed", {
            message: error?.message ?? String(error),
          });
        }
      }
    }

    return nextSession;
  }

  async function reopenLatestIncompleteStudyThread() {
    if (typeof store.getLatestIncompleteStudyThread !== "function") {
      return null;
    }

    const latestIncompleteStudyThread = await store.getLatestIncompleteStudyThread();
    if (!latestIncompleteStudyThread) {
      return null;
    }

    const reopenedThread = {
      ...latestIncompleteStudyThread,
      status: "open",
      closedAt: null,
    };
    await store.saveThread(reopenedThread);
    await slackClient.postThreadReply(reopenedThread.slackThreadTs, RESUME_THREAD_REPLY);
    logger.debug("tutor_bot.start_resumed_thread", {
      threadTs: reopenedThread.slackThreadTs,
      topicId: reopenedThread.topicId,
    });
    return reopenedThread;
  }

  async function closeOpenStudyThreadsAsStopped(now = new Date()) {
    const openThreads = await store.listOpenThreads();
    const openStudyThreads = openThreads.filter((thread) => (thread.kind ?? "study") === "study");
    const closedThreads = [];

    for (const thread of openStudyThreads) {
      const closedThread = closeThread(thread, "stopped", now);
      await store.saveThread(closedThread);
      closedThreads.push(closedThread);
    }

    return closedThreads;
  }

  return {
    applyControlCommand,
    reopenLatestIncompleteStudyThread,
    closeOpenStudyThreadsAsStopped,
  };
}
