import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const rootDir = join(import.meta.dir, "..");

// CLI coverage for `secrets copy <old> <new>`. The load-bearing property is the
// value-safety invariant: the copied value must never appear on stdout or
// stderr in any form (the CLI transport writes agent tool output verbatim to
// session transcripts, which is the exact leak the default-deny rules exist
// for). Fixture values follow the scanner-silent convention: obviously fake,
// no detector shape, asserted by length + sha256.

const FIXTURE_KEY = "example/copy-test/test/source_key";
const FIXTURE_DEST = "example/copy-test/test/dest_key";
const FIXTURE_VALUE = "fixture-not-a-real-credential-0123456789abcdef";
const FIXTURE_SHA256 = createHash("sha256").update(FIXTURE_VALUE).digest("hex");

let vaultDir: string;

function cliEnv(): Record<string, string | undefined> {
  return {
    ...process.env,
    HASNA_SECRETS_DB_PATH: join(vaultDir, "vault.db"),
    HASNA_SECRETS_KEY_DIR: join(vaultDir, "keys"),
    // #681: an unselected/default transport emits a machine-readable
    // `secrets-local-fallback` JSON line on stderr when a local store exists.
    // Retired storage-mode variables are a hard error now, so there is no
    // "explicitly selected local" anymore — every local run without a URL+key
    // pair emits the fallback line, and assertions below tolerate exactly that
    // one line. The corrupting-server test below routes with URL + key only.
    NO_COLOR: "1",
  };
}

