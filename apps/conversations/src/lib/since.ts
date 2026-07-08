/**
 * Normalize a `since` filter value for message reads.
 *
 * The cloud API (and the local SQLite `created_at > ?` filter) expect an
 * absolute ISO-8601 timestamp. Users, however, routinely pass relative
 * durations like `7d`, `24h`, `30m`, `1w`, `45s`, or combos such as `1w2d3h`.
 * Forwarding those straight through made the self_hosted service 500 on an
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
