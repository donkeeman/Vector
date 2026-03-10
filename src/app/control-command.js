const COMMAND_ALIASES = new Map([
  ["/study-start", "start"],
  ["start", "start"],
  ["시작", "start"],
  ["/study-pause", "pause"],
  ["pause", "pause"],
  ["중단", "pause"],
  ["/study-resume", "resume"],
  ["resume", "resume"],
  ["재개", "resume"],
  ["/study-end", "end"],
  ["end", "end"],
  ["끝", "end"],
]);

export function normalizeControlCommand(input) {
  const normalized = input.trim().toLowerCase();
  return COMMAND_ALIASES.get(normalized) ?? null;
}
