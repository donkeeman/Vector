import { endOfKstDay } from "./time.js";

export function createStartedSession(now) {
  return {
    state: "active",
    startedAt: now,
    expiresAt: endOfKstDay(now),
  };
}

export function deactivateSession(session) {
  return {
    ...session,
    state: "inactive",
  };
}

export function expireSessionIfNeeded(session, now) {
  if (!session.expiresAt) {
    return session;
  }

  if (session.state === "inactive") {
    return session;
  }

  if (now.getTime() <= session.expiresAt.getTime()) {
    return session;
  }

  return deactivateSession(session);
}

export function shouldDispatchAutoQuestion(session, hasCounterQuestionThread) {
  return session.state === "active" && hasCounterQuestionThread === false;
}

export function createInactiveSession() {
  return {
    state: "inactive",
    startedAt: null,
    expiresAt: null,
  };
}
