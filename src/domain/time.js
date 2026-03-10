const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

function toKstDateParts(date) {
  const kstDate = new Date(date.getTime() + KST_OFFSET_MS);

  return {
    year: kstDate.getUTCFullYear(),
    month: kstDate.getUTCMonth(),
    day: kstDate.getUTCDate(),
    hours: kstDate.getUTCHours(),
    minutes: kstDate.getUTCMinutes(),
    seconds: kstDate.getUTCSeconds(),
    milliseconds: kstDate.getUTCMilliseconds(),
  };
}

function fromKstDateParts(parts) {
  return new Date(
    Date.UTC(
      parts.year,
      parts.month,
      parts.day,
      parts.hours - 9,
      parts.minutes,
      parts.seconds,
      parts.milliseconds,
    ),
  );
}

export function endOfKstDay(date) {
  const parts = toKstDateParts(date);

  return fromKstDateParts({
    ...parts,
    hours: 23,
    minutes: 59,
    seconds: 59,
    milliseconds: 999,
  });
}

export function addKstDays(date, days) {
  const parts = toKstDateParts(date);

  return fromKstDateParts({
    ...parts,
    day: parts.day + days,
  });
}
