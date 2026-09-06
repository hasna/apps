/**
 * Regression tests for the binds-before-version class (control surfaces must
 * answer --version/--help before any transport or bind — the same class as
 * the recent hasna/apps control-surface fixes). messages-mcp --version/--help
 * must answer before the stdio framing loop; messages-serve --version/--help
 * must answer before resolveStore()/Bun.serve binds the port. Ordering after
 * the early exits: the messages-mcp fail-closed gate (no credential resolves,
 * no HASNA_MESSAGES_LOCAL opt-in -> exit non-zero naming the required env)
 * runs before the stdio connect, never before --version/--help. The spawn
 * environment is hermetic: a fake HOME, so the machine's credential stores
 * can never satisfy the gate.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const PKG_VERSION = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version as string;

const fakeHome = mkdtempSync(join(tmpdir(), "messages-early-args-home-"));
afterAll(() => {
  rmSync(fakeHome, { recursive: true, force: true });
});

async function readStream(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!stream) return "";
  return new Response(stream).text();
}

/** Hermetic spawn env: fake HOME, no fleet credential variables of any spelling. */
function hermeticEnv(env: Record<string, string> = {}): Record<string, string> {
  const out: Record<string, string> = { HOME: fakeHome };
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (key.startsWith("HASNA_MESSAGES_") || key.startsWith("MESSAGES_")) continue;
    if (key === "HASNA_PROFILE" || key === "HASNA_HOME" || key === "HASNA_CONFIG_HOME") continue;
    if (key === "CONVERSATIONS_AGENT_ID") continue;
    out[key] = value;
  }
  return { ...out, ...env };
}

async function runEntry(entry: string, args: string[], env: Record<string, string> = {}): Promise<{ stdout: string; stderr: string; exitCode: number | null; timedOut: boolean }> {
  const proc = Bun.spawn([process.execPath, "run", entry, ...args], {
    cwd: ROOT,
    env: hermeticEnv(env),
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

describe("messages-mcp fails closed without the fleet API env", () => {
  test("startup without HASNA_MESSAGES_API_URL and without the local opt-in exits non-zero and names the required env", async () => {
    const r = await runEntry("src/mcp/index.ts", [], {
      HASNA_MESSAGES_API_URL: "",
      HASNA_MESSAGES_API_KEY: "",
      HASNA_MESSAGES_LOCAL: "",
    });
    expect(r.timedOut).toBe(false); // it must exit, not sit in the stdio loop
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toContain("HASNA_MESSAGES_API_URL");
  });

  test("--version still answers before the fail-closed gate", async () => {
    const r = await runEntry("src/mcp/index.ts", ["--version"], {
      HASNA_MESSAGES_API_URL: "",
      HASNA_MESSAGES_API_KEY: "",
      HASNA_MESSAGES_LOCAL: "",
    });
    expect(r.timedOut).toBe(false);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe(PKG_VERSION);
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
