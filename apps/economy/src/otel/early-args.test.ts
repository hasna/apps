import { describe, expect, test } from "bun:test";

import { packageMetadata } from "../lib/package-metadata.js";

/**
 * Regression tests for the binds-before-version class (todos row 7e5f8f3d).
 *
 * economy-otel --version previously fell through to resolvePort()/Bun.serve
 * and bound the OTLP listener (:4318) before any argument classification.
 * --help was already handled; --version was not.
 *
 * The probes are two-sided: --version/--help must answer rc=0 with version or
 * usage on stdout and NO bind (positive), and plain otel start must STILL take
 * the real bind path (negative). Each probe uses its own pinned port so a
 * killed child's lingering socket cannot collide with the next probe.
 */

const OTEL_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");

let portCounter = 0;
function nextPort(): string {
  portCounter += 1;
  return String(40000 + ((process.pid + portCounter) % 20000));
}

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

function spawnOtel(args: string[], port: string) {
  const env: Record<string, string> = {
    ...process.env,
    ECONOMY_OTEL_PORT: port,
    ECONOMY_DB: ":memory:",
    // The sidecar follows the storage seam (fail-closed without a credential
    // or the explicit opt-in), so the negative probe — a REAL bind — needs a
    // legal storage lane: pin the local opt-in and blank every inherited
    // fleet authority so the run is hermetic on any station.
    HOME: "",
    HASNA_ECONOMY_API_URL: "",
    HASNA_ECONOMY_API_KEY: "",
    ECONOMY_API_URL: "",
    ECONOMY_API_KEY: "",
    HASNA_ECONOMY_LOCAL: "1",
    ECONOMY_LOCAL: "1",
  };
  const proc = Bun.spawn([process.execPath, "run", "src/otel/index.ts", ...args], {
    cwd: OTEL_ROOT,
    env,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "pipe",
  });
  proc.stdin?.end(); // close stdin so nothing can wait on it
  return { proc };
}

async function runOtel(args: string[]): Promise<RunResult> {
  const port = nextPort();
  const { proc } = spawnOtel(args, port);
  const stdoutPromise = readStream(proc.stdout);
  const stderrPromise = readStream(proc.stderr);
  const timedOut = await Promise.race([
    proc.exited.then(() => false),
    new Promise<boolean>((resolve) => {
      setTimeout(() => {
        proc.kill();
        resolve(true);
      }, 4_000);
    }),
  ]);
  const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
  return { stdout, stderr, exitCode: proc.exitCode, timedOut };
}

describe("economy-otel answers --version/--help before any bind (row 7e5f8f3d)", () => {
  test("--version prints the package version and exits without binding", async () => {
    const result = await runOtel(["--version"]);
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(packageMetadata.version);
    // No health/serve output and no hanging: the OTLP listener never bound.
    expect(result.stdout + result.stderr).not.toContain("listening on http");
  });

  test("-V prints the package version and exits without binding", async () => {
    const result = await runOtel(["-V"]);
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(packageMetadata.version);
    expect(result.stdout + result.stderr).not.toContain("listening on http");
  });

  test("--help prints usage and exits without binding", async () => {
    const result = await runOtel(["--help"]);
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Usage: economy-otel [options]");
    expect(result.stdout).toContain("-V, --version");
    expect(result.stdout + result.stderr).not.toContain("listening on http");
  });

  test("plain otel start still binds and serves (negative probe)", async () => {
    // No early arg: the real OTLP bind path must still be taken — the process
    // keeps serving until killed, printing neither version nor usage. A fix
    // that swallowed the start path would regress this side.
    const result = await runOtel([]);
    expect(result.timedOut).toBe(true);
    expect(result.stdout.trim()).not.toBe(packageMetadata.version);
    expect(result.stdout).not.toContain("Usage: economy-otel");
  });
});
