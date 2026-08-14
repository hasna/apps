/**
 * Regression tests for the forward-only expiry blind spot.
 *
 * Measured before the fix, against the live portfolio (1040 rows):
 *   expires_at PAST and status=active : 17
 *   domains domain stats -j -> "expiring_30_days": 16
 * Seventeen names were over the line and invisible to the exact command built
 * to surface them, because `listExpiring` floored its comparison at `now`.
 *
 * EVERY TEST HERE IS TWO-SIDED ON PURPOSE. A check that only ever runs against
 * names that are fine is the defect being fixed, so each assertion that a lapsed
 * name IS reported is paired with an assertion that a current name IS NOT. The
 * `forward-only` cases are the negative controls: they reproduce the pre-fix
 * behaviour and must stay blind, which is what proves these tests can tell the
 * two code paths apart rather than passing either way.
 */

import { describe, test, expect, afterAll, beforeEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const tempDir = mkdtempSync(join(tmpdir(), "open-domains-expiry-test-"));
process.env["DOMAINS_DIR"] = tempDir;

import {
  createDomain,
  listExpiring,
  listSslExpiring,
  listPastExpiry,
  listSslPastExpiry,
  getDomainStats,
  listDomains,
  deleteDomain,
} from "./domains";
import { closeDatabase } from "./database";

afterAll(() => {
  closeDatabase();
  rmSync(tempDir, { recursive: true, force: true });
});

const DAY = 86_400_000;
const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY).toISOString();

/** Past expiry while still claiming active — the shape that was invisible. */
const LAPSED = "lapsed-known-bad.com";
/** Expiry comfortably beyond any window under test — must never be reported. */
const CURRENT = "current-known-good.com";
/** Inside the 30-day window — the only shape the old code could see. */
const SOON = "soon-within-window.com";

async function reset() {
  for (const d of await listDomains({})) await deleteDomain(d.id);
  await createDomain({ name: LAPSED, status: "active", expires_at: iso(-45) });
  await createDomain({ name: CURRENT, status: "active", expires_at: iso(+400) });
  await createDomain({ name: SOON, status: "active", expires_at: iso(+10) });
}

beforeEach(reset);

const names = (rows: { name: string }[]) => rows.map((r) => r.name);

describe("past-expiry names are reported", () => {
  test("listPastExpiry FIRES on the lapsed fixture and is SILENT on the current one", async () => {
    const found = names(await listPastExpiry());
    expect(found).toContain(LAPSED); // must fail if the fix regresses
    expect(found).not.toContain(CURRENT); // must stay silent on a healthy name
    expect(found).not.toContain(SOON);
  });

  test("listExpiring includes the lapsed name by default", async () => {
    const found = names(await listExpiring(30));
    expect(found).toContain(LAPSED);
    expect(found).toContain(SOON);
    expect(found).not.toContain(CURRENT);
  });

  test("NEGATIVE CONTROL: forward-only reproduces the old blind spot", async () => {
    // If this ever starts returning LAPSED, the two paths have collapsed into
    // one and the tests above would pass no matter which code ran.
    const found = names(await listExpiring(30, { includeLapsed: false }));
    expect(found).not.toContain(LAPSED);
    expect(found).toContain(SOON);
    expect(found).not.toContain(CURRENT);
  });

  test("lapsed names sort ahead of upcoming ones", async () => {
    const found = names(await listExpiring(30));
    expect(found.indexOf(LAPSED)).toBeLessThan(found.indexOf(SOON));
  });

  test("a name one day over the line is reported — the boundary that was missed", async () => {
    await createDomain({ name: "one-day-over.com", status: "active", expires_at: iso(-1) });
    expect(names(await listPastExpiry())).toContain("one-day-over.com");
  });

  test("a name one day short of expiry is NOT reported as lapsed", async () => {
    await createDomain({ name: "one-day-left.com", status: "active", expires_at: iso(+1) });
    const lapsed = names(await listPastExpiry());
    expect(lapsed).not.toContain("one-day-left.com");
    expect(names(await listExpiring(30))).toContain("one-day-left.com");
  });

  test("a row with no expiry date is reported by neither side", async () => {
    await createDomain({ name: "no-expiry.com", status: "active" });
    expect(names(await listPastExpiry())).not.toContain("no-expiry.com");
    expect(names(await listExpiring(30))).not.toContain("no-expiry.com");
  });
});

describe("SSL expiry has the same two sides", () => {
  test("lapsed SSL fires, current SSL stays silent", async () => {
    await createDomain({ name: "ssl-lapsed.com", status: "active", ssl_expires_at: iso(-20) });
    await createDomain({ name: "ssl-current.com", status: "active", ssl_expires_at: iso(+300) });

    const found = names(await listSslPastExpiry());
    expect(found).toContain("ssl-lapsed.com");
    expect(found).not.toContain("ssl-current.com");

    expect(names(await listSslExpiring(30))).toContain("ssl-lapsed.com");
  });

  test("NEGATIVE CONTROL: forward-only SSL stays blind to the lapsed cert", async () => {
    await createDomain({ name: "ssl-lapsed-2.com", status: "active", ssl_expires_at: iso(-20) });
    expect(names(await listSslExpiring(30, { includeLapsed: false }))).not.toContain("ssl-lapsed-2.com");
  });
});

describe("stats separate the two counts without changing an existing meaning", () => {
  test("past_expiry counts the lapsed set; expiring_30_days keeps excluding it", async () => {
    const stats = await getDomainStats();
    expect(stats.past_expiry).toBe(1); // LAPSED only
    expect(stats.expiring_30_days).toBe(1); // SOON only — unchanged meaning
  });

  test("past_expiry is zero when nothing is lapsed — the check can report clean", async () => {
    for (const d of await listDomains({})) await deleteDomain(d.id);
    await createDomain({ name: "all-fine.com", status: "active", expires_at: iso(+200) });
    const stats = await getDomainStats();
    expect(stats.past_expiry).toBe(0);
  });

  test("never_synced counts rows whose registrar facts were never confirmed", async () => {
    for (const d of await listDomains({})) await deleteDomain(d.id);
    await createDomain({ name: "unsynced.com", status: "active", expires_at: iso(+50) });
    await createDomain({
      name: "synced.com",
      status: "active",
      expires_at: iso(+50),
      expiry_synced_at: new Date().toISOString(),
    });
    const stats = await getDomainStats();
    expect(stats.never_synced).toBe(1);
  });
});

describe("a status already labelled expired is not re-reported as a surprise", () => {
  test("status=expired is excluded from the lapsed set", async () => {
    await createDomain({ name: "known-expired.com", status: "expired", expires_at: iso(-90) });
    expect(names(await listPastExpiry())).not.toContain("known-expired.com");
  });
});
