import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, unlinkSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// Regression coverage for the `--json` error contract: every error branch must
// emit a parseable JSON error object on stdout (not plain text), so consumers
// that JSON-parse command output do not crash on failure.
const TEST_DB = join(tmpdir(), `conversations-json-error-${Date.now()}.db`);
const CLI = ["bun", "run", "./src/cli/index.tsx"];

function runCli(args: string[], agent = "tester") {
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

function expectJsonError(args: string[]) {
  const res = runCli(args);
  expect(res.exitCode).toBe(1);
  // stdout must be valid JSON with an `error` string — this is the contract.
  let parsed: any;
  expect(() => {
    parsed = JSON.parse(res.stdout.trim());
  }).not.toThrow();
  expect(typeof parsed.error).toBe("string");
  expect(parsed.error.length).toBeGreaterThan(0);
  return { res, parsed };
}

describe("--json error contract", () => {
  afterAll(() => {
    try { unlinkSync(TEST_DB); } catch {}
    try { unlinkSync(`${TEST_DB}-wal`); } catch {}
    try { unlinkSync(`${TEST_DB}-shm`); } catch {}
  });

  test("show <missing> --json emits a JSON error object", () => {
    const { parsed } = expectJsonError(["show", "999999999", "--json"]);
    expect(parsed.error).toContain("not found");
  });

  test("send with no recipient --json emits a JSON error object", () => {
    const { parsed } = expectJsonError(["send", "hello", "--json"]);
    expect(parsed.error).toContain("Recipient");
  });

  test("summary <missing> --json emits a JSON error object", () => {
    const { parsed } = expectJsonError(["summary", "nonexistent-channel-xyz", "--json"]);
    expect(parsed.error).toContain("No messages found");
  });

  test("project get <missing> --json emits a JSON error object", () => {
    const { parsed } = expectJsonError(["project", "get", "nonexistent-proj-xyz", "--json"]);
    expect(parsed.error).toContain("not found");
  });

  test("receipts <missing> --json emits a JSON error object", () => {
    const { parsed } = expectJsonError(["receipts", "999999999", "--json"]);
    expect(parsed.error).toContain("not found");
  });

  test("channel members <missing> --json emits a JSON not-found error", () => {
    const { parsed } = expectJsonError(["channel", "members", "missing-members-channel", "--json"]);
    expect(parsed.error).toContain("not found");
  });

  test("channel members <existing-empty> --json still succeeds with an empty list", () => {
    const created = runCli(["channel", "create", "existing-empty-members", "--from", "alice", "--json"]);
    expect(created.exitCode, created.stderr).toBe(0);

    const left = runCli(["channel", "leave", "existing-empty-members", "--from", "alice", "--json"]);
    expect(left.exitCode, left.stderr).toBe(0);
    expect(JSON.parse(left.stdout)).toMatchObject({ left: true });

    const members = runCli(["channel", "members", "existing-empty-members", "--json"]);
    expect(members.exitCode, members.stderr).toBe(0);
    expect(JSON.parse(members.stdout)).toEqual([]);
  });

  test("without --json the same error stays human-readable on stderr", () => {
    const res = runCli(["show", "999999999"]);
    expect(res.exitCode).toBe(1);
    expect(res.stderr).toContain("not found");
    expect(res.stdout.trim()).toBe("");
  });
});

/**
 * The identity-unset error branch, which the harness above cannot reach.
 *
 * `runCli` pins CONVERSATIONS_AGENT_ID on every spawn, so identity resolution
 * always succeeded and the branch introduced for it was never exercised — a
 * check that could not have failed. These spawns declare nothing, and use a
 * throwaway HOME so they cannot inherit the developer's identity file.
 */
describe("identity-unset error branch honours the --json contract", () => {
  const HOME_DIR = mkdtempSync(join(tmpdir(), "conversations-json-noident-"));

  afterAll(() => {
    try { rmSync(HOME_DIR, { recursive: true, force: true }); } catch { /* ok */ }
  });

  function runUndeclared(args: string[]) {
    const env: Record<string, string> = { ...process.env } as Record<string, string>;
    for (const key of Object.keys(env)) {
      if (key === "CONVERSATIONS_AGENT_ID"
        || key === "CONVERSATIONS_USE_MACHINE_IDENTITY"
        || key.startsWith("HASNA_CONVERSATIONS_")) delete env[key];
    }
    env.HOME = HOME_DIR;
    env.USERPROFILE = HOME_DIR;
    env.CONVERSATIONS_DB_PATH = TEST_DB;
    env.FORCE_COLOR = "0";
    const result = Bun.spawnSync({ cmd: [...CLI, ...args], cwd: process.cwd(), env, stdout: "pipe", stderr: "pipe" });
    return {
      exitCode: result.exitCode,
      stdout: new TextDecoder().decode(result.stdout),
      stderr: new TextDecoder().decode(result.stderr),
    };
  }

  test("a write with no identity emits a parseable JSON error on stdout", () => {
    const res = runUndeclared(["send", "someone", "hello", "--json"]);
    expect(res.exitCode).toBe(1);
    let parsed: any;
    expect(() => { parsed = JSON.parse(res.stdout.trim()); }).not.toThrow();
    expect(parsed.code).toBe("IDENTITY_NOT_SET");
    expect(typeof parsed.error).toBe("string");
  });

  test("the same failure without --json stays on stderr and leaves stdout empty", () => {
    const res = runUndeclared(["send", "someone", "hello"]);
    expect(res.exitCode).toBe(1);
    expect(res.stdout.trim()).toBe("");
    expect(res.stderr).toContain("No agent identity");
  });

  test("a message body of exactly --json does not turn the error into JSON output", () => {
    // The json-ness of the output is read from commander's PARSED options. Read
    // from argv instead, this invocation would answer a caller that never asked
    // for JSON with a JSON error object.
    const res = runUndeclared(["send", "someone", "--", "--json"]);
    expect(res.exitCode).toBe(1);
    expect(res.stdout.trim()).toBe("");
    expect(res.stderr).toContain("No agent identity");
  });

  test("agents list still works with no identity — roster discovery must not deadlock", () => {
    // A fresh seat runs this to see which names are taken BEFORE claiming one,
    // and it has no --from to escape with. Requiring a name to ask which names
    // exist is a deadlock.
    const res = runUndeclared(["agents", "list"]);
    expect(res.exitCode).toBe(0);

    const asJson = runUndeclared(["agents", "list", "--json"]);
    expect(asJson.exitCode).toBe(0);
    expect(() => JSON.parse(asJson.stdout.trim())).not.toThrow();
  });
});

/**
 * The fail-closed branch: a CLI run with NO API env and NO explicit store path
 * must refuse — exit 1, an error naming the required variables — instead of
 * silently serving the on-box SQLite store at its default ~/.hasna path (owner
 * ruling 2026-09-04). These spawns declare no store variable at all and use a
 * throwaway HOME so the refusal cannot fall back to the developer's real data.
 */
describe("no API env fails closed under the --json contract", () => {
  const HOME_DIR = mkdtempSync(join(tmpdir(), "conversations-json-noenv-"));

  afterAll(() => {
    try { rmSync(HOME_DIR, { recursive: true, force: true }); } catch { /* ok */ }
  });

  function runWithoutStoreEnv(args: string[]) {
    const env: Record<string, string> = { ...process.env } as Record<string, string>;
    for (const key of Object.keys(env)) {
      if (key === "CONVERSATIONS_API_URL"
        || key === "CONVERSATIONS_API_KEY"
        || key === "CONVERSATIONS_DB_PATH"
        || key.startsWith("HASNA_CONVERSATIONS_")) delete env[key];
    }
    env.HOME = HOME_DIR;
    env.USERPROFILE = HOME_DIR;
    env.CONVERSATIONS_AGENT_ID = "tester";
    env.FORCE_COLOR = "0";
    const result = Bun.spawnSync({ cmd: [...CLI, ...args], cwd: process.cwd(), env, stdout: "pipe", stderr: "pipe" });
    return {
      exitCode: result.exitCode,
      stdout: new TextDecoder().decode(result.stdout),
      stderr: new TextDecoder().decode(result.stderr),
    };
  }

  test("a data command with no API env and no store path exits 1 with a JSON error naming both required vars", () => {
    const res = runWithoutStoreEnv(["channel", "list", "--json"]);
    expect(res.exitCode).toBe(1);
    let parsed: any;
    expect(() => { parsed = JSON.parse(res.stdout.trim()); }).not.toThrow();
    expect(parsed.code).toBe("CONVERSATIONS_STORE_CONFIG");
    expect(parsed.error).toContain("HASNA_CONVERSATIONS_API_URL");
    expect(parsed.error).toContain("HASNA_CONVERSATIONS_API_KEY");
    // The message must point at the explicit local opt-in, never offer a silent default.
    expect(parsed.error).toContain("HASNA_CONVERSATIONS_DB_PATH");
  });

  test("the same refusal without --json is human-readable on stderr and never exit 0", () => {
    const res = runWithoutStoreEnv(["channel", "list"]);
    expect(res.exitCode).toBe(1);
    expect(res.stdout.trim()).toBe("");
    expect(res.stderr).toContain("HASNA_CONVERSATIONS_API_URL");
    expect(res.stderr).toContain("HASNA_CONVERSATIONS_API_KEY");
  });

  test("the refusal creates no local database in the data root", () => {
    const res = runWithoutStoreEnv(["channel", "list"]);
    expect(res.exitCode).toBe(1);
    expect(existsSync(join(HOME_DIR, ".hasna", "conversations", "messages.db"))).toBe(false);
    expect(existsSync(join(HOME_DIR, ".hasna", "conversations", "messages.db-wal"))).toBe(false);
  });
});
