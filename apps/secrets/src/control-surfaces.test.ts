import { describe, expect, test } from "bun:test";
import { join } from "node:path";

/**
 * Regression tests for the binds-before-help class (todos row afd9e358).
 *
 * The three control-surface bins of @hasna/secrets 0.3.6 did not answer
 * --version/--help cleanly:
 *   - `secrets --version`       -> rc=1, "Unknown command: --version"
 *   - `secrets-mcp --version`   -> entered MCP stdio mode, printed nothing,
 *                                  and exited rc=0 silently when stdin closed
 *   - `secrets-serve --version` -> fell through to the cloud-server boot path
 *                                  (master-key refusal rc=1, or
 *                                  bind-and-serve forever)
 * Same defect class as styles-mcp (row 0d02f8b9, PR 844), calendar-mcp
 * (row 06003b88, PR 838), and tickets serve/mcp (row 5fcf7a67, PR 848).
 *
 * The probes assert the exact contract: --version prints the package version
 * (pinned via HASNA_SECRETS_VERSION so the assertion does not depend on the
 * package.json sync), --help prints usage, both rc=0, with no MCP protocol
 * traffic and no boot/bind markers. The negative probes assert the real
 * dispatch/boot paths are still taken when no early arg is present.
 */

const SECRETS_ROOT = join(import.meta.dir, "..");
/** Pinned fake version so the probes assert the exact version contract. */
const PROBE_VERSION = "9.9.9-probe";

async function readStream(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!stream) return "";
  return new Response(stream).text();
}

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
}

async function runBin(
  entry: string,
  args: string[],
  extraEnv: Record<string, string | undefined> = {},
): Promise<RunResult> {
  const env: Record<string, string> = { ...process.env, HASNA_SECRETS_VERSION: PROBE_VERSION };
  for (const [key, value] of Object.entries(extraEnv)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  const proc = Bun.spawn([process.execPath, "run", entry, ...args], {
    cwd: SECRETS_ROOT,
    env,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "pipe",
  });
  proc.stdin?.end(); // close stdin so a stdio server cannot wait on it
  const stdoutPromise = readStream(proc.stdout);
  const stderrPromise = readStream(proc.stderr);
  const timedOut = await Promise.race([
    proc.exited.then(() => false),
    new Promise<boolean>((resolve) => {
      setTimeout(() => {
        proc.kill();
        resolve(true);
      }, 10_000);
    }),
  ]);
  const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
  return { stdout, stderr, exitCode: proc.exitCode, timedOut };
}

describe("secrets CLI answers --version/--help cleanly (row afd9e358)", () => {
  test("--version prints the package version and exits rc=0", async () => {
    const result = await runBin("src/index.ts", ["--version"]);
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(PROBE_VERSION);
  });

  test("-V prints the package version and exits rc=0", async () => {
    const result = await runBin("src/index.ts", ["-V"]);
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(PROBE_VERSION);
  });

  test("--help still prints usage and exits rc=0", async () => {
    const result = await runBin("src/index.ts", ["--help"]);
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("secrets — local secrets vault for AI agents");
  });

  test("real commands still dispatch (negative probe)", async () => {
    // The early-args check must not swallow the real dispatch path.
    const result = await runBin("src/index.ts", ["docs"]);
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("secrets docs");
  });
});

describe("secrets-mcp answers --version/--help without entering stdio (row afd9e358)", () => {
  test("--version prints the package version and exits", async () => {
    const result = await runBin("src/mcp-server.ts", ["--version"]);
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(PROBE_VERSION);
    expect(result.stdout).not.toContain("jsonrpc");
  });

  test("-V prints the package version and exits", async () => {
    const result = await runBin("src/mcp-server.ts", ["-V"]);
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(PROBE_VERSION);
  });

  test("--help prints usage and exits", async () => {
    const result = await runBin("src/mcp-server.ts", ["--help"]);
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Usage:");
    expect(result.stdout).toContain("secrets-mcp");
    expect(result.stdout).not.toContain("jsonrpc");
  });

  test("plain mcp (no early args) still reaches the transport path (negative probe)", async () => {
    // No early arg: the stdio transport path must still be reached — with stdin
    // closed it ends the transport and exits rc=0, printing neither the version
    // nor usage. A fix that swallowed or skipped the start path would regress
    // this side.
    const result = await runBin("src/mcp-server.ts", []);
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).not.toContain(PROBE_VERSION);
    expect(result.stdout).not.toContain("Usage:");
  });
});

describe("secrets-serve answers --version/--help before the boot path (row afd9e358)", () => {
  // Scrub the master-key vars from the child env so the boot-path negative
  // probe deterministically fails at the master-key gate even on a machine
  // that operates secrets-serve with HASNA_SECRETS_MASTER_KEY set.
  const SERVE_SCRUB: Record<string, string | undefined> = {
    HASNA_SECRETS_MASTER_KEY: undefined,
    SECRETS_MASTER_KEY: undefined,
  };

  test("--version prints the package version and exits without booting", async () => {
    const result = await runBin("src/server/index.ts", ["--version"], SERVE_SCRUB);
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(PROBE_VERSION);
    expect(result.stdout + result.stderr).not.toContain("secrets-serve listening");
    expect(result.stdout + result.stderr).not.toContain("requires a master key");
  });

  test("--help prints usage and exits without booting", async () => {
    const result = await runBin("src/server/index.ts", ["--help"], SERVE_SCRUB);
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("usage: secrets-serve");
    expect(result.stdout + result.stderr).not.toContain("secrets-serve listening");
  });

  test("plain serve still takes the real boot path (negative probe)", async () => {
    // No early arg: the boot path must still be reached — here it fails fast at
    // the master-key gate (rc=1) instead of answering version/usage. A fix that
    // swallowed or skipped the start path would regress this side.
    const result = await runBin("src/server/index.ts", [], SERVE_SCRUB);
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("requires a master key");
    expect(result.stdout).not.toContain(PROBE_VERSION);
  });
});
