import {
  createInactiveSession,
  createStartedSession,
  pauseSession,
  resumeSession,
} from "../domain/session-policy.js";
import { closeThread } from "../domain/thread-policy.js";

const STALE_THREAD_STATUS_REPLY = "테스트 재시작한다며? 이전 기록은 전부 쓰레기통에 버렸어. 깔끔하게 새 흐름에서 다시 붙어보자고. 이번엔 아까처럼 운 좋게 넘어갈 생각 마.";
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
      if (session.state === "paused") {
        nextSession = resumeSession(session);
      } else if (session.state === "inactive") {
        nextSession = createStartedSession(now);
      }
    } else if (command === "stop") {
      nextSession = session.state === "active"
        ? pauseSession(session, now)
        : session;
    }

    await store.saveSession(nextSession);

    if (command === "start" && session.state === "paused" && nextSession.state === "active") {
      await reopenLatestStoppedStudyThread();
    }

    if (command === "stop") {
      const closedThreads = await closeOpenThreadsAsStopped(now);
      logger.debug("tutor_bot.stop_closed_threads", {
        count: closedThreads.length,
      });
    }

    if (command === "start") {
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

  async function reopenLatestStoppedStudyThread() {
    if (typeof store.getLatestStoppedStudyThread !== "function") {
      return null;
    }

    const latestStoppedStudyThread = await store.getLatestStoppedStudyThread();
    if (!latestStoppedStudyThread) {
      return null;
    }

    const reopenedThread = {
      ...latestStoppedStudyThread,
      status: "open",
      closedAt: null,
    };
    await store.saveThread(reopenedThread);
    logger.debug("tutor_bot.start_resumed_thread", {
      threadTs: reopenedThread.slackThreadTs,
      topicId: reopenedThread.topicId,
    });
    return reopenedThread;
  }

  async function closeOpenThreadsAsStopped(now = new Date()) {
    const openThreads = await store.listOpenThreads();
    const closedThreads = [];

    for (const thread of openThreads) {
      const closedThread = closeThread(thread, "stopped", now);
      await store.saveThread(closedThread);
      closedThreads.push(closedThread);
    }

    return closedThreads;
  }

  async function closeOpenStudyThreadsAsStale(now = new Date()) {
    const openThreads = await store.listOpenThreads();
    const openStudyThreads = openThreads.filter((thread) => (thread.kind ?? "study") === "study");
    const closedThreads = [];

    for (const thread of openStudyThreads) {
      try {
        await slackClient.postThreadReply(thread.slackThreadTs, STALE_THREAD_STATUS_REPLY);
      } catch (error) {
        logger.error("tutor_bot.stale_notice_failed", {
          threadTs: thread.slackThreadTs,
          message: error?.message ?? String(error),
        });
      }
      const closedThread = closeThread(thread, "stale", now);
      await store.saveThread(closedThread);
      closedThreads.push(closedThread);
    }

    return closedThreads;
  }

  return {
    applyControlCommand,
    reopenLatestStoppedStudyThread,
    closeOpenThreadsAsStopped,
    closeOpenStudyThreadsAsStale,
  };
}
