/**
 * Freshness of stored registrar facts.
 *
 * A date in the `domains` table is an assertion made at the moment of the last
 * registrar sync, not a current fact. Nothing in the row said when that moment
 * was: `updated_at` moves when ANY column is edited and does NOT move when a
 * sync re-confirms an unchanged value, so it cannot answer "how fresh is this
 * expiry date". `expiry_synced_at` answers exactly that and nothing else.
 *
 * This is the same pattern `domain_reputation.last_checked_at` already uses for
 * reputation checks; the domains table never got it.
 */

/** Beyond this, a stored registrar fact is reported as stale. */
export const DEFAULT_STALE_AFTER_DAYS = 7;

export type FreshnessState = "fresh" | "stale" | "never";

export interface Freshness {
  state: FreshnessState;
  /** Whole days since the last sync; null when never synced. */
  age_days: number | null;
  /** The value read, echoed back so a caller can show its provenance. */
  synced_at: string | null;
}

const MS_PER_DAY = 86_400_000;

function parseTimestamp(value: string | null | undefined): Date | null {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed.includes("T") ? trimmed : trimmed.replace(" ", "T") + "Z");
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Classify how fresh a stored registrar fact is.
 *
 * An unparseable or absent timestamp is "never" — deliberately the pessimistic
 * reading, because the failure this guards against is a stale value being read
 * as current. Treating an unreadable timestamp as fresh would reintroduce it.
 */
export function freshness(
  syncedAt: string | null | undefined,
  options: { now?: Date; staleAfterDays?: number } = {},
): Freshness {
  const now = options.now ?? new Date();
  const staleAfterDays = options.staleAfterDays ?? DEFAULT_STALE_AFTER_DAYS;
  const parsed = parseTimestamp(syncedAt);

  if (!parsed) return { state: "never", age_days: null, synced_at: null };

  const ageDays = Math.floor((now.getTime() - parsed.getTime()) / MS_PER_DAY);
  const state: FreshnessState = ageDays > staleAfterDays ? "stale" : "fresh";
  return { state, age_days: ageDays, synced_at: syncedAt ?? null };
}

/** True when a stored expiry date is already behind us. */
export function isLapsed(expiresAt: string | null | undefined, now: Date = new Date()): boolean {
  if (!expiresAt) return false;
  const exp = Date.parse(expiresAt);
  return Number.isFinite(exp) && exp < now.getTime();
}

export interface LapsedSplit {
  /** Lapsed rows within the displayed page. */
  lapsedShown: number;
  /** Lapsed rows across the WHOLE result — never the page. */
  lapsedTotal: number;
  /** Rendered count: bare when complete, "N total, showing M" when bounded. */
  label: string;
  /** True when the page cannot show every lapsed row. */
  bounded: boolean;
}

/**
 * Split a paged listing into its lapsed count and its displayed count.
 *
 * The counts MUST come from the full result and the display from the page.
 * Counting the page and printing that number as a heading would publish a
 * bounded read as a population — the same defect class the two-sided expiry fix
 * exists to remove, which makes it exactly the mistake worth guarding here.
 */
export function lapsedSplit<T extends { expires_at: string | null }>(
  all: T[],
  page: T[],
  now: Date = new Date(),
): LapsedSplit {
  const lapsedTotal = all.filter((d) => isLapsed(d.expires_at, now)).length;
  const lapsedShown = page.filter((d) => isLapsed(d.expires_at, now)).length;
  const bounded = lapsedShown < lapsedTotal;
  return {
    lapsedShown,
    lapsedTotal,
    bounded,
    label: bounded ? `${lapsedTotal} total, showing ${lapsedShown}` : `${lapsedTotal}`,
  };
}

/**
 * A short suffix to render next to any stored registrar date, so a reader
 * cannot mistake a months-old snapshot for a current fact.
 */
export function freshnessSuffix(
  syncedAt: string | null | undefined,
  options: { now?: Date; staleAfterDays?: number } = {},
): string {
  const f = freshness(syncedAt, options);
  if (f.state === "never") return "(never synced)";
  if (f.age_days === 0) return "(synced today)";
  const plural = f.age_days === 1 ? "day" : "days";
  const marker = f.state === "stale" ? " — STALE" : "";
  return `(synced ${f.age_days} ${plural} ago${marker})`;
}
