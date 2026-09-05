import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getPackageVersion } from "../lib/version.js";

/**
 * Regression tests for the binds-before-version class (todos row 8a43ca44).
 *
 * dispatch-daemon --version previously fell through to runDaemon(): the
 * entry called runDaemon() directly with no argv classification, so claimPid
 * threw "daemon already running (pid N)" (rc=1, empty stdout) wherever a
 * daemon was live — and on a free machine it started a real daemon instead of
 * answering. --help was equally unhandled. Same defect class as tickets-mcp
 * (row 5fcf7a67, PR 848), styles-mcp (row 0d02f8b9, PR 844) and
 * calendar-mcp (row 06003b88, PR 838).
 *
 * The probes are two-sided: --help/--version must answer rc=0 WITHOUT
 * entering the daemon path (positive), and a plain start must STILL take the
 * daemon path — the "[dispatch-daemon] started" bind marker appears, then the
 * process is killed (negative). The negative probe runs with DISPATCH_DATA_DIR
 * pointed at a throwaway directory so it never touches live the dispatch data root
 * state and never collides with a running daemon.
 */

const PACKAGE_ROOT = join(import.meta.dir, "..", "..");
const DAEMON_ENTRY = "src/daemon/index.ts";

async function readStream(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!stream) return "";
  return new Response(stream).text();
}

async function runDaemon(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn([process.execPath, "run", DAEMON_ENTRY, ...args], {
    cwd: PACKAGE_ROOT,
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "pipe",
  });
  proc.stdin?.end(); // close stdin: the daemon path never reads it and must not block on it
  const [stdout, stderr, exitCode] = await Promise.all([
    readStream(proc.stdout),
    readStream(proc.stderr),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

describe("dispatch-daemon answers --help/--version before entering the daemon path", () => {
  test("--version prints the package version and exits rc=0 without touching the daemon path", async () => {
    const result = await runDaemon(["--version"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(getPackageVersion());
    expect(result.stderr).toBe("");
  });

  test("-V prints the package version and exits rc=0", async () => {
    const result = await runDaemon(["-V"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(getPackageVersion());
  });

  test("--help prints usage and exits rc=0 without touching the daemon path", async () => {
    const result = await runDaemon(["--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Usage:");
    expect(result.stdout).toContain("dispatch-daemon");
    expect(result.stdout).toContain("--version");
  });

  test("plain start still takes the daemon path (negative probe)", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "dispatch_daemon_early_args_"));
    try {
      const proc = Bun.spawn([process.execPath, "run", DAEMON_ENTRY], {
        cwd: PACKAGE_ROOT,
        env: {
          ...process.env,
          DISPATCH_DATA_DIR: dataDir,
          DISPATCH_DAEMON_INTERVAL_MS: "600000",
        },
        stdout: "pipe",
        stderr: "pipe",
        stdin: "pipe",
      });
      proc.stdin?.end();
      const stdoutPromise = readStream(proc.stdout);
      // Wait for the bind marker: the daemon logged that it started. The
      // daemon keeps running after the marker, so stderr must be read
      // incrementally — a full-stream read would only resolve at exit. If the
      // early-args fix had swallowed the daemon path, the process would exit
      // without ever printing the marker and this probe would fail.
      const sawStart = await new Promise<boolean>((resolve) => {
        const reader = proc.stderr!.getReader();
        const decoder = new TextDecoder();
        let acc = "";
        let settled = false;
        const finish = (v: boolean): void => {
          if (settled) return;
          settled = true;
          reader.cancel().catch(() => {});
          resolve(v);
        };
        const timer = setTimeout(() => finish(false), 10_000);
        const pump = async (): Promise<void> => {
          try {
            for (;;) {
              const { done, value } = await reader.read();
              if (done) {
                clearTimeout(timer);
                finish(acc.includes("[dispatch-daemon] started"));
                return;
              }
              acc += decoder.decode(value);
              if (acc.includes("[dispatch-daemon] started")) {
                clearTimeout(timer);
                finish(true);
                return;
              }
            }
          } catch {
            clearTimeout(timer);
            finish(acc.includes("[dispatch-daemon] started"));
          }
        };
        void pump();
      });
      proc.kill();
      await proc.exited;
      expect(sawStart).toBe(true);
      expect(await stdoutPromise).toBe("");
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  }, 20_000);
});
