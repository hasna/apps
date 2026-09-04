import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { getPackageVersion } from "../lib/package-version.js";

/**
 * Regression tests for the binds-before-version class (todos row 7e5f8f3d).
 *
 * instructions-mcp/configs-mcp --version/--help previously fell through to
 * isStdioMode()/startMcpHttpServer() and bound :8853 before any argument
 * classification (the --claude special case was handled; --version/--help
 * were not).
 *
 * The probes are two-sided: --version/--help must answer rc=0 with version or
 * usage on stdout and NO bind marker (positive), and the plain path must STILL
 * take the real server path — the bind marker appears and the process keeps
 * serving until killed (negative).
 */

const MCP_ROOT = join(import.meta.dir, "../..");
const BIND_MARKER = "HTTP listening on http://127.0.0.1:";

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

async function runMcp(
  args: string[],
  env: Record<string, string> = {},
  scrub: string[] = [],
): Promise<RunResult> {
  const childEnv: Record<string, string> = { ...process.env, MCP_HTTP_PORT: nextPort(), ...env };
  for (const key of scrub) delete childEnv[key];
  const proc = Bun.spawn([process.execPath, "run", "src/mcp/index.ts", ...args], {
    cwd: MCP_ROOT,
    env: childEnv,
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
      }, 4_000);
    }),
  ]);
  const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
  return { stdout, stderr, exitCode: proc.exitCode, timedOut };
}

describe("instructions-mcp answers --version/--help before any bind (row 7e5f8f3d)", () => {
  test("--version prints the package version and exits without binding", async () => {
    const result = await runMcp(["--version"]);
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(getPackageVersion());
    expect(result.stdout + result.stderr).not.toContain(BIND_MARKER);
  });

  test("-V prints the package version and exits without binding", async () => {
    const result = await runMcp(["-V"]);
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(getPackageVersion());
    expect(result.stdout + result.stderr).not.toContain(BIND_MARKER);
  });

  test("--help prints usage and exits without binding", async () => {
    const result = await runMcp(["--help"]);
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Usage: configs-mcp");
    expect(result.stdout + result.stderr).not.toContain(BIND_MARKER);
  });

  test("plain configs-mcp still starts the HTTP server (negative probe)", async () => {
    // No early arg: the real HTTP server path must still be taken — the bind
    // marker appears and the process keeps serving until killed. A fix that
    // swallowed the start path would regress this side. The explicit local
    // opt-in keeps this probe about the start path, not about fail-closed
    // mode selection (the runner may also pin it via the test preload).
    const result = await runMcp([], { HASNA_INSTRUCTIONS_LOCAL: "1" });
    expect(result.timedOut).toBe(true);
    expect(result.stdout + result.stderr).toContain(BIND_MARKER);
  });

  test("refuses to start without fleet env and without the local opt-in (fail closed)", async () => {
    // Owner directive 2026-09-04: with no HASNA_INSTRUCTIONS_API_URL/KEY and no
    // HASNA_INSTRUCTIONS_LOCAL=1 the MCP bin must exit non-zero naming the
    // required env — never silently serve the on-box SQLite store. The child
    // env is scrubbed so the runner-level test pins cannot mask the refusal.
    const result = await runMcp([], {}, [
      "HASNA_INSTRUCTIONS_API_URL",
      "HASNA_INSTRUCTIONS_API_KEY",
      "HASNA_INSTRUCTIONS_DB_PATH",
      "HASNA_CONFIGS_HOME",
      "HASNA_INSTRUCTIONS_LOCAL",
    ]);
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(1);
    const output = result.stdout + result.stderr;
    expect(output).toContain("HASNA_INSTRUCTIONS_API_URL");
    expect(output).toContain("HASNA_INSTRUCTIONS_API_KEY");
    expect(output).toContain("HASNA_INSTRUCTIONS_LOCAL");
    expect(output).not.toContain(BIND_MARKER);
  });
});
