import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { closeDb, getDb } from "../lib/db.js";
import { DEFAULT_READ_LIMIT } from "../lib/message-window.js";
import { SINCE_JSON_LIMIT } from "./compact.js";

// Regression for todos 2c25973b: every recency-shaped read returned the OLDEST
// rows. A watcher built on any of them polled ancient history forever and
// reported "nothing new" — indistinguishable from a healthy quiet channel.
//
// THREE call shapes were affected, all measured against the hosted API at
// 0.5.11, and each is covered below:
//
//   read --channel X --limit N   both stores defaulted to ORDER BY created_at
//                                ASC LIMIT N, so a bare limit meant "oldest N".
//   read --channel X --since T   the same default with the cap DEFAULTED rather
//                                than passed: on #incidents, `--since 3h` gave
//                                the 20 oldest of a 110-row window, stopping at
//                                id 607270 against a true newest of 608099.
//   conversations since T        additionally hardcoded `order: "asc"` at its
//                                own call site, so the store-layer fix could not
//                                reach it: `since 3h --limit 5000` returned 500
//                                rows stopping at 607592, blind by 529 ids.
//
// WHY THE SEEDED WINDOW IS LARGE. Every one of these shapes is CORRECT while the
// window fits inside the cap — under the cap, "oldest N" and "newest N" are the
// same N rows. A test seeded below the boundary therefore passes on the unfixed
// code and proves nothing. The window here deliberately exceeds the largest
// client-side cap involved (`conversations since --json`, 200) so every shape is
// forced to choose WHICH page it returns, and the assertions are made against a
// known-newest message rather than a row count — a full-looking count with the
// newest missing is exactly how this defect hid.

const TEST_DB = join(tmpdir(), `conversations-cli-recency-${Date.now()}.db`);
const CLI = ["bun", "run", "./src/cli/index.tsx"];
const CHANNEL = "recency-ch";
// Above `conversations since --json`'s 200 default, which is the largest cap the
// client applies; that also puts it well above the 20-row read default.
const TOTAL = SINCE_JSON_LIMIT + 60;
// Ten seconds apart, so all TOTAL rows fit inside a `since 1h` window and the
// relative durations the CLI accepts stay deterministic on any run date.
const STEP_MS = 10_000;
const BASE = Date.now() - (TOTAL + 1) * STEP_MS;

