import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const rootDir = join(import.meta.dir, "..");

// Regression suite for the 2026-07-30 credential leak (todos da0ef2ed, incident
// 607113): `secrets get` wrote the plaintext value to stdout, agent tool output is
// persisted verbatim to session transcripts, and four credentials leaked. The fix
// is default-deny: NO code path may write a vault value to stdout without an
// explicit --show/--plaintext, and consumption happens through `exec` (child env),
// `get --check` (length + sha256), and `set --stdin` (value off argv).
//
// The fixture value is OBVIOUSLY FAKE and never a real credential. Assertions
// compare lengths and sha256 digests wherever possible so even the fake value
// appears in as few places as possible.
const FIXTURE_KEY = "example/consume-test/test/api_key";
const FIXTURE_VALUE = "fixture-not-a-real-credential-0123456789abcdef";
const FIXTURE_SHA256 = createHash("sha256").update(FIXTURE_VALUE).digest("hex");

// A second key for the set --stdin round trip, so a leftover from the seeding
// `set` cannot satisfy its assertions.
const STDIN_KEY = "example/consume-test/test/stdin_key";

let vaultDir: string;

// Every spawn pins the vault + key dir to one shared temp directory: the
// per-process throwaway vault from test-isolation is keyed by PID, so two spawned
// CLI children would otherwise see two different vaults (and two different
// encryption keys) and a set→get round trip could never work.
function cliEnv(): Record<string, string | undefined> {
  return {
    ...process.env,
    HASNA_SECRETS_DB_PATH: join(vaultDir, "vault.db"),
    HASNA_SECRETS_KEY_DIR: join(vaultDir, "keys"),
    NO_COLOR: "1",
  };
}

