/**
 * Since-cursor comparison for changed-since feeds.
 *
 * Stored `updated_at` stamps mix ISO ("2026-08-05T18:54:55.814Z") with
 * space-form ("2026-06-10 11:24:47" — the DDL default `datetime('now')`, plus
 * snapshot import/sync). As TEXT, space (0x20) sorts before 'T' (0x54), so a
 * raw `updated_at > since` comparison silently excludes space-form rows that
 * are genuinely NEWER than an ISO cursor. This compares the stamps as
 * INSTANTS, mirroring the SQL `julianday()` predicate used by the
 * SQLite/Postgres updated_after paths (task-crud.ts), including its
 * keep-unparseable semantics: a stamp julianday() cannot parse yields NULL
 * and the row is KEPT, because "cannot read the row's timestamp" is not
 * "older than the cursor".
 *
 * The parser is deliberately SQLite-faithful rather than `Date.parse`-based,
 * because the two disagree in ways that change the comparison:
 *
 * - SQLite accepts ONLY an uppercase 'T' (or space) separator and an
 *   uppercase 'Z' (or `±HH:MM`) offset; `Date.parse` also accepts lowercase
 *   't'/'z', so a row SQLite would read as NULL (and KEEP) would otherwise be
 *   excluded.
 * - SQLite parses the fractional seconds to microsecond precision;
 *   `Date.parse` truncates to milliseconds, so stamps that differ only in the
 *   sub-millisecond digits would compare equal (and be excluded) instead of
 *   newer.
 * - SQLite rejects out-of-range calendar fields (month 13, day 32, hour 25,
 *   second 61); `Date.UTC` normalizes them, which would silently accept a
 *   stamp SQLite treats as unreadable.
 *
 * Naive (no-offset) stamps are read as UTC, matching SQLite julianday().
 * Offsets are applied by subtraction, matching julianday('...+02:00') ==
 * UTC minus two hours.
 */

const SQLITE_STAMP =
  /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(?:Z|([+-])(\d{2}):(\d{2}))?)?$/;

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * SQLite julianday() equivalent for the stamp grammar this codebase writes
 * and imports. Returns the day number as a double (the same arithmetic SQLite
 * uses: unix-seconds-as-double plus the fractional day), or null when SQLite
 * would return NULL (row kept by the caller).
 */
function sqliteJulianDay(value: string): number | null {
  const m = SQLITE_STAMP.exec(value);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = m[4] === undefined ? 0 : Number(m[4]);
  const minute = m[5] === undefined ? 0 : Number(m[5]);
  const second = m[6] === undefined ? 0 : Number(m[6]);
  const frac = m[7];
  const sign = m[8];
  const offsetHour = m[9];
  const offsetMinute = m[10];

  if (month < 1 || month > 12) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;
  // month is validated 1..12 above, so the table read is in range.
  const maxDay = (DAYS_IN_MONTH[month - 1] ?? 0) + (month === 2 && isLeapYear(year) ? 1 : 0);
  if (day < 1 || day > maxDay) return null;

  let offsetMinutes = 0;
  if (sign !== undefined) {
    // The regex guarantees both offset groups when the sign group matched.
    const oh = Number(offsetHour ?? "0");
    const om = Number(offsetMinute ?? "0");
    if (oh > 23 || om > 59) return null;
    offsetMinutes = oh * 60 + om;
    if (sign === "-") offsetMinutes = -offsetMinutes;
  }

  // SQLite parses at most 6 fractional digits (microseconds).
  const micros = frac === undefined ? 0 : Number((frac + "000000").slice(0, 6));
  const ms = Date.UTC(year, month - 1, day, hour, minute, second);
  return (ms + micros / 1000) / 86400000 + 2440587.5 - offsetMinutes / 1440;
}

export function changedSinceStampNewer(stamp: string, since: string): boolean {
  const stampJd = sqliteJulianDay(stamp);
  if (stampJd === null) return true; // unparseable row stamp -> keep
  const sinceJd = sqliteJulianDay(since);
  if (sinceJd === null) return false; // unparseable cursor -> comparison is NULL -> not newer
  return stampJd > sinceJd;
}
