import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

/**
 * Regression coverage for the AGENT-NAME REGISTRATION LOCK.
 *
 * `agent_presence.session_id` is the lock's HOLDER TOKEN, not a provenance
 * field. `registerAgent` refuses a second registration of a live name when the
 * stored `session_id` differs from the caller's (src/lib/presence.ts, and the
 * identical gate on the hosted path at src/server/api.ts). A heartbeat already
 * refreshes `last_seen_at`, which is what keeps `isActiveSession` true, so the
 * FROZEN `session_id` is the only thing that keeps the name with whoever
 * registered it.
 *
 * Anything that writes `session_id` on a heartbeat therefore hands the lock to
 * the heartbeating session, and does it SILENTLY: `took_over` is computed as
 * `existingSessionId !== sessionId`, so once a heartbeat has moved the stored
 * value the subsequent takeover reports `took_over: false`. Two failures, one
 * write — the gate opens and the telemetry that would have shown it reads clean.
 *
 * WHY THE OBVIOUS TEST IS VACUOUS, which is the part worth keeping:
 * the defect only fires when the heartbeating process declares
 * `CONVERSATIONS_SESSION_ID`. With it unset, `getDeclaredSessionId()` returns
 * null, the store takes its `COALESCE(?, session_id)` branch, and the lock
 * survives. A test that omits the variable passes against BOTH broken and fixed
 * code. `the lock survives a heartbeat that declares NO session` below pins that
 * branch deliberately, and `...declares a DIFFERENT session` is the one that
 * actually discriminates — measured red before the fix and green after.
 *
 * Harness: each runCli() is a separate process on a throwaway HOME and DB.
 * HASNA_CONVERSATIONS_* is stripped because it points the client at the hosted
 * production deployment. TMUX_PANE is stripped too: the `conversations` binary
 * on PATH can be a seat-identity shim that re-derives CONVERSATIONS_AGENT_ID
 * from the tmux pane, so `env -u CONVERSATIONS_AGENT_ID` alone is NOT hermetic
 * for that entrypoint. This file invokes the CLI source directly and so bypasses
 * the shim, but the strip keeps that true if the entrypoint ever changes.
 */

const HOME_DIR = mkdtempSync(join(tmpdir(), "conversations-reglock-home-"));
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
      || key === "TMUX_PANE"
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

function presenceOf(agent: string): PresenceRow {
  const result = runCli(["agents", "list", "--json"]);
  expect(result.exitCode).toBe(0);

  const rows = JSON.parse(result.stdout) as PresenceRow[];
  const row = rows.find((r) => r.agent.toLowerCase() === agent.toLowerCase());
  if (!row) throw new Error(`no presence row for "${agent}" in ${result.stdout}`);
  return row;
}

/** Register `agent` under `session`, returning the parsed CLI result. */
function register(agent: string, session: string) {
  const result = runCli(
    ["agents", "register", agent, "--json"],
    { CONVERSATIONS_SESSION_ID: session },
  );
  return { ...result, body: JSON.parse(result.stdout) as Record<string, unknown> };
}

afterAll(() => {
  rmSync(HOME_DIR, { recursive: true, force: true });
});