async function runCli(args: string[], opts: { stdin?: string } = {}) {
  const proc = Bun.spawn({
    cmd: ["bun", "src/index.ts", ...args],
    cwd: rootDir,
    // Explicit env, never the default: a child spawned without `env:` gets the
    // initial environment snapshot and misses the preload's isolation marker.
    env: cliEnv(),
    stdin: opts.stdin !== undefined ? Buffer.from(opts.stdin) : "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

beforeAll(async () => {
  vaultDir = mkdtempSync(join(tmpdir(), "secrets-consume-test-"));
  const seeded = await runCli(["set", FIXTURE_KEY, FIXTURE_VALUE, "--type", "api_key"]);
  if (seeded.exitCode !== 0) {
    throw new Error(`fixture seed failed: ${seeded.stderr}`);
  }
});

afterAll(() => {
  rmSync(vaultDir, { recursive: true, force: true });
});

describe("CLI get — default-deny plaintext", () => {
  // POSITIVE CONTROL, and the explicit escape hatch: proves the vault really
  // holds the fixture value, so the redaction assertions below are falsifiable
  // rather than vacuously true against an empty vault.
  it("get --show prints the plaintext value (explicit escape hatch)", async () => {
    const { stdout, exitCode } = await runCli(["get", FIXTURE_KEY, "--show"]);
    expect(exitCode).toBe(0);
    expect(stdout).toBe(FIXTURE_VALUE);
  });

  // THE LEAK ITSELF. Against the pre-fix CLI this test fails: stdout was exactly
  // the plaintext value.
  it("get without --show never writes the vault value to stdout", async () => {
    const { stdout, stderr, exitCode } = await runCli(["get", FIXTURE_KEY]);
    expect(stdout).not.toContain(FIXTURE_VALUE);
    // Captured (non-TTY) output is exactly the leak context, so the default
    // fails LOUDLY instead of substituting a poison value into $(secrets get k).
    expect(exitCode).toBe(1);
    expect(stdout).toBe("");
    // The error must teach the migration path, and must not carry the value.
    expect(stderr).toContain("--show");
    expect(stderr).toContain("--check");
    expect(stderr).toContain("exec");
    expect(stderr).not.toContain(FIXTURE_VALUE);
  });

  it("get --check prints only length and sha256, never the value", async () => {
    const { stdout, stderr, exitCode } = await runCli(["get", FIXTURE_KEY, "--check"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain(`length=${FIXTURE_VALUE.length}`);
    expect(stdout).toContain(`sha256=${FIXTURE_SHA256}`);
    expect(stdout).not.toContain(FIXTURE_VALUE);
    expect(stderr).not.toContain(FIXTURE_VALUE);
  });

  it("get --check on a missing key fails without inventing a digest", async () => {
    const { stdout, exitCode } = await runCli(["get", "example/consume-test/test/absent", "--check"]);
    expect(exitCode).toBe(1);
    expect(stdout).not.toContain("sha256=");
  });
});

describe("CLI exec — consume via child environment", () => {
  it("injects the value into the child env and prints nothing of it", async () => {
    const probe =
      'const v = process.env.CONSUME_FIXTURE ?? ""; ' +
      'const { createHash } = require("node:crypto"); ' +
      'console.log("len=" + v.length); ' +
      'console.log("sha=" + createHash("sha256").update(v).digest("hex"));';
    const { stdout, stderr, exitCode } = await runCli([
      "exec", FIXTURE_KEY, "--as", "CONSUME_FIXTURE", "--", "bun", "-e", probe,
    ]);
    expect(exitCode).toBe(0);
    // The child saw the real value (length + digest match)…
    expect(stdout).toContain(`len=${FIXTURE_VALUE.length}`);
    expect(stdout).toContain(`sha=${FIXTURE_SHA256}`);
    // …and the value itself appeared on neither stream.
    expect(stdout).not.toContain(FIXTURE_VALUE);
    expect(stderr).not.toContain(FIXTURE_VALUE);
  });

  it("derives the default env var name from the key path", async () => {
    // example/consume-test/test/api_key → EXAMPLE_CONSUME_TEST_TEST_API_KEY
    const probe = 'console.log("len=" + (process.env.EXAMPLE_CONSUME_TEST_TEST_API_KEY ?? "").length);';
    const { stdout, exitCode } = await runCli(["exec", FIXTURE_KEY, "--", "bun", "-e", probe]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain(`len=${FIXTURE_VALUE.length}`);
  });

  it("propagates the child's exit code", async () => {
    const { exitCode } = await runCli(["exec", FIXTURE_KEY, "--", "bun", "-e", "process.exit(7)"]);
    expect(exitCode).toBe(7);
  });

  it("passes tokens after -- to the child untouched (no --help hijack)", async () => {
    // Before the fix the top-level -h/--help scan read PAST the -- separator and
    // printed the secrets usage instead of running the child at all. (printf, not
    // echo: the coreutils echo BINARY interprets --help itself; printf only
    // special-cases it as the first operand.)
    const { stdout, stderr, exitCode } = await runCli(["exec", FIXTURE_KEY, "--", "printf", "%s\\n", "--help"]);
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("--help");
    expect(stdout).not.toContain("secrets — local secrets vault");
    expect(stderr).not.toContain(FIXTURE_VALUE);
  });

  it("requires the -- separator and a command", async () => {
    const noSep = await runCli(["exec", FIXTURE_KEY, "bun", "-e", "1"]);
    expect(noSep.exitCode).toBe(1);
    expect(noSep.stdout).toBe("");
    expect(noSep.stderr).toContain("--");

    const noCmd = await runCli(["exec", FIXTURE_KEY, "--"]);
    expect(noCmd.exitCode).toBe(1);
  });

  it("rejects an invalid --as env var name", async () => {
    const { exitCode, stderr } = await runCli([
      "exec", FIXTURE_KEY, "--as", "not-a-valid-name", "--", "echo", "ok",
    ]);
    expect(exitCode).toBe(1);
    expect(stderr).not.toContain(FIXTURE_VALUE);
  });

  it("fails cleanly on a missing key without running the command", async () => {
    const { stdout, exitCode } = await runCli([
      "exec", "example/consume-test/test/absent", "--", "echo", "ran-anyway",
    ]);
    expect(exitCode).toBe(1);
    expect(stdout).not.toContain("ran-anyway");
  });
});

describe("CLI set --stdin — value off argv", () => {
  it("round-trips a value read from stdin (verified by digest, not plaintext)", async () => {
    const set = await runCli(["set", STDIN_KEY, "--stdin", "--type", "token"], {
      stdin: `${FIXTURE_VALUE}\n`,
    });
    expect(set.exitCode).toBe(0);
    expect(set.stdout).not.toContain(FIXTURE_VALUE);
    expect(set.stderr).not.toContain(FIXTURE_VALUE);

    // Exactly one trailing newline is stripped (echo/heredoc convention); the
    // digest proves the stored value is byte-identical to the fixture.
    const check = await runCli(["get", STDIN_KEY, "--check"]);
    expect(check.exitCode).toBe(0);
    expect(check.stdout).toContain(`length=${FIXTURE_VALUE.length}`);
    expect(check.stdout).toContain(`sha256=${FIXTURE_SHA256}`);
  });

  it("rejects combining an argv value with --stdin", async () => {
    const { exitCode } = await runCli(["set", STDIN_KEY, "argv-value", "--stdin"], { stdin: "x\n" });
    expect(exitCode).toBe(1);
  });

  it("rejects an empty stdin value", async () => {
    const { exitCode } = await runCli(["set", STDIN_KEY, "--stdin"], { stdin: "" });
    expect(exitCode).toBe(1);
  });
});
