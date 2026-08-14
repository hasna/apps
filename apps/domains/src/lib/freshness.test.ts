/**
 * Tests for the freshness signal.
 *
 * The absence of this signal is what let a 34-day-old snapshot read as current,
 * AND it is what produced the wrong "55 days stale" figure in the report that
 * opened this work: with no sync-freshness column, the only available timestamp
 * was `updated_at`, which measures row edits rather than sync recency. So the
 * mis-measurement and the defect share a cause.
 *
 * Each case is two-sided: a stale input must be marked stale, and a fresh input
 * must NOT be. A staleness check that fires on everything is as useless as one
 * that fires on nothing.
 */

import { describe, test, expect } from "bun:test";
import { freshness, freshnessSuffix, isLapsed, lapsedSplit, DEFAULT_STALE_AFTER_DAYS } from "./freshness";

const DAY = 86_400_000;
const NOW = new Date("2026-08-10T12:00:00.000Z");
const ago = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();

describe("freshness classification", () => {
  test("FIRES: a sync older than the threshold is stale", () => {
    const f = freshness(ago(34), { now: NOW });
    expect(f.state).toBe("stale");
    expect(f.age_days).toBe(34);
  });

  test("SILENT: a sync inside the threshold is fresh", () => {
    const f = freshness(ago(2), { now: NOW });
    expect(f.state).toBe("fresh");
    expect(f.age_days).toBe(2);
  });

  test("a never-synced row is 'never', not 'fresh'", () => {
    // The pessimistic reading is the whole point: an unknown sync time must not
    // read as a recent one, or the defect returns wearing a null.
    expect(freshness(null, { now: NOW }).state).toBe("never");
    expect(freshness(undefined, { now: NOW }).state).toBe("never");
    expect(freshness("", { now: NOW }).state).toBe("never");
    expect(freshness(null, { now: NOW }).age_days).toBeNull();
  });

  test("an unparseable timestamp is 'never', not silently fresh", () => {
    expect(freshness("not-a-date", { now: NOW }).state).toBe("never");
  });

  test("the boundary is exercised on both sides", () => {
    expect(freshness(ago(DEFAULT_STALE_AFTER_DAYS), { now: NOW }).state).toBe("fresh");
    expect(freshness(ago(DEFAULT_STALE_AFTER_DAYS + 1), { now: NOW }).state).toBe("stale");
  });

  test("the threshold is configurable in both directions", () => {
    expect(freshness(ago(10), { now: NOW, staleAfterDays: 30 }).state).toBe("fresh");
    expect(freshness(ago(10), { now: NOW, staleAfterDays: 1 }).state).toBe("stale");
  });
});

describe("the rendered suffix says which it is", () => {
  test("a stale date is visibly marked", () => {
    const s = freshnessSuffix(ago(34), { now: NOW });
    expect(s).toContain("34 days ago");
    expect(s).toContain("STALE");
  });

  test("a fresh date carries no stale marker", () => {
    const s = freshnessSuffix(ago(2), { now: NOW });
    expect(s).toContain("2 days ago");
    expect(s).not.toContain("STALE");
  });

  test("a never-synced row says so rather than showing a bare date", () => {
    expect(freshnessSuffix(null, { now: NOW })).toBe("(never synced)");
  });

  test("same-day reads as today, not '0 days ago'", () => {
    expect(freshnessSuffix(ago(0), { now: NOW })).toBe("(synced today)");
  });

  test("one day is singular", () => {
    expect(freshnessSuffix(ago(1), { now: NOW })).toContain("1 day ago");
  });
});

describe("lapsed counts come from the population, never from the page", () => {
  // Guards a defect found in adversarial self-review of this very change: the
  // heading counted `page.items` while the default page is 20 rows, so a
  // portfolio with more than 20 lapsed names would have printed a bounded read
  // as a population — the exact failure the two-sided expiry fix exists to end.
  const row = (name: string, offsetDays: number) => ({
    name,
    expires_at: new Date(NOW.getTime() + offsetDays * DAY).toISOString(),
  });

  test("FIRES: a truncated page reports the true total and says it is showing fewer", () => {
    const all = [...Array(25)].map((_, i) => row(`lapsed-${i}.com`, -10));
    const page = all.slice(0, 20); // the default limit
    const split = lapsedSplit(all, page, NOW);

    expect(split.lapsedTotal).toBe(25); // the population, not the page
    expect(split.lapsedShown).toBe(20);
    expect(split.bounded).toBe(true);
    expect(split.label).toBe("25 total, showing 20");
    // The old bug would have rendered a bare "20" here.
    expect(split.label).not.toBe("20");
  });

  test("SILENT: a complete page reports a bare count with no truncation noise", () => {
    const all = [row("a.com", -5), row("b.com", -3), row("c.com", +30)];
    const split = lapsedSplit(all, all, NOW);

    expect(split.lapsedTotal).toBe(2);
    expect(split.lapsedShown).toBe(2);
    expect(split.bounded).toBe(false);
    expect(split.label).toBe("2");
  });

  test("no lapsed rows reports zero rather than guessing", () => {
    const all = [row("fine.com", +90)];
    expect(lapsedSplit(all, all, NOW).lapsedTotal).toBe(0);
  });

  test("isLapsed is two-sided and ignores absent or invalid dates", () => {
    expect(isLapsed(new Date(NOW.getTime() - DAY).toISOString(), NOW)).toBe(true);
    expect(isLapsed(new Date(NOW.getTime() + DAY).toISOString(), NOW)).toBe(false);
    expect(isLapsed(null, NOW)).toBe(false);
    expect(isLapsed("not-a-date", NOW)).toBe(false);
  });
});
