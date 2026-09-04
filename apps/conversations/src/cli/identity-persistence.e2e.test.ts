import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

/**
 * Regression coverage for the identity-revert bug.
 *
 * Presence rows live in the store (local SQLite or the cloud API), but *this
 * installation's* identity lives in a local file, the conversations data root's agent-id,
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

setDefaultTimeout(15_000);

function cliEnv(overrides: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = { ...process.env, ...{} } as Record<string, string>;

  // Never inherit the developer's identity or transport: CONVERSATIONS_AGENT_ID
  // and CONVERSATIONS_SESSION_ID short-circuit the sources we are testing, and
  // the HASNA_CONVERSATIONS_* keys would point the test at the real cloud
  // deployment.
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
  // This suite is *about* the machine identity file, and a throwaway HOME with
  // one identity in it is exactly the single-identity context the file is for.
  // The file is no longer read without this opt-in, so the suite must declare
  // it — the same one-line migration a cron job or loop makes.
  env.CONVERSATIONS_USE_MACHINE_IDENTITY = "1";

  return { ...env, ...overrides };
}

function runCli(args: string[], overrides: Record<string, string> = {}) {
  const env = cliEnv(overrides);

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

  test("a machine with no identity refuses to invent one", () => {
    // This ran first for a reason: the HOME is virgin here. The CLI used to mint
    // a random name at this point and persist it as the machine identity, so a
    // name nobody chose became the default author for every process on the box.
    const before = runCli(["whoami", "--json"]);
    expect(before.exitCode).toBe(1);
    const payload = JSON.parse(before.stdout);
    expect(payload.code).toBe("IDENTITY_NOT_SET");
    expect(payload.agent).toBeNull();

    // ...and it wrote nothing while refusing.
    expect(() => storedIdentity()).toThrow();
  });

  test("plain register does NOT touch machine identity (shared-box safety)", () => {
    // The box only has an identity because something claimed it deliberately.
    const seed = runCli(["agents", "register", "seed-agent", "--identity", "--json"]);
    expect(seed.exitCode).toBe(0);
    const autoName = "seed-agent";
    expect(storedIdentity()).toBe(autoName);

    // Every agent session on a machine is told to run `agents register <name>`.
    // If that adopted by default, the last session to start would silently
    // repoint the whole machine and every other session would impersonate it.
    const register = runCli(["agents", "register", "some-other-agent", "--json"]);
    expect(register.exitCode).toBe(0);
    expect(JSON.parse(register.stdout).identity_adopted).toBe(false);

    expect(storedIdentity()).toBe(autoName);
    expect(JSON.parse(runCli(["whoami", "--json"]).stdout).agent).toBe(autoName);
  });

  test("two concurrent sessions retain different registered identities without clobbering", () => {
    const sessionA = "session-alpha";
    const sessionB = "session-beta";

    // Both presence records remain live while the identities are resolved. The
    // registrations themselves are serialized so this test covers session
    // isolation, not SQLite's separate multi-writer transaction behavior.
    const registerA = runCli(
      ["agents", "register", "session-agent-alpha", "--json"],
      { CONVERSATIONS_SESSION_ID: sessionA },
    );
    const registerB = runCli(
      ["agents", "register", "session-agent-beta", "--json"],
      { CONVERSATIONS_SESSION_ID: sessionB },
    );

    expect(registerA.exitCode).toBe(0);
    expect(registerB.exitCode).toBe(0);
    expect(JSON.parse(registerA.stdout)).toMatchObject({
      session_identity_bound: true,
      session_identity_write_failed: false,
      session_identity_source: "env var (CONVERSATIONS_SESSION_ID)",
    });
    expect(JSON.parse(registerB.stdout)).toMatchObject({
      session_identity_bound: true,
      session_identity_write_failed: false,
      session_identity_source: "env var (CONVERSATIONS_SESSION_ID)",
    });

    const whoamiA = runCli(["whoami", "--json"], {
      CONVERSATIONS_SESSION_ID: sessionA,
    });
    const whoamiB = runCli(["whoami", "--json"], {
      CONVERSATIONS_SESSION_ID: sessionB,
    });

    expect(whoamiA.exitCode).toBe(0);
    expect(whoamiB.exitCode).toBe(0);
    expect(JSON.parse(whoamiA.stdout)).toMatchObject({
      agent: "session-agent-alpha",
      source: expect.stringContaining("CONVERSATIONS_SESSION_ID"),
    });
    expect(JSON.parse(whoamiB.stdout)).toMatchObject({
      agent: "session-agent-beta",
      source: expect.stringContaining("CONVERSATIONS_SESSION_ID"),
    });

    // Rebinding one live session must affect only that session. The other
    // session and the installation-wide compatibility fallback stay intact.
    const rebindA = runCli(
      ["agents", "register", "session-agent-alpha-next", "--json"],
      { CONVERSATIONS_SESSION_ID: sessionA },
    );
    expect(rebindA.exitCode).toBe(0);
    expect(JSON.parse(runCli(["whoami", "--json"], {
      CONVERSATIONS_SESSION_ID: sessionA,
    }).stdout).agent).toBe("session-agent-alpha-next");
    expect(JSON.parse(runCli(["whoami", "--json"], {
      CONVERSATIONS_SESSION_ID: sessionB,
    }).stdout).agent).toBe("session-agent-beta");
    expect(storedIdentity()).toBe("seed-agent");
  });

  test("renaming a session-bound agent migrates the binding for later processes", () => {
    const sessionId = "session-rename";
    const oldName = "session-agent-before-rename";
    const newName = "session-agent-after-rename";

    const register = runCli(
      ["agents", "register", oldName, "--json"],
      { CONVERSATIONS_SESSION_ID: sessionId },
    );
    expect(register.exitCode).toBe(0);
    expect(JSON.parse(register.stdout).session_identity_bound).toBe(true);

    const rename = runCli(
      ["agents", "rename", oldName, newName, "--json"],
      { CONVERSATIONS_SESSION_ID: sessionId },
    );
    expect(rename.exitCode).toBe(0);
    expect(JSON.parse(rename.stdout)).toMatchObject({
      renamed: true,
      session_identity_adopted: true,
      session_identity_write_failed: false,
    });

    // Both commands run in new processes. A stale binding would resolve the
    // removed old name here, and heartbeat would recreate its presence row.
    expect(JSON.parse(runCli(["whoami", "--json"], {
      CONVERSATIONS_SESSION_ID: sessionId,
    }).stdout).agent).toBe(newName);

    const heartbeat = runCli(["agents", "heartbeat", "--json"], {
      CONVERSATIONS_SESSION_ID: sessionId,
    });
    expect(heartbeat.exitCode).toBe(0);
    expect(JSON.parse(heartbeat.stdout)).toMatchObject({
      agent: newName,
      heartbeat: true,
    });
  });

  test("register --identity deliberately claims the machine identity, and it survives a new process", () => {
    const autoName = JSON.parse(runCli(["whoami", "--json"]).stdout).agent as string;

    const register = runCli(["agents", "register", "augustus", "--identity", "--json"]);
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

  test("a read-only identity file is reported as NOT adopted, never as success", () => {
    expect(storedIdentity()).toBe("augustus");
    chmodSync(AGENT_ID_FILE, 0o444);

    try {
      const register = runCli(["agents", "register", "would-be-usurper", "--identity", "--json"]);
      const payload = JSON.parse(register.stdout);

      // Silently claiming success here is the exact defect class this PR exists
      // to remove, so the write result must be reported honestly.
      expect(payload.identity_adopted).toBe(false);
      expect(payload.identity_write_failed).toBe(true);

      expect(storedIdentity()).toBe("augustus");
      expect(JSON.parse(runCli(["whoami", "--json"]).stdout).agent).toBe("augustus");
    } finally {
      chmodSync(AGENT_ID_FILE, 0o644);
    }
  });

  test("the human-readable register failure names the identity that is actually still in force", () => {
    // The path an operator hits first is the one without --json, and it is the
    // one they read to decide what to do next. It must not name the rejected
    // agent as if it had been adopted.
    expect(storedIdentity()).toBe("augustus");
    chmodSync(AGENT_ID_FILE, 0o444);

    try {
      const register = runCli(["agents", "register", "usurper-two", "--identity"]);
      expect(register.stderr).toContain("NOT changed");
      expect(register.stderr).toContain('still resolves as "augustus"');
      expect(register.stderr).not.toContain('still resolves as "usurper-two"');

      expect(storedIdentity()).toBe("augustus");
      expect(JSON.parse(runCli(["whoami", "--json"]).stdout).agent).toBe("augustus");
    } finally {
      chmodSync(AGENT_ID_FILE, 0o644);
    }
  });

  test("the human-readable rename failure names the identity that is actually still in force", () => {
    expect(storedIdentity()).toBe("augustus");
    chmodSync(AGENT_ID_FILE, 0o444);

    try {
      const rename = runCli(["agents", "rename", "augustus", "augustus-two"]);
      expect(rename.exitCode).toBe(0);

      // Presence moved to augustus-two; the file could not, so this box still
      // answers to augustus — and augustus is the name that no longer exists.
      expect(rename.stderr).toContain('still resolves as "augustus" — which no longer exists in presence');
      expect(rename.stderr).not.toContain('still resolves as "augustus-two"');

      expect(storedIdentity()).toBe("augustus");
      expect(JSON.parse(runCli(["whoami", "--json"]).stdout).agent).toBe("augustus");
    } finally {
      chmodSync(AGENT_ID_FILE, 0o644);
      // Put presence back so the later tests start from a known name.
      expect(runCli(["agents", "rename", "augustus-two", "augustus", "--json"]).exitCode).toBe(0);
      expect(storedIdentity()).toBe("augustus");
    }
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

  // Deciding self-ness from the file rather than the in-process cache cannot be
  // observed from here: every runCli() is a fresh process whose cache is empty,
  // so getAutoName() and readPersistedIdentity() agree by construction. A test
  // here claiming to cover it would pass either way. That distinction is
  // exercised in-process instead — src/lib/identity.test.ts for the primitives,
  // src/mcp/tools/agents.test.ts for the rename call site under a stale cache.
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