describe("agent-name registration lock", () => {
  test("the harness is isolated from the hosted deployment", () => {
    const env = cliEnv();
    const leaked = Object.keys(env).filter((k) => k.startsWith("HASNA_CONVERSATIONS_"));

    expect(leaked).toEqual([]);
    expect(env.CONVERSATIONS_AGENT_ID).toBeUndefined();
    expect(env.CONVERSATIONS_SESSION_ID).toBeUndefined();
    expect(env.CONVERSATIONS_DB_PATH).toBe(TEST_DB);
    expect(env.HOME).toBe(HOME_DIR);
  });

  test("registration records the registering session as the holder", () => {
    const registered = register("lockalpha", "sess-AAA");
    expect(registered.exitCode).toBe(0);

    // Positive control on the FIELD, not just the query: session_id is a column
    // this surface genuinely populates, so a later mismatch is a real difference
    // and not a key the CLI never returns.
    expect(presenceOf("lockalpha").session_id).toBe("sess-AAA");
  });

  test("POSITIVE CONTROL — a foreign session cannot register a live held name", () => {
    // If this ever goes green-by-default the discriminating test below proves
    // nothing, because the gate it asserts would not be firing at all.
    const stolen = register("lockalpha", "sess-BBB");

    expect(stolen.exitCode).toBe(1);
    expect(stolen.body.conflict).toBe(true);
    expect(stolen.body.error).toBe("agent_conflict");
    expect(stolen.body.existing_session_id).toBe("sess-AAA");
  });

  test("the lock survives a heartbeat that declares a DIFFERENT session", () => {
    // THE REGRESSION. A foreign heartbeat must not hand over the holder token.
    // Self-contained on its own agent name: this must not silently degrade into
    // a no-op if the cases above are reordered, renamed, or deleted.
    expect(register("lockmain", "sess-AAA").exitCode).toBe(0);
    const before = presenceOf("lockmain");
    expect(before.session_id).toBe("sess-AAA");

    const beat = runCli(
      ["agents", "heartbeat", "--from", "lockmain", "--json"],
      { CONVERSATIONS_SESSION_ID: "sess-BBB" },
    );
    expect(beat.exitCode).toBe(0);

    const after = presenceOf("lockmain");

    // The heartbeat is still allowed to do its actual job: liveness moved.
    // This is what keeps isActiveSession true, and therefore what keeps the
    // gate armed — a fix that restored the lock by breaking liveness would be
    // a different bug, so assert the two independently.
    expect(after.last_seen_at >= before.last_seen_at).toBe(true);

    // ...but the holder token must still name the registrant.
    expect(after.session_id).toBe("sess-AAA");

    // And the consequence that actually matters: the gate still refuses, and
    // it refuses naming the ORIGINAL holder rather than the heartbeating one.
    const afterBeat = register("lockmain", "sess-BBB");
    expect(afterBeat.exitCode).toBe(1);
    expect(afterBeat.body.conflict).toBe(true);
    expect(afterBeat.body.existing_session_id).toBe("sess-AAA");
  });

  test("a takeover after a foreign heartbeat still reports took_over", () => {
    // `took_over` is derived as `existingSessionId !== sessionId`, so a heartbeat
    // that moved the stored value makes a genuine takeover report
    // `took_over: false` — the gate opens and the telemetry that would have
    // shown it reads clean. lockmain has just taken a foreign heartbeat from
    // sess-BBB, so this is exactly that scenario.
    const forced = runCli(
      ["agents", "register", "lockmain", "--force", "--json"],
      { CONVERSATIONS_SESSION_ID: "sess-BBB" },
    );
    expect(forced.exitCode).toBe(0);

    const body = JSON.parse(forced.stdout) as Record<string, unknown>;
    expect(body.took_over).toBe(true);
  });

  test("the lock survives a heartbeat that declares NO session", () => {
    // Pins the branch that makes the discriminating test above non-vacuous: with
    // no declared session the store's COALESCE keeps the previous value, so this
    // case passes on broken and fixed code alike. Kept BECAUSE it cannot
    // discriminate — it documents why the sibling test must set the variable.
    expect(register("lockdelta", "sess-DDD").exitCode).toBe(0);
    expect(presenceOf("lockdelta").session_id).toBe("sess-DDD");

    const beat = runCli(["agents", "heartbeat", "--from", "lockdelta", "--json"]);
    expect(beat.exitCode).toBe(0);

    expect(presenceOf("lockdelta").session_id).toBe("sess-DDD");

    const afterBeat = register("lockdelta", "sess-EEE");
    expect(afterBeat.exitCode).toBe(1);
    expect(afterBeat.body.existing_session_id).toBe("sess-DDD");
  });

  test("a heartbeat from the SAME session leaves the holder unchanged", () => {
    expect(register("lockbeta", "sess-BETA").exitCode).toBe(0);

    const beat = runCli(
      ["agents", "heartbeat", "--from", "lockbeta", "--json"],
      { CONVERSATIONS_SESSION_ID: "sess-BETA" },
    );
    expect(beat.exitCode).toBe(0);

    expect(presenceOf("lockbeta").session_id).toBe("sess-BETA");
    expect(register("lockbeta", "sess-BETA").exitCode).toBe(0);
  });
});
