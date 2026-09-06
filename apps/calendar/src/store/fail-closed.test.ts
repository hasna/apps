/**
 * Fail-closed transport tests for the calendar CLI (owner ruling 2026-09-04,
 * hasna/apps#1720 — checklist item 3 and 6).
 *
 * A hosted run with NO credential — none in the env, none on disk, none in the
 * (empty, pinned) Keychain — must exit non-zero with an actionable error, and
 * must create NO local database anywhere under the owning HOME. The legacy
 * response to the 715712 incident class (a silent rc-0 local read) does not
 * exist on this client. The only local surface left is the explicit legacy
 * `db-migrate` command, which is LOCAL-ONLY, refuses on any hosted intent, and
 * says "local" on stderr.
 *
 * The spawned CLI is hermetic: HOME is a scratch dir the test owns, the
 * Keychain account is pinned to a name no item can exist under, the hasna home
 * points at a path that exists nowhere, and no resolver env is copied in at
 * all (the env is built by OMISSION: a declared-but-blank credential is a
 * LOUDER failure than an absent one, so tests want the absent shape).
 */
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TEST_KEYCHAIN_ACCOUNT, TEST_HASNA_HOME } from "../test/env-isolation.preload.js";

setDefaultTimeout(120_000);

const ROOT = join(import.meta.dir, "..", "..");
const tempRoots: string[] = [];

afterEach(() => {
  for (const tempRoot of tempRoots.splice(0)) {
    if (existsSync(tempRoot)) rmSync(tempRoot, { recursive: true, force: true });
  }
});

function hermeticEnv(tempRoot: string): Record<string, string> {
  return {
    HOME: tempRoot,
    PATH: process.env["PATH"] ?? "",
    // The Keychain tier is ambient for the spawned process, and no env
    // dictionary can blank a login-keychain item. Pinning the account to a
    // name no item uses — and pointing the disk root at a path that exists
    // nowhere — is what keeps the machine's real credential out of a run
    // whose whole point is that nothing resolves.
    HASNA_STATION: TEST_KEYCHAIN_ACCOUNT,
    HASNA_HOME: TEST_HASNA_HOME,
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
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sqliteFilesUnder(full));
    else if (/\.(?:db|sqlite3?)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe("fail-closed transport resolution (hosted, no credential)", () => {
  test("a store-backed command exits non-zero, names the required env, and creates no database", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "calendar-fail-closed-"));
    tempRoots.push(tempRoot);

    const result = await runCli(["org-list"], hermeticEnv(tempRoot));

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr + result.stdout).toContain("HASNA_CALENDAR_API_URL");
    // The fail-loud wording: no silent local read, and no *-local-fallback
    // event (the hyphenated legacy notice form is gone entirely).
    expect(result.stderr + result.stdout).toMatch(/no local fallback/i);
    expect(result.stderr + result.stdout).not.toMatch(/local-fallback/);
    // No SQLite anywhere under the owning HOME; the migration root is not
    // created either.
    expect(sqliteFilesUnder(tempRoot)).toEqual([]);
    expect(existsSync(join(tempRoot, ".hasna"))).toBe(false);
    expect(existsSync(join(tempRoot, ".calendar"))).toBe(false);
  });

  test("--json mode reports the same refusal parseably with a non-zero exit", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "calendar-fail-closed-json-"));
    tempRoots.push(tempRoot);

    const result = await runCli(["--json", "org-list"], hermeticEnv(tempRoot));

    expect(result.exitCode).not.toBe(0);
    const payload = JSON.parse(result.stdout) as { error: string };
    expect(payload.error).toContain("HASNA_CALENDAR_API_URL is required");
    expect(sqliteFilesUnder(tempRoot)).toEqual([]);
  });

  test("a URL without a key fails closed naming the missing key", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "calendar-fail-closed-urlonly-"));
    tempRoots.push(tempRoot);

    const result = await runCli(
      ["org-list"],
      { ...hermeticEnv(tempRoot), HASNA_CALENDAR_API_URL: "https://calendar.example.test" },
    );

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr + result.stdout).toContain("HASNA_CALENDAR_API_KEY is required");
    expect(sqliteFilesUnder(tempRoot)).toEqual([]);
  });

  test("a retired placement selector is refused loudly", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "calendar-fail-closed-retired-"));
    tempRoots.push(tempRoot);

    const result = await runCli(
      ["org-list"],
      { ...hermeticEnv(tempRoot), HASNA_CALENDAR_MODE: "local" },
    );

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr + result.stdout).toMatch(/retired Calendar placement selector|HASNA_CALENDAR_MODE/);
    expect(sqliteFilesUnder(tempRoot)).toEqual([]);
  });

  test("status stays a diagnostic at rc 0, reporting unconfigured", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "calendar-fail-closed-status-"));
    tempRoots.push(tempRoot);

    const result = await runCli(["--json", "status"], hermeticEnv(tempRoot));

    expect(result.exitCode).toBe(0);
    const report = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(report.transport).toBe("unconfigured");
    expect(sqliteFilesUnder(tempRoot)).toEqual([]);
  });

  test("the explicit local surface (db-migrate --dry-run) says LOCAL on stderr and writes nothing", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "calendar-fail-closed-local-"));
    tempRoots.push(tempRoot);

    const result = await runCli(["db-migrate", "--dry-run"], hermeticEnv(tempRoot));

    // Local is only reachable by the explicit command, and it must say so.
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toMatch(/local/i);
    expect(result.stderr).toMatch(/LOCAL mode/i);
    // Dry-run creates no database.
    expect(sqliteFilesUnder(tempRoot)).toEqual([]);
  });
});