const COMMAND_ALIASES = new Map([
  ["!start", "start"],
  ["!stop", "stop"],
]);

export function normalizeControlCommand(input) {
  const normalized = input.trim().toLowerCase();
  return COMMAND_ALIASES.get(normalized) ?? null;
}
