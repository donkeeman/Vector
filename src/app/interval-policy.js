const MINUTES_TO_MS = 60 * 1000;

export function createDispatchDelayMs(random = Math.random) {
  const minutes = 1 + 2 * random();
  return Math.round(minutes * MINUTES_TO_MS);
}
