import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import pkg from "../../package.json" with { type: "json" };
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

/**
 * Regression tests for the binds-before-version class (todos row 7e5f8f3d).
 *
 * skills-server --version/--help previously fell through to
 * resolveServerConfig()/startSkillsServer() and bound :8787 before any
 * argument classification.
 *
 * The probes are two-sided: --version/--help must answer rc=0 with version or
 * usage on stdout and NO bind marker (positive), and plain serve must STILL
 * take the real start path — the bind marker appears and the process keeps
 * serving until killed (negative).
 */

const SKILLS_ROOT = join(import.meta.dir, "../..");
const BIND_MARKER = "skills API listening on";

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

async function runServe(args: string[]): Promise<RunResult> {
  const proc = Bun.spawn([process.execPath, "run", "src/server/index.ts", ...args], {
    cwd: SKILLS_ROOT,
    env: {
      ...process.env,
      SKILLS_PORT: nextPort(),
      HASNA_SKILLS_ALLOW_EPHEMERAL_STORE: "1",
      HASNA_SKILLS_DATABASE_URL: ":memory:",
    },
    stdout: "pipe",
    stderr: "pipe",
    stdin: "pipe",
  });
  proc.stdin?.end(); // close stdin so nothing can wait on it
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

describe("skills-server answers --version/--help before any bind (row 7e5f8f3d)", () => {
  test("--version prints the package version and exits without binding", async () => {
    const result = await runServe(["--version"]);
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(pkg.version);
    expect(result.stdout + result.stderr).not.toContain(BIND_MARKER);
  });

  test("-V prints the package version and exits without binding", async () => {
    const result = await runServe(["-V"]);
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(pkg.version);
    expect(result.stdout + result.stderr).not.toContain(BIND_MARKER);
  });

  test("--help prints usage and exits without binding", async () => {
    const result = await runServe(["--help"]);
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Usage: skills-server");
    expect(result.stdout + result.stderr).not.toContain(BIND_MARKER);
  });

  test("plain serve still binds and serves (negative probe)", async () => {
    // No early arg: the real serve path must still be taken — the bind marker
    // appears and the process keeps serving until killed. A fix that
    // swallowed the start path would regress this side.
    const result = await runServe([]);
    expect(result.timedOut).toBe(true);
    expect(result.stdout + result.stderr).toContain(BIND_MARKER);
  });
});
