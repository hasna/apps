const ISO_DATE_TIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/;
const NS_PER_MS = 1_000_000n;
const NS_PER_MINUTE = 60_000_000_000n;

function daysInMonth(year: number, month: number): number {
  const date = new Date(0);
  date.setUTCFullYear(year, month, 0);
  date.setUTCHours(0, 0, 0, 0);
  return date.getUTCDate();
}

function timestampBaseMs(year: number, month: number, day: number, hour: number, minute: number, second: number): number {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, 0);
  return date.getTime();
}

export function parseEventTimestamp(value: string): bigint {
  const match = ISO_DATE_TIME_RE.exec(value);
  if (!match) {
    throw new RangeError("Event start_at and end_at must be valid ISO 8601 date-time strings");
  }

  const year = Number(match[1]!);
  const month = Number(match[2]!);
  const day = Number(match[3]!);
  const hour = Number(match[4]!);
  const minute = Number(match[5]!);
  const second = Number(match[6]!);
  const fraction = match[7] || "";
  const offset = match[8]!;
  const maxDay = month >= 1 && month <= 12 ? daysInMonth(year, month) : 0;

  if (month < 1 || month > 12 || day < 1 || day > maxDay || hour > 23 || minute > 59 || second > 59) {
    throw new RangeError("Event start_at and end_at must be valid ISO 8601 date-time strings");
  }

  let offsetMinutes = 0;
  if (offset !== "Z") {
    const offsetSign = offset[0] === "-" ? -1 : 1;
    const offsetHour = Number(offset.slice(1, 3));
    const offsetMinute = Number(offset.slice(4, 6));
    if (offsetHour > 23 || offsetMinute > 59) {
      throw new RangeError("Event start_at and end_at must be valid ISO 8601 date-time strings");
    }
    offsetMinutes = offsetSign * (offsetHour * 60 + offsetMinute);
  }

  const timestamp = timestampBaseMs(year, month, day, hour, minute, second);
  if (!Number.isFinite(timestamp)) {
    throw new RangeError("Event start_at and end_at must be valid ISO 8601 date-time strings");
  }

  const fractionalNs = BigInt(fraction.padEnd(9, "0") || "0");
  return BigInt(timestamp) * NS_PER_MS + fractionalNs - BigInt(offsetMinutes) * NS_PER_MINUTE;
}

export function assertEventEndsAfterStart(startAt: string, endAt: string): void {
  const start = parseEventTimestamp(startAt);
  const end = parseEventTimestamp(endAt);

  if (end <= start) {
    throw new RangeError("Event end_at must be after start_at");
  }
}

export function parseTimeRange(startAt: string, endAt: string): { start: bigint; end: bigint } {
  const start = parseEventTimestamp(startAt);
  const end = parseEventTimestamp(endAt);

  if (end <= start) {
    throw new RangeError("Time range end must be after start");
  }

  return { start, end };
}

export function compareEventInstants(a: bigint, b: bigint): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function compareEventTimestampStrings(a: string, b: string): number {
  return compareEventInstants(parseEventTimestamp(a), parseEventTimestamp(b)) || a.localeCompare(b);
}