function runCli(args: string[], agent: string) {
  const result = Bun.spawnSync({
    cmd: [...CLI, ...args],
    cwd: process.cwd(),
    env: {
      ...process.env,
      CONVERSATIONS_DB_PATH: TEST_DB,
      CONVERSATIONS_AGENT_ID: agent,
      FORCE_COLOR: "0",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: result.exitCode,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  };
}

/** Message bodies are `MSG-001` … `MSG-260`, oldest first. */
function body(n: number): string {
  return `MSG-${String(n).padStart(3, "0")}`;
}

/** The single newest message in the store. Every shape must be able to see it. */
const NEWEST = body(TOTAL);

/** `MSG-<n>` was posted at this instant. */
function stamp(n: number): string {
  return new Date(BASE + n * STEP_MS).toISOString();
}

/** The newest `count` bodies, in chronological order. */
function newest(count: number): string[] {
  return Array.from({ length: count }, (_, i) => body(TOTAL - count + 1 + i));
}

function bodiesOf(stdout: string): string[] {
  return (JSON.parse(stdout) as Array<{ content: string }>).map((r) => r.content);
}

describe("CLI recency reads return the newest messages", () => {
  beforeAll(() => {
    process.env.CONVERSATIONS_DB_PATH = TEST_DB;
    closeDb();
    const db = getDb();
    // The channel row is required: `channel read` refuses an unknown channel.
    db.prepare(`INSERT INTO channels (name, created_by) VALUES (?, ?)`).run(CHANNEL, "alice");
    const insert = db.prepare(
      `INSERT INTO messages (session_id, from_agent, to_agent, channel, content, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    );
    db.exec("BEGIN");
    for (let n = 1; n <= TOTAL; n++) insert.run("recency-session", "alice", CHANNEL, CHANNEL, body(n), stamp(n));
    db.exec("COMMIT");
    closeDb();
  });

  afterAll(() => {
    closeDb();
    try { unlinkSync(TEST_DB); } catch {}
    try { unlinkSync(`${TEST_DB}-wal`); } catch {}
    try { unlinkSync(`${TEST_DB}-shm`); } catch {}
  });

  // The seeded window must exceed every client-side cap, or the tests below sit
  // under the boundary and cannot fail on the unfixed code.
  test("the fixture actually crosses the caps it is meant to test", () => {
    expect(TOTAL).toBeGreaterThan(DEFAULT_READ_LIMIT);
    expect(TOTAL).toBeGreaterThan(SINCE_JSON_LIMIT);
  });

  // ── shape 1: an explicit --limit ──────────────────────────────────────────

  test("read --channel --limit --json returns the newest N, chronologically", () => {
    const res = runCli(["read", "--channel", CHANNEL, "--limit", "3", "--json"], "bob");
    expect(res.exitCode).toBe(0);
    const rows = JSON.parse(res.stdout) as Array<{ content: string; id: number }>;
    expect(rows.map((r) => r.content)).toEqual(newest(3));
    expect(rows[rows.length - 1].content).toBe(NEWEST);
    // Ascending ids: the transcript must not come back reversed.
    expect(rows.map((r) => r.id)).toEqual([...rows.map((r) => r.id)].sort((a, b) => a - b));
  });

  test("channel read --limit --json returns the newest N, chronologically", () => {
    const res = runCli(["channel", "read", CHANNEL, "--limit", "4", "--json"], "bob");
    expect(res.exitCode).toBe(0);
    const rows = bodiesOf(res.stdout);
    expect(rows).toEqual(newest(4));
    expect(rows).toContain(NEWEST);
  });

  test("compact (non-json) read shows the newest N, not the oldest", () => {
    const res = runCli(["read", "--channel", CHANNEL, "--limit", "3"], "bob");
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain(NEWEST);
    expect(res.stdout).not.toContain(body(1));
    expect(res.stdout).toContain("Showing 3");
  });

  test("compact channel read shows the newest N, not the oldest", () => {
    const res = runCli(["channel", "read", CHANNEL, "--limit", "3"], "bob");
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain(NEWEST);
    expect(res.stdout).not.toContain(body(1));
    expect(res.stdout).toContain("Showing 3");
  });

  test("--cursor walks backwards into older messages", () => {
    const page2 = runCli(["read", "--channel", CHANNEL, "--limit", "3", "--cursor", "3", "--json"], "bob");
    expect(page2.exitCode).toBe(0);
    expect(bodiesOf(page2.stdout)).toEqual([body(TOTAL - 5), body(TOTAL - 4), body(TOTAL - 3)]);
  });

  // ── shape 2: --since, whose cap is defaulted rather than passed ───────────

  test("read --since with no --limit returns the NEWEST default page, not the oldest", () => {
    const res = runCli(["read", "--channel", CHANNEL, "--since", stamp(0), "--json"], "bob");
    expect(res.exitCode).toBe(0);
    const rows = bodiesOf(res.stdout);
    expect(rows).toHaveLength(DEFAULT_READ_LIMIT);
    expect(rows).toEqual(newest(DEFAULT_READ_LIMIT));
    // Asserted against the known newest, not the count: a full-looking count
    // with the newest missing is precisely how this defect stayed hidden.
    expect(rows).toContain(NEWEST);
    expect(rows).not.toContain(body(1));
  });

  test("channel read --since with no --limit returns the newest default page", () => {
    const res = runCli(["channel", "read", CHANNEL, "--since", stamp(0), "--json"], "bob");
    expect(res.exitCode).toBe(0);
    const rows = bodiesOf(res.stdout);
    expect(rows).toEqual(newest(DEFAULT_READ_LIMIT));
    expect(rows).toContain(NEWEST);
  });

  test("read --since --limit N returns the newest N of the window", () => {
    const res = runCli(["read", "--channel", CHANNEL, "--since", stamp(0), "--limit", "5", "--json"], "bob");
    expect(res.exitCode).toBe(0);
    expect(bodiesOf(res.stdout)).toEqual(newest(5));
  });

  // ── the boundary itself: at the cap, and one over ────────────────────────
  //
  // Under the cap every shape is already correct, so these two cases are where
  // the behaviour actually changes and where silent truncation begins.

  test("a window exactly at the cap returns all of it, newest included", () => {
    // Everything strictly after MSG-<TOTAL-20> is exactly DEFAULT_READ_LIMIT rows.
    const res = runCli(["read", "--channel", CHANNEL, "--since", stamp(TOTAL - DEFAULT_READ_LIMIT), "--json"], "bob");
    expect(res.exitCode).toBe(0);
    const rows = bodiesOf(res.stdout);
    expect(rows).toHaveLength(DEFAULT_READ_LIMIT);
    expect(rows[0]).toBe(body(TOTAL - DEFAULT_READ_LIMIT + 1));
    expect(rows[rows.length - 1]).toBe(NEWEST);
  });

  test("a window one over the cap drops the OLDEST row, never the newest", () => {
    const res = runCli(["read", "--channel", CHANNEL, "--since", stamp(TOTAL - DEFAULT_READ_LIMIT - 1), "--json"], "bob");
    expect(res.exitCode).toBe(0);
    const rows = bodiesOf(res.stdout);
    expect(rows).toHaveLength(DEFAULT_READ_LIMIT);
    // The one row that did not fit is the oldest of the window, not the newest.
    expect(rows).not.toContain(body(TOTAL - DEFAULT_READ_LIMIT));
    expect(rows[rows.length - 1]).toBe(NEWEST);
  });

  test("a window under the cap returns everything, and is where the bug was invisible", () => {
    const res = runCli(["read", "--channel", CHANNEL, "--since", stamp(TOTAL - 6), "--json"], "bob");
    expect(res.exitCode).toBe(0);
    const rows = bodiesOf(res.stdout);
    expect(rows).toHaveLength(6);
    expect(rows[rows.length - 1]).toBe(NEWEST);
  });

  // ── shape 3: the top-level `conversations since <duration>` ───────────────
  //
  // This one hardcoded `order: "asc"` at its own call site, so it survived the
  // store-layer fix untouched and had to be fixed separately.

  test("conversations since <duration> with no --limit returns the NEWEST page", () => {
    const res = runCli(["since", "1h", "--json"], "bob");
    expect(res.exitCode).toBe(0);
    const rows = bodiesOf(res.stdout);
    // The window (TOTAL) is larger than this command's own 200-row default, so
    // it is forced to choose. Unfixed, it chose the oldest 200 and NEWEST was
    // absent while the count still looked healthy.
    expect(rows).toHaveLength(SINCE_JSON_LIMIT);
    expect(rows).toContain(NEWEST);
    expect(rows[rows.length - 1]).toBe(NEWEST);
    expect(rows).not.toContain(body(1));
  });

  test("conversations since <duration> --limit N returns the newest N", () => {
    const res = runCli(["since", "1h", "--limit", "4", "--json"], "bob");
    expect(res.exitCode).toBe(0);
    expect(bodiesOf(res.stdout)).toEqual(newest(4));
  });

  test("compact conversations since shows the newest, not the oldest", () => {
    const res = runCli(["since", "1h"], "bob");
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain(NEWEST);
    expect(res.stdout).not.toContain(body(1));
  });

  // ── silent truncation is now detectable ──────────────────────────────────
  //
  // Ordering and truncation are separate defects. Fixing the order still leaves
  // a capped read that reports rc=0 with no cursor and no signal — including the
  // server's own hard 500-row clamp on /messages, which `--limit` cannot raise.

  test("a full --json page warns on stderr while stdout stays parseable JSON", () => {
    const res = runCli(["read", "--channel", CHANNEL, "--limit", "5", "--json"], "bob");
    expect(res.exitCode).toBe(0);
    // stdout must remain a clean JSON array — the notice cannot go there.
    expect(bodiesOf(res.stdout)).toEqual(newest(5));
    expect(res.stderr).toContain("More may exist");
    expect(res.stderr).toContain("--cursor 5");
  });

  test("a full --json page from a defaulted cap warns too", () => {
    const res = runCli(["read", "--channel", CHANNEL, "--since", stamp(0), "--json"], "bob");
    expect(res.exitCode).toBe(0);
    expect(res.stderr).toContain("More may exist");
  });

  test("a partial --json page says nothing", () => {
    const res = runCli(["read", "--channel", CHANNEL, "--since", stamp(TOTAL - 2), "--json"], "bob");
    expect(res.exitCode).toBe(0);
    expect(bodiesOf(res.stdout)).toEqual([body(TOTAL - 1), body(TOTAL)]);
    expect(res.stderr).not.toContain("More may exist");
  });
});
