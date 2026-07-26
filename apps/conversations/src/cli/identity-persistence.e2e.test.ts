import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

/**
 * Regression coverage for the identity-revert bug.
 *
 * Presence rows live in the store (local SQLite or the cloud API), but *this
 * installation's* identity lives in a local file, $HOME/.hasna/conversations/agent-id,
 * read by getAutoName(). `agents register` and `agents rename` used to mutate the
 * store without touching that file, so they reported success and the very next
 * process resolved the OLD name again — the identity appeared to revert forever.
 *
 * Each runCli() call is a separate process, which is the whole point: an in-process
 * assertion would pass on the cached name and miss the bug entirely.
 */

const HOME_DIR = mkdtempSync(join(tmpdir(), "conversations-identity-home-"));
const TEST_DB = join(tmpdir(), `conversations-identity-${Date.now()}.db`);
const CLI = ["bun", "run", "./src/cli/index.tsx"];
const AGENT_ID_FILE = join(HOME_DIR, ".hasna", "conversations", "agent-id");

function runCli(args: string[]) {
  const env: Record<string, string> = { ...process.env, ...{} } as Record<string, string>;

  // Never inherit the developer's identity or transport: CONVERSATIONS_AGENT_ID
  // short-circuits the file we are testing, and the HASNA_CONVERSATIONS_* keys
  // would point the test at the real cloud deployment.
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

function storedIdentity(): string {
  return readFileSync(AGENT_ID_FILE, "utf-8").trim();
}

describe("CLI identity persistence (e2e)", () => {
  afterAll(() => {
    try { rmSync(HOME_DIR, { recursive: true, force: true }); } catch {}
    for (const suffix of ["", "-wal", "-shm"]) {
      try { rmSync(`${TEST_DB}${suffix}`, { force: true }); } catch {}
    }
  });

  test("register adopts the name as this installation's identity, and it survives a new process", () => {
    // A first invocation auto-generates and persists some random name.
    const before = runCli(["whoami", "--json"]);
    expect(before.exitCode).toBe(0);
    const autoName = JSON.parse(before.stdout).agent as string;
    expect(autoName).toBeTruthy();
    expect(storedIdentity()).toBe(autoName);

    const register = runCli(["agents", "register", "augustus", "--json"]);
    expect(register.exitCode).toBe(0);
    expect(JSON.parse(register.stdout).identity_adopted).toBe(true);

    // The file — not just the in-memory cache — must have moved.
    expect(storedIdentity()).toBe("augustus");

    // And a brand-new process must agree. This is the assertion the bug failed.
    const after = runCli(["whoami", "--json"]);
    expect(after.exitCode).toBe(0);
    expect(JSON.parse(after.stdout).agent).toBe("augustus");
    expect(JSON.parse(after.stdout).agent).not.toBe(autoName);
  });

  test("--no-identity registers another agent without hijacking our identity", () => {
    expect(storedIdentity()).toBe("augustus");

    const register = runCli(["agents", "register", "some-other-agent", "--no-identity", "--json"]);
    expect(register.exitCode).toBe(0);
    expect(JSON.parse(register.stdout).identity_adopted).toBe(false);

    expect(storedIdentity()).toBe("augustus");
    expect(JSON.parse(runCli(["whoami", "--json"]).stdout).agent).toBe("augustus");
  });

  test("renaming ourselves moves the persisted identity", () => {
    expect(storedIdentity()).toBe("augustus");

    const rename = runCli(["agents", "rename", "augustus", "augustus-renamed", "--json"]);
    expect(rename.exitCode).toBe(0);
    const payload = JSON.parse(rename.stdout);
    expect(payload.renamed).toBe(true);
    expect(payload.identity_adopted).toBe(true);

    expect(storedIdentity()).toBe("augustus-renamed");
    expect(JSON.parse(runCli(["whoami", "--json"]).stdout).agent).toBe("augustus-renamed");

    // Put it back so the next test starts from a known name.
    expect(runCli(["agents", "rename", "augustus-renamed", "augustus", "--json"]).exitCode).toBe(0);
    expect(storedIdentity()).toBe("augustus");
  });

  test("renaming a different agent leaves our identity alone", () => {
    expect(storedIdentity()).toBe("augustus");

    const rename = runCli(["agents", "rename", "some-other-agent", "some-other-agent-2", "--json"]);
    expect(rename.exitCode).toBe(0);
    const payload = JSON.parse(rename.stdout);
    expect(payload.renamed).toBe(true);
    expect(payload.identity_adopted).toBe(false);

    expect(storedIdentity()).toBe("augustus");
    expect(JSON.parse(runCli(["whoami", "--json"]).stdout).agent).toBe("augustus");
  });
});
