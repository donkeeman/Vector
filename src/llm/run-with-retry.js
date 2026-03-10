export async function runWithRetry(task, { maxAttempts = 2, parser }) {
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const raw = await task();
      return parser(raw);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}
