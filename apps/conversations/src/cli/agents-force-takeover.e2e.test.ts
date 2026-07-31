import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const HOME_DIR = mkdtempSync(join(tmpdir(), "conversations-force-home-"));
const TEST_DB = join(tmpdir(), `conversations-force-${Date.now()}.db`);
const CLI = ["bun", "run", "./src/cli/index.tsx"];

function runCli(args: string[]) {
  const env = { ...process.env } as Record<string, string>;
  for (const key of Object.keys(env)) {
    if (key === "CONVERSATIONS_AGENT_ID" || key.startsWith("HASNA_CONVERSATIONS_")) {
      delete env[key];
    }
  }

  env.HOME = HOME_DIR;
  env.USERPROFILE = HOME_DIR;
  env.CONVERSATIONS_DB_PATH = TEST_DB;
  env.FORCE_COLOR = "0";

  const result = Bun.spawnSync({
    cmd: [...CLI, ...args],
    cwd: process.cwd(),
    env,
    stdout: "pipe",
    stderr: "pipe",
  });

  return {
    exitCode: result.exitCode,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  };
}

describe("CLI agent force takeover (e2e)", () => {
  afterAll(() => {
    try { rmSync(HOME_DIR, { recursive: true, force: true }); } catch {}
    for (const suffix of ["", "-wal", "-shm"]) {
      try { rmSync(`${TEST_DB}${suffix}`, { force: true }); } catch {}
    }
  });

  test("requires --force to take over an active agent", () => {
    const initial = runCli(["agents", "register", "takeover-agent", "--session", "session-old", "--json"]);
    expect(initial.exitCode).toBe(0);

    const conflict = runCli(["agents", "register", "takeover-agent", "--session", "session-new"]);
    expect(conflict.exitCode).toBe(1);
    expect(conflict.stderr).toContain('Conflict: agent "takeover-agent" is already active');
    expect(conflict.stderr).toContain("Use --force or wait 30 minutes for the session to expire.");

    const takeover = runCli(["agents", "register", "takeover-agent", "--session", "session-new", "--force", "--json"]);
    expect(takeover.exitCode).toBe(0);
    const result = JSON.parse(takeover.stdout);
    expect(result.took_over).toBe(true);
    expect(result.agent.session_id).toBe("session-new");
  });
});
