import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Fail-closed regression probes (owner directive 2026-09-04): a fleet bin run
 * WITHOUT its API env (HASNA_TELEPHONY_API_URL / HASNA_TELEPHONY_API_KEY, or
 * the TELEPHONY_API_URL / TELEPHONY_API_KEY aliases) must exit non-zero with
 * an actionable error naming the required environment — never silently serve
 * local SQLite (~/.hasna/telephony/telephony.db), never emit a local-fallback
 * event with exit 0, never default to local mode. The on-box SQLite store is
 * reachable only through the explicit opt-in HASNA_TELEPHONY_LOCAL=1 (alias
 * TELEPHONY_LOCAL=1).
 *
 * These spawn the real entrypoints as subprocesses — the only way to assert
 * process exit codes and filesystem side effects — under a scratch HOME so any
 * accidental ~/.hasna write would land in the probe directory and be detected
 * instead of touching the operator's real home. The spawned env is scrubbed of
 * every TELEPHONY-prefixed variable and the HASNA data-home overrides a shell
 * or wrapper might export, so an ambient fleet env cannot flip these probes
 * onto the network or past the fail-closed gate.
 */

const APP_ROOT = new URL("../../", import.meta.url).pathname; // apps/telephony/
const CLI_ENTRY = new URL("./index.ts", import.meta.url).pathname; // src/cli/index.ts
const MCP_ENTRY = new URL("../mcp/index.ts", import.meta.url).pathname; // src/mcp/index.ts

/** Strip every variable this suite must not inherit (fleet env, data-home overrides). */
function scrubEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (name.includes("TELEPHONY")) continue; // HASNA_TELEPHONY_* and TELEPHONY_*
    if (/^HASNA_(DATA|STATE|CONFIG|CACHE)_HOME$/.test(name)) continue;
    env[name] = value;
  }
  return env;
}

type ProbeResult = { code: number; stdout: string; stderr: string; timedOut: boolean };

async function runEntry(
  entry: string,
  args: string[],
  home: string,
  extra: Record<string, string> = {},
): Promise<ProbeResult> {
  const proc = Bun.spawn([process.execPath, "run", entry, ...args], {
    cwd: APP_ROOT,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...scrubEnv(), HOME: home, ...extra },
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
  return mkdtempSync(join(tmpdir(), "telephony-failclosed-"));
}

describe("telephony CLI fails closed without the fleet API env", () => {
  test("a store-backed verb exits non-zero, names the required env + the local opt-in, and creates no local data dir", async () => {
    const home = scratchHome();
    try {
      const result = await runEntry(CLI_ENTRY, ["agent", "list"], home);
      expect(result.timedOut).toBe(false);
      expect(result.code).not.toBe(0);
      // Actionable error on stderr names the required env and the explicit
      // opt-in — never a false-green local fallback, never exit 0.
      expect(result.stderr).toContain("HASNA_TELEPHONY_API_URL");
      expect(result.stderr).toContain("HASNA_TELEPHONY_API_KEY");
      expect(result.stderr).toContain("HASNA_TELEPHONY_LOCAL=1");
      expect(result.stderr).toContain("fails closed");
      expect(result.stderr).not.toContain("local-fallback");
      expect(result.stdout).toBe("");
      // No run without env may open or create the local SQLite home.
      expect(existsSync(join(home, ".hasna", "telephony"))).toBe(false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("a partially configured pair (URL without key) fails closed naming the missing member", async () => {
    const home = scratchHome();
    try {
      const result = await runEntry(CLI_ENTRY, ["sms", "list"], home, {
        HASNA_TELEPHONY_API_URL: "https://telephony.invalid",
      });
      expect(result.timedOut).toBe(false);
      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain("HASNA_TELEPHONY_API_KEY");
      expect(result.stderr).toContain("only HASNA_TELEPHONY_API_URL is set");
      expect(existsSync(join(home, ".hasna", "telephony"))).toBe(false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("help and version stay available without env (control: only data verbs fail closed)", async () => {
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

describe("telephony CLI explicit local opt-in", () => {
  test("HASNA_TELEPHONY_LOCAL=1 lets a store-backed verb run locally (opt-in still works)", async () => {
    const home = scratchHome();
    try {
      const result = await runEntry(CLI_ENTRY, ["agent", "list"], home, {
        HASNA_TELEPHONY_LOCAL: "1",
      });
      expect(result.timedOut).toBe(false);
      expect(result.code).toBe(0);
      // LocalStore on the scratch data home: no agents yet, but the opt-in run
      // DID open the local database — proving local mode is reachable, and
      // only through the opt-in.
      expect(result.stdout.trim()).toBe("[]");
      expect(existsSync(join(home, ".hasna", "telephony", "telephony.db"))).toBe(true);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("telephony-mcp fails closed without the fleet API env", () => {
  test("stdio startup exits non-zero naming the required env — never serves the on-box store silently", async () => {
    const home = scratchHome();
    try {
      const result = await runEntry(MCP_ENTRY, [], home);
      expect(result.timedOut).toBe(false);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("HASNA_TELEPHONY_API_URL");
      expect(result.stderr).toContain("HASNA_TELEPHONY_LOCAL=1");
      expect(existsSync(join(home, ".hasna", "telephony"))).toBe(false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
