import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

/**
 * Regression coverage for liveness PROVENANCE on the presence row.
 *
 * `agent_presence` already carries a caller-scoped column, `session_id`, in both
 * schemas (src/lib/db.ts for SQLite, src/lib/pg-migrations.ts for Postgres), and
 * `agents register` populates it. `agents heartbeat` did not: it called
 * `heartbeat(agent, status)` and left the store's `sessionId` parameter
 * undefined, so every write took the store's `COALESCE(?, session_id)` branch
 * and preserved whatever session had registered the agent.
 *
 * The consequence is worse than a missing field. `last_seen_at` advances on
 * every heartbeat while `session_id` stays frozen at the registering session, so
 * the row positively asserts that session A was seen at a timestamp that session
 * B actually wrote. A reader deciding whether an agent is alive — or whether a
 * handover condition keyed on staleness has been met — reads a coherent,
 * confident, wrong answer, and nothing in the row marks it as unattributed.
 *
 * Each runCli() call is a separate process on a throwaway HOME and a throwaway
 * database. The HASNA_CONVERSATIONS_* keys are stripped because they point the
 * client at the hosted production deployment; CONVERSATIONS_SESSION_ID is
 * stripped from the base environment so each test declares its own.
 */

const HOME_DIR = mkdtempSync(join(tmpdir(), "conversations-hb-provenance-home-"));
const TEST_DB = join(HOME_DIR, `presence-${Date.now()}.db`);
const CLI = ["bun", "run", "./src/cli/index.tsx"];

type PresenceRow = {
  agent: string;
  session_id: string | null;
  last_seen_at: string;
};

function cliEnv(overrides: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = { ...process.env } as Record<string, string>;

  for (const key of Object.keys(env)) {
    if (
      key === "CONVERSATIONS_AGENT_ID"
      || key === "CONVERSATIONS_SESSION_ID"
      || key.startsWith("HASNA_CONVERSATIONS_")
    ) {
      delete env[key];
    }
  }

  env.HOME = HOME_DIR;
  env.USERPROFILE = HOME_DIR;
  env.CONVERSATIONS_DB_PATH = TEST_DB;
  env.FORCE_COLOR = "0";

  return { ...env, ...overrides };
}

function runCli(args: string[], overrides: Record<string, string> = {}) {
  const result = Bun.spawnSync({
    cmd: [...CLI, ...args],
    cwd: process.cwd(),
    env: cliEnv(overrides),
    stdout: "pipe",
    stderr: "pipe",
  });

  return {
    exitCode: result.exitCode,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  };
}

/** Read one agent's presence row back through the CLI's own JSON surface. */
function presenceOf(agent: string): PresenceRow {
  const result = runCli(["agents", "list", "--json"]);
  expect(result.exitCode).toBe(0);

  const rows = JSON.parse(result.stdout) as PresenceRow[];
  const row = rows.find((r) => r.agent.toLowerCase() === agent.toLowerCase());
  if (!row) throw new Error(`no presence row for "${agent}" in ${result.stdout}`);
  return row;
}

afterAll(() => {
  rmSync(HOME_DIR, { recursive: true, force: true });
});

describe("agents heartbeat — session provenance", () => {
  test("the harness is isolated from the hosted deployment", () => {
    const env = cliEnv();
    const leaked = Object.keys(env).filter((k) => k.startsWith("HASNA_CONVERSATIONS_"));

    expect(leaked).toEqual([]);
    expect(env.CONVERSATIONS_DB_PATH).toBe(TEST_DB);
    expect(env.HOME).toBe(HOME_DIR);
  });

  test("registration records the registering session", () => {
    const registered = runCli(
      ["agents", "register", "alpha", "--json"],
      { CONVERSATIONS_SESSION_ID: "sess-alpha-first" },
    );
    expect(registered.exitCode).toBe(0);

    // Positive control for the assertion below: session_id is a field this
    // surface genuinely populates, so a later mismatch is a real difference and
    // not a column the CLI never returns.
    expect(presenceOf("alpha").session_id).toBe("sess-alpha-first");
  });

  test("a heartbeat from a DIFFERENT session re-attributes the row to that session", () => {
    const before = presenceOf("alpha");
    expect(before.session_id).toBe("sess-alpha-first");

    const beat = runCli(
      ["agents", "heartbeat", "--from", "alpha", "--json"],
      { CONVERSATIONS_SESSION_ID: "sess-alpha-second" },
    );
    expect(beat.exitCode).toBe(0);

    const after = presenceOf("alpha");

    // The liveness timestamp moved, so *something* refreshed this row...
    expect(after.last_seen_at >= before.last_seen_at).toBe(true);

    // ...and the row must name the session that actually refreshed it. Before
    // the fix this read "sess-alpha-first": the row credited the refresh to a
    // session that had not written since registration.
    expect(after.session_id).toBe("sess-alpha-second");
  });

  test("a heartbeat from the SAME session leaves attribution unchanged", () => {
    runCli(
      ["agents", "register", "beta", "--json"],
      { CONVERSATIONS_SESSION_ID: "sess-beta" },
    );
    expect(presenceOf("beta").session_id).toBe("sess-beta");

    const beat = runCli(
      ["agents", "heartbeat", "--from", "beta", "--json"],
      { CONVERSATIONS_SESSION_ID: "sess-beta" },
    );
    expect(beat.exitCode).toBe(0);

    expect(presenceOf("beta").session_id).toBe("sess-beta");
  });

  test("a heartbeat with no declared session leaves the existing attribution alone", () => {
    // Negative control on the change's blast radius. A caller that declares no
    // session supplies nothing to attribute the write to, so the store's
    // COALESCE keeps the previous value and behaviour is exactly as before.
    // This is deliberately NOT asserting that undeclared callers are attributed
    // — they cannot be, and nulling the column here would discard a true value
    // on every legacy caller's heartbeat.
    runCli(
      ["agents", "register", "gamma", "--json"],
      { CONVERSATIONS_SESSION_ID: "sess-gamma" },
    );
    expect(presenceOf("gamma").session_id).toBe("sess-gamma");

    const beat = runCli(["agents", "heartbeat", "--from", "gamma", "--json"]);
    expect(beat.exitCode).toBe(0);

    expect(presenceOf("gamma").session_id).toBe("sess-gamma");
  });
});
