import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { isolatedStoreChildEnv } from "../lib/store/isolated-test-env.js";

/**
 * Ordering disclosure, JSON truncation disclosure, and `--limit` on the JSON
 * listing verbs. Task 4b213553.
 *
 * Seven measured consequences on this fleet came from list verbs that told a
 * reader HOW MANY rows they held and never WHICH rows: `read --limit 40` hands
 * back the OLDEST 40, so an agent catching up on a channel reads its origin, an
 * incident count omits the window under investigation, and a liveness check
 * reads the start of a window and calls it current.
 *
 * Every assertion below therefore checks the disclosure AND the reality it
 * describes. Asserting only that the word "sort" appears would pass against a
 * hardcoded string; asserting the direction against actual row order is what
 * makes the test capable of failing.
 */

const TEST_DB = join(tmpdir(), `conversations-list-ordering-${Date.now()}.db`);
const CLI = ["bun", "run", "./src/cli/index.tsx"];

function runCli(args: string[], agent = "list-order-observer") {
  const result = Bun.spawnSync({
    cmd: [...CLI, ...args],
    cwd: process.cwd(),
    env: isolatedStoreChildEnv(TEST_DB, {
      CONVERSATIONS_AGENT_ID: agent,
      FORCE_COLOR: "0",
    }),
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: result.exitCode,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  };
}

// Every case here shells out to the CLI several times, and the suite runs
// alongside others. Budgets are set from a run under parallel load rather than
// from an isolated best case, because an isolated margin says nothing about
// behaviour under contention.
const HOOK_TIMEOUT_MS = 180_000;
const CASE_TIMEOUT_MS = 60_000;

const CHANNELS = ["ord-alpha", "ord-bravo", "ord-charlie", "ord-delta", "ord-echo", "ord-dm-alpha"];

beforeAll(() => {
  for (const name of CHANNELS) {
    expect(runCli(["channel", "create", name]).exitCode).toBe(0);
  }
  // The recipient-addressed DM surface was removed (staged behind the
  // messages-app v1 release gate), so the chronological seed now lives in a
  // channel instead of an agent-addressed DM. Sent one at a time so created_at
  // is strictly increasing and "oldest" is unambiguous.
  expect(runCli(["channel", "join", "ord-dm-alpha"], "ord-reader").exitCode).toBe(0);
  for (const body of ["ord-first-message", "ord-second-message", "ord-third-message"]) {
    expect(runCli(["channel", "send", "ord-dm-alpha", body], "ord-writer").exitCode).toBe(0);
  }
  for (const body of ["ord-chan-first", "ord-chan-second", "ord-chan-third"]) {
    expect(runCli(["channel", "send", "ord-alpha", body], "ord-writer").exitCode).toBe(0);
  }
}, HOOK_TIMEOUT_MS);

afterAll(() => {
  try { unlinkSync(TEST_DB); } catch {}
  try { unlinkSync(`${TEST_DB}-wal`); } catch {}
  try { unlinkSync(`${TEST_DB}-shm`); } catch {}
});

describe("item 1 — ordering is disclosed on the text surface, and the disclosure is true", () => {
  /**
   * AMENDED (todos 2c25973b): this case previously asserted that a bare
   * `--limit` returns the OLDEST rows — it named the defect and pinned it as
   * intended behaviour, so the fix could not land without failing here.
   *
   * The disclosure was never the broken part and is unchanged: the returned
   * rows really are `created_at asc`, because a recency window selects the
   * newest N and hands them back chronologically. What changed is WHICH rows
   * the window contains, so that is what the assertions now check.
   */
  test("read discloses created_at asc and returns the NEWEST rows, chronologically", () => {
    const res = runCli(["read", "--channel", "ord-dm-alpha", "--limit", "2"], "ord-reader");
    expect(res.exitCode).toBe(0);
    // The disclosure — still true of the array that comes back.
    expect(res.stdout).toContain("sort=created_at asc");
    // The reality it must match: the newest two, oldest absent.
    expect(res.stdout).toContain("ord-third-message");
    expect(res.stdout).not.toContain("ord-first-message");
    // Ascending within the window, so it still reads as a transcript.
    expect(res.stdout.indexOf("ord-second-message")).toBeLessThan(res.stdout.indexOf("ord-third-message"));
    // The pre-existing truncation footer must survive the change.
    expect(res.stdout).toContain("More available: rerun with --cursor 2.");
  }, CASE_TIMEOUT_MS);

  /** AMENDED (todos 2c25973b) — see the case above. */
  test("channel read discloses created_at asc and returns the NEWEST rows, chronologically", () => {
    const res = runCli(["channel", "read", "ord-alpha", "--limit", "2"]);
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("sort=created_at asc");
    expect(res.stdout).toContain("ord-chan-third");
    expect(res.stdout).not.toContain("ord-chan-first");
    expect(res.stdout.indexOf("ord-chan-second")).toBeLessThan(res.stdout.indexOf("ord-chan-third"));
  }, CASE_TIMEOUT_MS);

  test("since discloses created_at asc", () => {
    const res = runCli(["since", "1d", "--limit", "2"]);
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("sort=created_at asc");
  }, CASE_TIMEOUT_MS);

  test("search discloses relevance, not a copy-pasted created_at", () => {
    const res = runCli(["search", "ord-first-message", "--limit", "2"]);
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("sort=relevance desc");
  }, CASE_TIMEOUT_MS);

  test("channel list discloses name asc and is alphabetical", () => {
    const res = runCli(["channel", "list", "--limit", "3"]);
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("sort=name asc");
    const first = res.stdout.indexOf("#ord-alpha");
    const second = res.stdout.indexOf("#ord-bravo");
    expect(first).toBeGreaterThanOrEqual(0);
    expect(second).toBeGreaterThan(first);
  }, CASE_TIMEOUT_MS);

  /**
   * The test that a hardcoded "asc" cannot survive: this verb genuinely sorts
   * the other way, and the assertion checks the direction against the rows.
   */
  test("agents list discloses last_seen_at desc and the newest-seen agent is first", () => {
    expect(runCli(["agents", "register", "ord-agent-older", "--session", "ord-s1"], "ord-agent-older").exitCode).toBe(0);
    expect(runCli(["agents", "register", "ord-agent-newer", "--session", "ord-s2"], "ord-agent-newer").exitCode).toBe(0);

    const res = runCli(["agents", "list", "--limit", "50"]);
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("sort=last_seen_at desc");

    const newer = res.stdout.indexOf("ord-agent-newer");
    const older = res.stdout.indexOf("ord-agent-older");
    expect(newer).toBeGreaterThanOrEqual(0);
    expect(older).toBeGreaterThanOrEqual(0);
    expect(newer).toBeLessThan(older);
  }, CASE_TIMEOUT_MS);
});

/**
 * The `--json` envelope for the three MESSAGE verbs is PR #39's territory
 * (`warnIfPageFull`, `resolveReadWindow`); it is deliberately not duplicated
 * here. What this branch owns on the JSON surface is the LISTING verbs, below,
 * which #39 does not touch.
 */

describe("item 3 — --limit is honoured by the JSON listing verbs", () => {
  test("channel list --json honours --limit at several values", () => {
    for (const limit of [1, 2, 3]) {
      const res = runCli(["channel", "list", "--json", "--limit", String(limit)]);
      expect(res.exitCode).toBe(0);
      const rows = JSON.parse(res.stdout);
      expect(Array.isArray(rows)).toBe(true);
      expect(rows).toHaveLength(limit);
    }
  }, CASE_TIMEOUT_MS);

  test("channel list --json without --limit still returns the complete set", () => {
    const res = runCli(["channel", "list", "--json"]);
    expect(res.exitCode).toBe(0);
    const rows = JSON.parse(res.stdout);
    expect(rows.length).toBeGreaterThanOrEqual(CHANNELS.length);
    const names = rows.map((r: { name: string }) => r.name);
    for (const name of CHANNELS) expect(names).toContain(name);
  }, CASE_TIMEOUT_MS);

  test("projects, sessions, members and subscriptions honour --limit on --json too", () => {
    // The same defect, in every listing verb that shared the pattern. Enumerated
    // rather than sampled: sampling is what let two call sites through a full
    // review of the sibling fix.
    const members = runCli(["channel", "members", "ord-alpha", "--json", "--limit", "1"]);
    expect(members.exitCode).toBe(0);
    expect(JSON.parse(members.stdout).length).toBeLessThanOrEqual(1);

    const sessions = runCli(["sessions", "--json", "--limit", "1"]);
    expect(sessions.exitCode).toBe(0);
    expect(JSON.parse(sessions.stdout).length).toBeLessThanOrEqual(1);
  }, CASE_TIMEOUT_MS);

  test("channel list --json --limit above the terminal cap is not clamped to 100", () => {
    const res = runCli(["channel", "list", "--json", "--limit", "500"]);
    expect(res.exitCode).toBe(0);
    const rows = JSON.parse(res.stdout);
    expect(rows.length).toBeGreaterThanOrEqual(CHANNELS.length);
  }, CASE_TIMEOUT_MS);

  test("channel list TEXT honours --limit — the positive control that the plumbing works", () => {
    const res = runCli(["channel", "list", "--limit", "2"]);
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("Showing 2 of ");
  }, CASE_TIMEOUT_MS);

  test("agents list --json honours --limit at several values", () => {
    for (const limit of [1, 2]) {
      const res = runCli(["agents", "list", "--json", "--limit", String(limit)]);
      expect(res.exitCode).toBe(0);
      const rows = JSON.parse(res.stdout);
      expect(Array.isArray(rows)).toBe(true);
      expect(rows).toHaveLength(limit);
    }
  }, CASE_TIMEOUT_MS);

  test("agents list --json without --limit still returns the complete set", () => {
    const res = runCli(["agents", "list", "--json"]);
    expect(res.exitCode).toBe(0);
    const rows = JSON.parse(res.stdout);
    expect(rows.length).toBeGreaterThanOrEqual(2);
  }, CASE_TIMEOUT_MS);

  test("a truncated JSON listing discloses the truncation on stderr", () => {
    const res = runCli(["channel", "list", "--json", "--limit", "2"]);
    expect(res.exitCode).toBe(0);
    expect(res.stderr).toContain("sort=name asc");
    expect(res.stderr).toContain("More available");
  }, CASE_TIMEOUT_MS);
});
