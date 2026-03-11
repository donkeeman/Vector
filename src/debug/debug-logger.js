export function createDebugLogger({
  enabled = false,
  now = () => new Date(),
  infoSink = console.log,
  errorSink = console.error,
} = {}) {
  return {
    enabled,
    debug(event, fields = {}) {
      if (!enabled) {
        return;
      }

      infoSink(formatDebugLog({
        ts: now().toISOString(),
        level: "debug",
        event,
        ...fields,
      }));
    },
    error(event, fields = {}) {
      if (!enabled) {
        return;
      }

      errorSink(formatDebugLog({
        ts: now().toISOString(),
        level: "error",
        event,
        ...fields,
      }));
    },
  };
}

export function previewText(text, maxLength = 80) {
  const normalized = String(text ?? "").replace(/\s+/gu, " ").trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength)}...`;
}

function formatDebugLog(payload) {
  return JSON.stringify({
    scope: "vector",
    ...payload,
  });
}
