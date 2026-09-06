// Fail-closed coverage for the spawned CLI (owner ruling 2026-09-04,
// hasna/apps#1720, #1613).
//
// A hosted conversations run with NO resolvable credential must exit non-zero,
// create no SQLite file anywhere under the owning HOME, and emit no
// `*-local-fallback` event. The on-box SQLite store is reachable ONLY through
// the explicit opt-in `HASNA_CONVERSATIONS_DB_PATH` / `CONVERSATIONS_DB_PATH`,
// and a local run must say "local" on stderr — an unhosted CLI that says
// nothing looks exactly like a hosted one whose store happens to be empty.
//
// The child environment is built by OMISSION: a sandbox HOME the test owns
// (which also anchors the disk credential tier, `$HOME/.hasna/conversations/
// config/credentials`), a HASNA_STATION no real item uses (so the machine's
// Keychain can never answer), and nothing else copied in — so no ambient fleet
// env can reach the child.

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..", "..");
const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
});

function hermeticEnv(tempRoot: string): Record<string, string> {
  return {
    HOME: tempRoot,
    PATH: process.env["PATH"] ?? "",
    // No real Keychain item uses this account, so a login-keychain item (on a
    // Mac runner) can never answer for this run.
    HASNA_STATION: "conversations-fail-closed-no-such-station",
  };
}

async function runCli(
  args: string[],
  env: Record<string, string>,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", "run", "src/cli/index.tsx", ...args], {
    cwd: ROOT,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}

/** Recursively list every *.db / *.sqlite / *.sqlite3 file under a root. */
function sqliteFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sqliteFilesUnder(full));
    else if (/\.(?:db|sqlite3?)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe("fail-closed transport resolution (spawned CLI)", () => {
  test("hosted with no credential exits non-zero, names the required vars, and creates no SQLite", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "conversations-fail-closed-"));
    tempRoots.push(tempRoot);
    const env = hermeticEnv(tempRoot);

    const result = await runCli(["status"], env);

    expect(result.exitCode).not.toBe(0);
    // The refusal names the canonical API variables (the tiers to fix).
    expect(result.stderr).toContain("HASNA_CONVERSATIONS_API_URL");
    expect(result.stderr).toContain("HASNA_CONVERSATIONS_API_KEY");
    // ...and the explicit local opt-in (the only way local is reachable).
    expect(result.stderr).toContain("HASNA_CONVERSATIONS_DB_PATH");
    // The seam throws before any SQLite open can run: no database file may
    // exist anywhere under the owning HOME.
    expect(sqliteFilesUnder(tempRoot)).toEqual([]);
    expect(existsSync(join(tempRoot, ".hasna", "conversations"))).toBe(false);
  });

  test("under --json the refusal honours the JSON error contract on stdout", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "conversations-fail-closed-json-"));
    tempRoots.push(tempRoot);
    const env = hermeticEnv(tempRoot);

    const result = await runCli(["status", "--json"], env);

    expect(result.exitCode).not.toBe(0);
    const parsed = JSON.parse(result.stdout.trim());
    expect(parsed.error).toContain("HASNA_CONVERSATIONS_API_URL");
    expect(parsed.code).toBe("CONVERSATIONS_STORE_CONFIG");
  });

  test("no *-local-fallback event is emitted — the legacy silent degradation is gone", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "conversations-fail-closed-"));
    tempRoots.push(tempRoot);
    const env = hermeticEnv(tempRoot);

    const result = await runCli(["status"], env);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).not.toMatch(/-local-fallback/i);
    expect(result.stderr).not.toMatch(/falling?\s*back/i);
  });

  test("the explicit local opt-in restores the local store, and says 'local' on stderr", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "conversations-local-opt-in-"));
    tempRoots.push(tempRoot);
    const env = hermeticEnv(tempRoot);
    env["HASNA_CONVERSATIONS_DB_PATH"] = join(tempRoot, "store.db");

    const result = await runCli(["status"], env);

    expect(result.exitCode).toBe(0);
    // The local-mode notice: a local run must never be mistakable for a hosted
    // one with an empty store.
    expect(result.stderr).toContain("LOCAL mode");
    expect(result.stdout).toContain("Connection: SQLite");
    const localDb = join(tempRoot, "store.db");
    expect(existsSync(localDb)).toBe(true);
    expect(sqliteFilesUnder(tempRoot).length).toBeGreaterThan(0);
  });

  test("the unprefixed local opt-in alias also restores the local store", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "conversations-local-opt-in-alias-"));
    tempRoots.push(tempRoot);
    const env = hermeticEnv(tempRoot);
    env["CONVERSATIONS_DB_PATH"] = join(tempRoot, "store.db");

    const result = await runCli(["status"], env);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain("LOCAL mode");
    expect(result.stdout).toContain("Connection: SQLite");
  });
});
