/**
 * Normalize a `since` filter value for message reads.
 *
 * The cloud API (and the local SQLite `created_at > ?` filter) expect an
 * absolute ISO-8601 timestamp. Users, however, routinely pass relative
 * durations like `7d`, `24h`, `30m`, `1w`, `45s`, or combos such as `1w2d3h`.
 * Forwarding those straight through made the serve API 500 on an
 * unparseable `since=7d`, and silently mismatched the local `created_at > ?`
 * string comparison. This converts a relative duration into
 * `new Date(now - ms).toISOString()` while leaving any absolute / ISO value
 * (or anything that is not a pure duration) untouched — so the behaviour is
 * backward-compatible and fully reversible.
 */

const UNIT_MS: Record<string, number> = {
  s: 1_000, // seconds
  m: 60_000, // minutes
  h: 3_600_000, // hours
  d: 86_400_000, // days
  w: 604_800_000, // weeks
};

// A pure relative duration: one or more `<int><unit>` segments, optionally
// separated by whitespace, e.g. "7d", "24h", "30m", "1w", "45s", "1w2d3h".
const RELATIVE_DURATION = /^(?:\s*\d+\s*[smhdw]\s*)+$/i;
// Individual `<int><unit>` segments, extracted from a matched duration.
const SEGMENT = /(\d+)\s*([smhdw])/gi;
const EXACT_ISO_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$/;

/**
 * Validate and canonicalize an absolute ISO-8601 timestamp.
 *
 * Search uses this stricter surface because a malformed cutoff must not turn
 * into a successful string comparison that silently returns the wrong policy
 * population. Relative durations belong to the broader read surface; callers
 * of search must resolve one exact instant before querying.
 */
export function normalizeExactIsoTimestamp(value: string, label = "timestamp"): string {
  const trimmed = String(value).trim();
  const match = EXACT_ISO_TIMESTAMP.exec(trimmed);
  const year = Number(match?.[1]);
  const month = Number(match?.[2]);
  const day = Number(match?.[3]);
  const hour = Number(match?.[4]);
  const minute = Number(match?.[5]);
  const second = Number(match?.[6]);
  const offsetHour = match?.[9] ? Number(match[10]) : 0;
  const offsetMinute = match?.[9] ? Number(match[11]) : 0;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [0, 31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month] ?? 0;
  const fieldsValid = Boolean(match)
    && month >= 1 && month <= 12
    && day >= 1 && day <= daysInMonth
    && hour <= 23 && minute <= 59 && second <= 59
    && offsetHour <= 23 && offsetMinute <= 59;
  const millis = fieldsValid ? Date.parse(trimmed) : Number.NaN;
  if (!fieldsValid || !Number.isFinite(millis)) {
    throw new Error(`Invalid ${label}: expected an absolute ISO-8601 timestamp.`);
  }
  return new Date(millis).toISOString();
}

/**
 * Parse a relative duration string into milliseconds. Returns `null` when the
 * value is not a pure relative duration (e.g. an ISO timestamp), so callers can
 * treat it as an absolute value and pass it through unchanged.
 */
export function parseRelativeDurationMs(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed || !RELATIVE_DURATION.test(trimmed)) return null;
  let total = 0;
  let matched = false;
  for (const m of trimmed.matchAll(SEGMENT)) {
    const n = Number(m[1]);
    const unitMs = UNIT_MS[m[2].toLowerCase()];
    if (!Number.isFinite(n) || unitMs === undefined) return null;
    total += n * unitMs;
    matched = true;
  }
  return matched ? total : null;
}

/**
 * Convert a relative `--since` duration to an absolute ISO-8601 timestamp.
 * ISO / absolute / unrecognized values (and empty/undefined) are returned
 * unchanged (undefined for empty), so ISO timestamps keep working exactly as
 * before.
 *
 * @param value The raw `since` value (relative duration or absolute timestamp).
 * @param now   Reference epoch millis; injectable for deterministic tests.
 */
export function normalizeSince(value?: string | null, now: number = Date.now()): string | undefined {
  if (value === undefined || value === null) return undefined;
  const trimmed = String(value).trim();
  if (!trimmed) return undefined;
  const ms = parseRelativeDurationMs(trimmed);
  if (ms === null) return trimmed; // ISO / absolute / unknown → unchanged
  return new Date(now - ms).toISOString();
}
