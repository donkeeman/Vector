const COMMAND_PATTERN = /^[!！]\s*(start|stop)\b/iu;

export function normalizeControlCommand(input) {
  const normalized = String(input ?? "").trim().toLowerCase();
  const matched = normalized.match(COMMAND_PATTERN);
  return matched?.[1] ?? null;
}
