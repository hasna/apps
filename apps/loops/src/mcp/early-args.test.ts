import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { packageVersion } from "../lib/version.js";

/**
 * Regression tests for the binds-before-version class (todos row 7e5f8f3d).
 *
 * loops-mcp --version/--help previously fell through to
 * isStdioMode()/startMcpHttpServer() and bound :8890 before any argument
 * classification (the list-tools special case was handled; --version/--help
 * were not).
 *
 * The probes are two-sided: --version/--help must answer rc=0 with version or
 * usage on stdout and NO bind marker (positive), and the plain path must STILL
 * take the real server path — the bind marker appears and the process keeps
 * serving until killed (negative).
 */

const LOOPS_ROOT = join(import.meta.dir, "../..");

async function readStream(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!stream) return "";
  return new Response(stream).text();
}

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  healthStatus?: number;
  healthBody?: unknown;
  servingBeforeCleanup?: boolean;
}

async function runMcp(args: string[], probeHttp = false): Promise<RunResult> {
  const root = await mkdtemp(join(tmpdir(), "loops-mcp-early-args-"));
  const proc = Bun.spawn([process.execPath, "--no-env-file", "run", "src/mcp/index.ts", ...args], {
    cwd: LOOPS_ROOT,
    // The plain invocation tests the default HTTP transport, regardless of the
    // caller's MCP_STDIO or cloud configuration. Port 0 lets the OS reserve a
    // free port atomically; a PID-derived port can collide with parallel tests.
    env: {
      PATH: process.env.PATH,
      NO_COLOR: "1",
      HASNA_HOME: join(root, "home"),
      HASNA_CONFIG_HOME: join(root, "config"),
      LOOPS_DATA_DIR: join(root, "data"),
      HASNA_LOOPS_CONNECTION: "file",
      MCP_HTTP_PORT: "0",
    },
    stdout: "pipe",
    stderr: "pipe",
    stdin: "pipe",
  });
  proc.stdin?.end(); // close stdin so a stdio server cannot wait on it
  const stdoutPromise = readStream(proc.stdout);
  let stderr = "";
  let listening!: (url: string) => void;
  const ready = new Promise<string>((resolve) => { listening = resolve; });
  const stderrPromise = (async () => {
    const decoder = new TextDecoder();
    for await (const chunk of proc.stderr) {
      stderr += decoder.decode(chunk, { stream: true });
      const match = stderr.match(/HTTP listening on (http:\/\/127\.0\.0\.1:\d+)\/mcp/);
      if (match) listening(match[1]!);
    }
    stderr += decoder.decode();
  })();
  let timedOut = false;
  const deadline = setTimeout(() => {
    timedOut = true;
    proc.kill("SIGKILL");
  }, 4_000);
  let healthStatus: number | undefined;
  let healthBody: unknown;
  let servingBeforeCleanup: boolean | undefined;
  try {
    if (probeHttp) {
      const url = await Promise.race([ready, proc.exited.then(() => undefined)]);
      if (url) {
        const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1_000) });
        healthStatus = response.status;
        healthBody = await response.json();
        servingBeforeCleanup = proc.exitCode === null;
      }
    } else {
      await proc.exited;
    }
  } finally {
    if (proc.exitCode === null) {
      proc.kill("SIGTERM");
      const forceStop = setTimeout(() => proc.kill("SIGKILL"), 500);
      try {
        await proc.exited;
      } finally {
        clearTimeout(forceStop);
      }
    }
    clearTimeout(deadline);
    await Promise.all([stdoutPromise, stderrPromise]);
    await rm(root, { recursive: true, force: true });
  }
  return {
    stdout: await stdoutPromise, stderr, exitCode: proc.exitCode, timedOut,
    healthStatus, healthBody, servingBeforeCleanup,
  };
}

describe("loops-mcp answers --version/--help before any bind (row 7e5f8f3d)", () => {
  test("--version prints the package version and exits without binding", async () => {
    const result = await runMcp(["--version"]);
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(packageVersion());
    expect(result.stdout + result.stderr).not.toContain("HTTP listening on");
  });

  test("-V prints the package version and exits without binding", async () => {
    const result = await runMcp(["-V"]);
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(packageVersion());
    expect(result.stdout + result.stderr).not.toContain("HTTP listening on");
  });

  test("--help prints usage and exits without binding", async () => {
    const result = await runMcp(["--help"]);
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Usage: loops-mcp");
    expect(result.stdout + result.stderr).not.toContain("HTTP listening on");
  });

  test("plain loops-mcp still starts the HTTP server (negative probe)", async () => {
    // No early arg: require a real HTTP response while the child is alive,
    // rather than treating a startup timeout as evidence of a working server.
    // Include the isolated child's diagnostics if startup exits unexpectedly.
    const result = await runMcp([], true);
    expect(result).toMatchObject({
      timedOut: false,
      healthStatus: 200,
      healthBody: { status: "ok", name: "loops" },
      servingBeforeCleanup: true,
    });
  });
});
