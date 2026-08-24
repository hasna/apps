/**
 * Regression tests for the binds-before-version class (control surfaces must
 * answer --version/--help before any transport or bind — the same class as
 * the recent hasna/apps control-surface fixes). messages-mcp --version/--help
 * must answer before the stdio framing loop; messages-serve --version/--help
 * must answer before resolveStore()/Bun.serve binds the port.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const PKG_VERSION = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version as string;

async function readStream(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!stream) return "";
  return new Response(stream).text();
}

async function runEntry(entry: string, args: string[], env: Record<string, string> = {}): Promise<{ stdout: string; stderr: string; exitCode: number | null; timedOut: boolean }> {
  const proc = Bun.spawn([process.execPath, "run", entry, ...args], {
    cwd: ROOT,
    env: { ...(process.env as Record<string, string>), ...env },
    stdout: "pipe",
    stderr: "pipe",
    stdin: "pipe",
  });
  proc.stdin?.end();
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

describe("messages-mcp answers --version/--help without entering stdio", () => {
  test("--version prints the package version and exits", async () => {
    const r = await runEntry("src/mcp/index.ts", ["--version"]);
    expect(r.timedOut).toBe(false);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe(PKG_VERSION);
  });

  test("-V prints the package version and exits", async () => {
    const r = await runEntry("src/mcp/index.ts", ["-V"]);
    expect(r.timedOut).toBe(false);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe(PKG_VERSION);
  });

  test("--help prints usage and exits", async () => {
    const r = await runEntry("src/mcp/index.ts", ["--help"]);
    expect(r.timedOut).toBe(false);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("messages-mcp");
  });
});

describe("messages-serve answers --version/--help before any bind", () => {
  test("--version prints the package version and exits without binding", async () => {
    const r = await runEntry("src/server/serve-entry.ts", ["--version"], { PORT: "40999" });
    expect(r.timedOut).toBe(false);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe(PKG_VERSION);
    expect(r.stdout + r.stderr).not.toContain("listening");
  });

  test("-V prints the package version and exits without binding", async () => {
    const r = await runEntry("src/server/serve-entry.ts", ["-V"], { PORT: "40999" });
    expect(r.timedOut).toBe(false);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe(PKG_VERSION);
  });

  test("--help prints usage and exits without binding", async () => {
    const r = await runEntry("src/server/serve-entry.ts", ["--help"], { PORT: "40999" });
    expect(r.timedOut).toBe(false);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("Usage:");
    expect(r.stdout + r.stderr).not.toContain("listening");
  });
});
