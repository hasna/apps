import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

/**
 * Fail-closed regression probes (owner ruling 2026-09-04): a fleet bin run
 * WITHOUT its API env must exit non-zero with an actionable error naming the
 * required environment — never serve local SQLite (~/.hasna/attachments/),
 * never report a local-fallback event with exit 0, never default to local
 * mode.
 *
 * These spawn the real entrypoints as subprocesses — the only way to assert
 * process exit codes and filesystem side effects — under a scratch HOME so
 * any accidental ~/.hasna write would land in the probe directory and be
 * detected instead of touching the operator's real home.
 */

const APP_ROOT = new URL("../../../", import.meta.url).pathname; // apps/attachments/
const CLI_ENTRY = new URL("./index.ts", import.meta.url).pathname; // src/cli/index.ts
const SERVE_ENTRY = new URL("../serve/index.ts", import.meta.url).pathname; // src/serve/index.ts

const SCRUB_SUBSTRINGS = ["ATTACHMENTS", "HASNA_API_SIGNING_KEY"];

function scrubEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (SCRUB_SUBSTRINGS.some((needle) => name.includes(needle))) continue;
    env[name] = value;
  }
  return env;
}

type ProbeResult = { code: number; stdout: string; stderr: string; timedOut: boolean };

async function runEntry(entry: string, args: string[], home: string, extraEnv: Record<string, string> = {}): Promise<ProbeResult> {
  const proc = Bun.spawn([process.execPath, "run", entry, ...args], {
    cwd: APP_ROOT,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...scrubEnv(), HOME: home, PORT: "0", ...extraEnv },
  });
  const stdoutPromise = new Response(proc.stdout).text();
  const stderrPromise = new Response(proc.stderr).text();
  const timedOut = await Promise.race([
    proc.exited.then(() => false),
    new Promise<boolean>((resolve) => {
      setTimeout(() => {
        proc.kill();
        resolve(true);
      }, 20_000);
    }),
  ]);
  const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
  return { stdout, stderr, code: proc.exitCode ?? -1, timedOut };
}

function scratchHome(): string {
  return mkdtempSync(join(tmpdir(), "attachments-failclosed-"));
}

describe("fleet CLI fail-closed without API env", () => {
  test("attachments list exits non-zero, names the env, and creates no local data dir", async () => {
    const home = scratchHome();
    try {
      const result = await runEntry(CLI_ENTRY, ["list"], home);
      expect(result.timedOut).toBe(false);
      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain("HASNA_ATTACHMENTS_API_URL");
      expect(result.stdout).toBe("");
      // Never touch ~/.hasna/attachments — no SQLite file, no config dir.
      expect(existsSync(join(home, ".hasna", "attachments"))).toBe(false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("a partial pair is STRICT: URL without a key exits non-zero and never falls back to local", async () => {
    const home = scratchHome();
    try {
      const result = await runEntry(CLI_ENTRY, ["list"], home, {
        HASNA_ATTACHMENTS_API_URL: "https://api.hasna.com/attachments",
      });
      expect(result.timedOut).toBe(false);
      expect(result.code).not.toBe(0);
      expect(result.stderr).toMatch(/no API key could be resolved/i);
      expect(result.stderr).toMatch(/local|fallback/i);
      // No SQLite, no local-fallback event, no data dir.
      expect(existsSync(join(home, ".hasna", "attachments"))).toBe(false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("a key without a URL resolves the fleet gateway — never a local fallback", async () => {
    const home = scratchHome();
    try {
      const result = await runEntry(CLI_ENTRY, ["list"], home, {
        HASNA_ATTACHMENTS_API_KEY: "fixture-key",
      });
      // The resolver accepts a key alone as a complete configuration (default
      // gateway); the run is HOSTED — it must therefore reach the network
      // (and fail with a network/HTTP error), never select a local store.
      expect(result.timedOut).toBe(false);
      expect(result.code).not.toBe(0);
      expect(result.stderr).not.toMatch(/no API key could be resolved/i);
      expect(existsSync(join(home, ".hasna", "attachments"))).toBe(false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("attachments doctor exits 1 and names the required env pair", async () => {
    const home = scratchHome();
    try {
      const result = await runEntry(CLI_ENTRY, ["doctor"], home);
      expect(result.timedOut).toBe(false);
      expect(result.code).toBe(1);
      expect(result.stdout).toContain("BLOCKED");
      expect(result.stdout).toContain("HASNA_ATTACHMENTS_API_URL and HASNA_ATTACHMENTS_API_KEY");
      expect(result.stdout).toContain("No local fallback exists");
      expect(existsSync(join(home, ".hasna", "attachments"))).toBe(false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("help and version stay available without env (control: only data ops fail closed)", async () => {
    const home = scratchHome();
    try {
      const help = await runEntry(CLI_ENTRY, ["--help"], home);
      expect(help.timedOut).toBe(false);
      expect(help.code).toBe(0);
      expect(help.stdout.toLowerCase()).toContain("usage");
      const version = await runEntry(CLI_ENTRY, ["--version"], home);
      expect(version.timedOut).toBe(false);
      expect(version.code).toBe(0);
      expect(version.stdout).toMatch(/\d+\.\d+\.\d+/);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("attachments-serve fail-closed without env", () => {
  test("plain serve exits 1 and names the missing signing env", async () => {
    const home = scratchHome();
    try {
      const result = await runEntry(SERVE_ENTRY, [], home);
      expect(result.timedOut).toBe(false);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("[attachments-serve] fatal:");
      expect(result.stderr).toContain("HASNA_ATTACHMENTS_API_SIGNING_KEY");
      expect(existsSync(join(home, ".hasna", "attachments"))).toBe(false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("serve migrate without a DSN exits 1 and names the PostgreSQL env requirement", async () => {
    const home = scratchHome();
    try {
      const result = await runEntry(SERVE_ENTRY, ["migrate"], home);
      expect(result.timedOut).toBe(false);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("[attachments-serve] fatal:");
      expect(result.stderr).toContain("server PostgreSQL configuration");
      expect(existsSync(join(home, ".hasna", "attachments"))).toBe(false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
