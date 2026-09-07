import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pkg from "../../package.json";
import { hermeticChildEnv } from "../../tests/support/hermetic-store-env.js";

/**
 * `telephony-serve` entrypoint probes (hasna/apps#1720 validation).
 *
 * `--help` and `--version` must be answered before the serve opens anything —
 * no PostgreSQL pool, no port, no store — and a real start without
 * HASNA_TELEPHONY_DATABASE_URL must still fail closed: non-zero exit, an error
 * naming the URL, and no SQLite under the scratch home (the server never
 * serves SQLite). These spawn the real entrypoint as a subprocess, the only
 * way to assert exit codes and filesystem side effects, under a scrubbed env
 * and a scratch HOME.
 */

const APP_ROOT = new URL("../../", import.meta.url).pathname; // apps/telephony/
const SERVE_ENTRY = new URL("./cloud-entry.ts", import.meta.url).pathname; // src/server/cloud-entry.ts

/** Strip every variable the serve or the store resolver could read from the operator's shell. */
function scrubEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (name.includes("TELEPHONY")) continue; // HASNA_TELEPHONY_* and TELEPHONY_* (incl. DATABASE_URL)
    if (name === "PORT" || name === "HOST") continue;
    if (name === "API_KEY_SIGNING_SECRET" || name === "HASNA_API_SIGNING_KEY") continue;
    if (/^HASNA_(DATA|STATE|CONFIG|CACHE)_HOME$/.test(name)) continue;
    if (name === "HASNA_HOME" || name === "HASNA_CONFIG_HOME") continue;
    if (name === "HASNA_STATION" || name === "HASNA_PROFILE") continue;
    env[name] = value;
  }
  return env;
}

type ProbeResult = { code: number; stdout: string; stderr: string; timedOut: boolean };

async function runServe(args: string[], home: string, extra: Record<string, string> = {}): Promise<ProbeResult> {
  const proc = Bun.spawn([process.execPath, "run", SERVE_ENTRY, ...args], {
    cwd: APP_ROOT,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...scrubEnv(), ...hermeticChildEnv(home), ...extra },
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
  return mkdtempSync(join(tmpdir(), "telephony-serve-entry-"));
}

/** Every `*.db*` file under a root, recursively — the server must never create one. */
function sqliteFilesUnder(root: string): string[] {
  if (!existsSync(root)) return [];
  const found: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && /\.db(-wal|-shm|-journal)?$/.test(entry.name)) found.push(join(entry.parentPath ?? root, entry.name));
  }
  return found;
}

describe("telephony-serve answers --help and --version before starting", () => {
  test("--help prints usage naming the required environment and exits 0 without a database URL", async () => {
    const home = scratchHome();
    try {
      const result = await runServe(["--help"], home);
      expect(result.timedOut).toBe(false);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("Usage: telephony-serve");
      expect(result.stdout).toContain("HASNA_TELEPHONY_DATABASE_URL");
      expect(result.stdout).toContain("HASNA_TELEPHONY_API_SIGNING_KEY");
      expect(result.stdout).toContain("PORT");
      // Help never starts the server: no failure line, no listening line.
      expect(result.stderr).not.toContain("failed to start");
      expect(result.stdout).not.toContain("listening on");
      expect(sqliteFilesUnder(home)).toEqual([]);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("--version / -V print the package version and exit 0 without a database URL", async () => {
    const home = scratchHome();
    try {
      for (const flag of ["--version", "-V"]) {
        const result = await runServe([flag], home);
        expect(result.timedOut).toBe(false);
        expect(result.code).toBe(0);
        expect(result.stdout.trim()).toBe(pkg.version);
        expect(result.stderr).not.toContain("failed to start");
      }
      expect(sqliteFilesUnder(home)).toEqual([]);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("telephony-serve fails closed without a PostgreSQL database URL", () => {
  test("a real start exits non-zero naming HASNA_TELEPHONY_DATABASE_URL and never opens SQLite", async () => {
    const home = scratchHome();
    try {
      const result = await runServe([], home, { HASNA_TELEPHONY_API_SIGNING_KEY: "probe-only-signing-secret" });
      expect(result.timedOut).toBe(false);
      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain("failed to start");
      expect(result.stderr).toContain("HASNA_TELEPHONY_DATABASE_URL");
      expect(result.stdout).not.toContain("listening on");
      expect(sqliteFilesUnder(home)).toEqual([]);
      expect(existsSync(join(home, ".hasna", "telephony"))).toBe(false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
