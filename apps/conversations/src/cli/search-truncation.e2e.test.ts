import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

/**
 * End-to-end cover for todos 83852845 — `conversations search` disclosed no
 * truncation at all, so a page cut short read exactly like a complete one.
 *
 * These run against the LOCAL store, where the page boundary is reachable with
 * a handful of rows. The 500-row server clamp that produced the original report
 * is covered at the client boundary in
 * `src/lib/store/search-truncation.test.ts`.
 *
 * Both states are asserted throughout: a disclosure that never appears and one
 * that always appears are equally useless.
 */

const TEST_DB = join(tmpdir(), `conversations-cli-search-trunc-${Date.now()}.db`);
const CLI = ["bun", "run", "./src/cli/index.tsx"];

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

describe("search discloses truncation", () => {
  const TOKEN = "trunctoken";
  const SENDER = "trunc-sender";

  // 7 matching messages, so a --limit 3 page is truncated and a --limit 20 page
  // is not. Both boundaries are exercised below. Seeding costs one CLI spawn
  // per message, so it runs once up front rather than inside the first test.
  beforeAll(() => {
    for (let i = 1; i <= 7; i++) {
      const r = runCli(["send", `message ${i} about ${TOKEN}`, "--to", "trunc-reader"], SENDER);
      expect(r.exitCode).toBe(0);
    }
  }, 30_000);

  afterAll(() => {
    try { unlinkSync(TEST_DB); } catch {}
    try { unlinkSync(`${TEST_DB}-wal`); } catch {}
    try { unlinkSync(`${TEST_DB}-shm`); } catch {}
  });

  test("--json: a truncated page says so on stderr while stdout stays a bare array", () => {
    const res = runCli(["search", TOKEN, "--from", SENDER, "--limit", "3", "--json"], "reader");
    expect(res.exitCode).toBe(0);

    // stdout contract is unchanged: a bare array of exactly the page.
    const rows = JSON.parse(res.stdout);
    expect(Array.isArray(rows)).toBe(true);
    expect(rows).toHaveLength(3);

    // ...and the caller is told the set is incomplete, with the way to continue.
    expect(res.stderr).toContain("More available");
    expect(res.stderr).toContain("--cursor 3");
  });

  test("--json: a complete page stays silent, so the notice means something", () => {
    const res = runCli(["search", TOKEN, "--from", SENDER, "--limit", "20", "--json"], "reader");
    expect(res.exitCode).toBe(0);

    const rows = JSON.parse(res.stdout);
    expect(rows).toHaveLength(7);
    expect(res.stderr).not.toContain("More available");
  });

  test("--json: the page honours --limit exactly rather than leaking the probe row", () => {
    // Over-fetching by one is how truncation is detected; the extra row must
    // never reach the caller, or every bounded read returns one row too many.
    const res = runCli(["search", TOKEN, "--from", SENDER, "--limit", "1", "--json"], "reader");
    expect(res.exitCode).toBe(0);
    expect(JSON.parse(res.stdout)).toHaveLength(1);
    expect(res.stderr).toContain("--cursor 1");
  });

  test("--json: paging with --cursor walks to the end and the notice stops", () => {
    const first = runCli(["search", TOKEN, "--from", SENDER, "--limit", "5", "--json"], "reader");
    expect(JSON.parse(first.stdout)).toHaveLength(5);
    expect(first.stderr).toContain("--cursor 5");

    const second = runCli(["search", TOKEN, "--from", SENDER, "--limit", "5", "--cursor", "5", "--json"], "reader");
    expect(second.exitCode).toBe(0);
    expect(JSON.parse(second.stdout)).toHaveLength(2);
    expect(second.stderr).not.toContain("More available");
  });

  test("--json: no matches is exhaustion, not truncation", () => {
    const res = runCli(["search", "zzqxnotarealtokenhere", "--from", SENDER, "--limit", "3", "--json"], "reader");
    expect(res.exitCode).toBe(0);
    expect(JSON.parse(res.stdout)).toHaveLength(0);
    expect(res.stderr).not.toContain("More available");
  });

  test("text output discloses truncation in the footer, and only when truncated", () => {
    const truncated = runCli(["search", TOKEN, "--from", SENDER, "--limit", "3"], "reader");
    expect(truncated.exitCode).toBe(0);
    expect(truncated.stdout).toContain("More available");
    expect(truncated.stdout).toContain("--cursor 3");

    const complete = runCli(["search", TOKEN, "--from", SENDER, "--limit", "20"], "reader");
    expect(complete.exitCode).toBe(0);
    expect(complete.stdout).not.toContain("More available");
  });

  test("--help states the page cap and that the query is a content filter, not a sender listing", () => {
    const res = runCli(["search", "--help"], "reader");
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("500");
    expect(res.stdout).toContain("--cursor");
    // The template-shaped blind spot is the half no code change can fix.
    expect(res.stdout).toContain("TEMPLATE");
  });
});
