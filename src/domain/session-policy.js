import { endOfKstDay } from "./time.js";

export function createStartedSession(now) {
  return {
    state: "active",
    startedAt: now,
    pausedAt: null,
    endedAt: null,
    expiresAt: endOfKstDay(now),
  };
}

export function pauseSession(session, now) {
  return {
    ...session,
    state: "paused",
    pausedAt: now,
  };
}

export function resumeSession(session) {
  return {
    ...session,
    state: "active",
    pausedAt: null,
  };
}

export function endSession(session, now) {
  return {
    ...session,
    state: "ended",
    endedAt: now,
  };
}

export function expireSessionIfNeeded(session, now) {
  if (!session.expiresAt) {
    return session;
  }

  if (session.state === "ended") {
    return session;
  }

  if (now.getTime() <= session.expiresAt.getTime()) {
    return session;
  }

  return endSession(session, now);
}

export function shouldDispatchAutoQuestion(session, hasCounterQuestionThread) {
  return session.state === "active" && hasCounterQuestionThread === false;
}

export function createInactiveSession() {
  return {
    state: "inactive",
    startedAt: null,
    pausedAt: null,
    endedAt: null,
    expiresAt: null,
  };
}
