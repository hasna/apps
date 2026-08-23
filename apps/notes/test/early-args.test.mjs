import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Regression tests for the binds-before-version class (todos row 7e5f8f3d).
 *
 * notes-mcp --version/--help previously fell straight into the stdio framing
 * loop and printed nothing (silent-empty family). notes-serve --help was
 * handled but --version fell through to resolveConfig()/Bun.serve and bound
 * :8788. Both must answer rc=0 before any transport or bind.
 */

const NOTES_ROOT = new URL("../", import.meta.url).pathname.replace(/\/$/, "");
const PKG_VERSION = JSON.parse(readFileSync(join(NOTES_ROOT, "package.json"), "utf8")).version;

async function readStream(stream) {
  if (!stream) return "";
  return new Response(stream).text();
}

let portCounter = 0;
function nextPort() {
  portCounter += 1;
  return String(40000 + ((process.pid + portCounter) % 20000));
}

async function runBin(entry, args, env = {}) {
  const proc = Bun.spawn([process.execPath, "run", entry, ...args], {
    cwd: NOTES_ROOT,
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
    stdin: "pipe",
  });
  proc.stdin?.end(); // close stdin so a stdio server cannot wait on it
  const stdoutPromise = readStream(proc.stdout);
  const stderrPromise = readStream(proc.stderr);
  const timedOut = await Promise.race([
    proc.exited.then(() => false),
    new Promise((resolve) => {
      setTimeout(() => {
        proc.kill();
        resolve(true);
      }, 4_000);
    }),
  ]);
  const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
  return { stdout, stderr, exitCode: proc.exitCode, timedOut };
}

describe("notes-mcp answers --version/--help without entering stdio (row 7e5f8f3d)", () => {
  test("--version prints the package version and exits", async () => {
    const result = await runBin("bin/notes-mcp.mjs", ["--version"]);
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(PKG_VERSION);
  });

  test("-V prints the package version and exits", async () => {
    const result = await runBin("bin/notes-mcp.mjs", ["-V"]);
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(PKG_VERSION);
  });

  test("--help prints usage and exits", async () => {
    const result = await runBin("bin/notes-mcp.mjs", ["--help"]);
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("notes-mcp");
  });

  test("plain notes-mcp still enters the stdio path (negative probe)", async () => {
    // No early arg: with stdin closed the framing loop ends, printing neither
    // version nor usage. A fix that swallowed the start path would regress.
    const result = await runBin("bin/notes-mcp.mjs", []);
    expect(result.timedOut).toBe(false);
    expect(result.stdout.trim()).not.toBe(PKG_VERSION);
    expect(result.stdout).not.toContain("notes-mcp");
  });
});

describe("notes-serve answers --version/--help before any bind (row 7e5f8f3d)", () => {
  test("--version prints the package version and exits without binding", async () => {
    const result = await runBin("bin/notes-serve.mjs", ["--version"], {
      PORT: nextPort(),
      HASNA_NOTES_DB_PATH: ":memory:",
    });
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(PKG_VERSION);
    expect(result.stdout + result.stderr).not.toContain("listening");
  });

  test("-V prints the package version and exits without binding", async () => {
    const result = await runBin("bin/notes-serve.mjs", ["-V"], {
      PORT: nextPort(),
      HASNA_NOTES_DB_PATH: ":memory:",
    });
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(PKG_VERSION);
    expect(result.stdout + result.stderr).not.toContain("listening");
  });

  test("--help prints usage and exits without binding", async () => {
    const result = await runBin("bin/notes-serve.mjs", ["--help"], {
      PORT: nextPort(),
      HASNA_NOTES_DB_PATH: ":memory:",
    });
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Usage:");
    expect(result.stdout).toContain("--version");
  });
});