async function runCli(args: string[], opts: { env?: Record<string, string | undefined> } = {}) {
  const proc = Bun.spawn({
    cmd: ["bun", "src/index.ts", ...args],
    cwd: rootDir,
    env: { ...cliEnv(), ...opts.env },
    stdin: "ignore",
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

/** Extract `length=N sha256=<hex>` from a `get --check` line. */
function parseCheck(line: string): { length: number; hash: string } {
  const length = Number(line.match(/length=(\d+)/)?.[1]);
  const hash = line.match(/sha256=([0-9a-f]+)/)?.[1] ?? "";
  return { length, hash };
}

beforeAll(async () => {
  vaultDir = mkdtempSync(join(tmpdir(), "secrets-cli-copy-"));
  writeFileSync(join(vaultDir, "not-an-env"), "", { mode: 0o600 });
  const seeded = await runCli(["set", FIXTURE_KEY, FIXTURE_VALUE, "--type", "api_key", "--label", "Source label"]);
  if (seeded.exitCode !== 0) {
    throw new Error(`fixture seed failed: ${seeded.stderr}`);
  }
});

afterAll(() => {
  rmSync(vaultDir, { recursive: true, force: true });
});

describe("CLI copy — value-safety invariant", () => {
  // Positive control: the vault really holds the fixture value, so the
  // "value never appears" assertions are falsifiable against an empty vault.
  it("positive control — get --show (explicit escape hatch) emits the value", async () => {
    const { stdout, exitCode } = await runCli(["get", FIXTURE_KEY, "--show"]);
    expect(exitCode).toBe(0);
    expect(stdout).toBe(FIXTURE_VALUE);
  });

  it("copies the key and the value never appears in any output", async () => {
    const before = await runCli(["get", FIXTURE_KEY, "--check"]);
    expect(before.exitCode).toBe(0);
    const beforeCheck = parseCheck(before.stdout);
    expect(beforeCheck.length).toBe(FIXTURE_VALUE.length);
    expect(beforeCheck.hash).toBe(FIXTURE_SHA256);

    const copy = await runCli([
      "copy",
      FIXTURE_KEY,
      FIXTURE_DEST,
      "--type",
      "token",
      "--label",
      "Destination label",
    ]);
    expect(copy.exitCode).toBe(0);
    expect(copy.stdout + copy.stderr).not.toContain(FIXTURE_VALUE);
    expect(copy.stdout).toContain(FIXTURE_KEY);
    expect(copy.stdout).toContain(FIXTURE_DEST);

    // Destination holds the copied value (proven by check, not by value).
    const dest = await runCli(["get", FIXTURE_DEST, "--check"]);
    expect(dest.exitCode).toBe(0);
    const destCheck = parseCheck(dest.stdout);
    expect(destCheck.length).toBe(FIXTURE_VALUE.length);
    expect(destCheck.hash).toBe(FIXTURE_SHA256);

    // Source key is intact (copy semantics — deletion is a separate explicit op).
    const after = await runCli(["get", FIXTURE_KEY, "--check"]);
    expect(after.exitCode).toBe(0);
    expect(parseCheck(after.stdout)).toEqual(beforeCheck);

    // Cleanup the destination so sibling tests start from a clear state.
    await runCli(["delete", FIXTURE_DEST]);
  });

  it("copies value-free in --json mode too", async () => {
    const copy = await runCli(["copy", FIXTURE_KEY, FIXTURE_DEST, "--json"]);
    expect(copy.exitCode).toBe(0);
    // The #681 local-fallback JSON line is expected on stderr for a local run
    // without a URL+key pair (retired mode vars cannot select local anymore);
    // nothing else may appear there.
    const fallbackLines = copy.stderr
      .split("\n")
      .filter((line) => line.includes('"event":"secrets-local-fallback"'));
    expect(fallbackLines.length).toBe(1);
    expect(copy.stderr.replace(fallbackLines.join("\n"), "").trim()).toBe("");
    expect(copy.stdout).not.toContain(FIXTURE_VALUE);
    const parsed = JSON.parse(copy.stdout);
    expect(parsed.old_key).toBe(FIXTURE_KEY);
    expect(parsed.new_key).toBe(FIXTURE_DEST);
    expect(parsed.reason).toBe(`migrated from ${FIXTURE_KEY}`);
    await runCli(["delete", FIXTURE_DEST]);
  });

  it("refuses an identical source and destination", async () => {
    const { stdout, stderr, exitCode } = await runCli(["copy", FIXTURE_KEY, FIXTURE_KEY]);
    expect(exitCode).toBe(1);
    expect(stdout + stderr).toContain("must differ");
    expect(stdout + stderr).not.toContain(FIXTURE_VALUE);
  });

  it("reports a missing source cleanly", async () => {
    const { stdout, stderr, exitCode } = await runCli([
      "copy",
      "example/copy-test/test/does_not_exist",
      FIXTURE_DEST,
    ]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Not found");
    expect(stdout + stderr).not.toContain(FIXTURE_VALUE);
  });
});

describe("CLI copy --verify", () => {
  it("exits 0 on match with a verified note, value never emitted", async () => {
    const copy = await runCli(["copy", FIXTURE_KEY, FIXTURE_DEST, "--verify"]);
    expect(copy.exitCode).toBe(0);
    expect(copy.stdout + copy.stderr).not.toContain(FIXTURE_VALUE);
    expect(copy.stdout).toContain("verified");
    expect(copy.stdout).toMatch(/sha256 match/);
    await runCli(["delete", FIXTURE_DEST]);
  });
});

// A stand-in cloud API whose POST /secrets silently CORRUPTS the stored value.
// `copy --verify` (get -> set -> get length+sha256 comparison) is the only
// guard that can catch this transport-level fault, and it must fail LOUDLY
// (non-zero exit, redacted message) with the real value never reaching any
// output surface.
describe("CLI copy --verify against a corrupting server", () => {
  let server: ReturnType<typeof Bun.serve>;
  const CLOUD_OLD = "example/cloud-copy/test/source_key";
  const CLOUD_NEW = "example/cloud-copy/test/dest_key";
  const CLOUD_VALUE = "fixture-not-a-real-credential-zz7890abcdef";
  const CORRUPT_SUFFIX = "-corrupted-by-server";

  beforeAll(() => {
    let stored = ""; // value the (buggy) server "persists"
    server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (req.method === "GET" && url.pathname === "/v1/secrets/get") {
          const key = url.searchParams.get("key") ?? "";
          if (key === CLOUD_OLD || key === CLOUD_NEW) {
            return Response.json({
              key,
              value: key === CLOUD_NEW ? stored : CLOUD_VALUE,
              type: "api_key",
              created_at: "2026-01-01T00:00:00.000Z",
              updated_at: "2026-01-01T00:00:00.000Z",
            });
          }
          return Response.json({ error: "not found" }, { status: 404 });
        }
        if (req.method === "POST" && url.pathname === "/v1/secrets") {
          return req.json().then((body: { key?: string; value?: string }) => {
            // THE DEFECT UNDER TEST: the server persists a corrupted value.
            stored = `${body.value ?? ""}${CORRUPT_SUFFIX}`;
            return Response.json({ version: 1, unchanged: false });
          });
        }
        return Response.json({ error: "unexpected" }, { status: 500 });
      },
    });
  });

  afterAll(() => {
    server.stop(true);
  });

  it("non-zero exit, redacted message, and no value bytes on any surface", async () => {
    const cloudEnv = {
      HASNA_SECRETS_API_URL: `http://localhost:${server.port}` as const,
      HASNA_SECRETS_API_KEY: "test-api-key" as const,
    };
    const copy = await runCli(["copy", CLOUD_OLD, CLOUD_NEW, "--verify"], { env: cloudEnv });
    expect(copy.exitCode).toBe(1);
    expect(copy.stderr).toMatch(/verification FAILED/i);
    // Neither the real value nor the corrupted value may surface.
    expect(copy.stdout + copy.stderr).not.toContain(CLOUD_VALUE);
    expect(copy.stdout + copy.stderr).not.toContain(CORRUPT_SUFFIX);
    expect(copy.stdout + copy.stderr).not.toContain("CORRUPTED");
  });
});
