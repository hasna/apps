import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

setDefaultTimeout(120_000);

const ROOT = join(import.meta.dir, "..", "..");
const tempRoots: string[] = [];

afterEach(() => {
  for (const tempRoot of tempRoots.splice(0)) {
    if (existsSync(tempRoot)) rmSync(tempRoot, { recursive: true, force: true });
  }
});

// The spawned CLI must be hermetic: no inherited fleet API env (other apps'
// URLs must not leak), a HOME the test owns (nothing may touch the developer's
// real ~/.hasna or ~/Library/Application Support/Hasna), and BOTH local
// opt-in variables explicitly blanked so an ambient HASNA_TODOS_LOCAL in the
// developer's shell cannot turn the fail-closed run green.
function hermeticEnv(tempRoot: string): Record<string, string> {
  const env: Record<string, string> = {
    HOME: tempRoot,
    PATH: process.env["PATH"] ?? "",
    HASNA_TODOS_API_URL: "",
    HASNA_TODOS_API_KEY: "",
    TODOS_API_URL: "",
    TODOS_API_KEY: "",
    HASNA_TODOS_LOCAL: "",
    TODOS_LOCAL: "",
  };
  // Strip the ambient fleet env of every other HASNA_*/<APP>_API_* pair.
  for (const key of Object.keys(process.env)) {
    if (/^(?:HASNA_[A-Z0-9_]+_API_(?:URL|KEY)|[A-Z0-9]+_API_(?:URL|KEY))$/.test(key)) {
      env[key] = "";
    }
  }
  return env;
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

describe("fail-closed transport resolution", () => {
  // Owner ruling (2026-09-04, hasna/apps#1613): running WITHOUT the fleet API
  // env prefix (HASNA_TODOS_API_URL + HASNA_TODOS_API_KEY) must fail closed —
  // non-zero exit, an actionable error naming the required env, and NO local
  // database created anywhere under the owning HOME. The legacy response to
  // the 715712 incident (a `todos-local-fallback` stderr notice at rc 0) is
  // gone: the run must not succeed against the on-box store at all.
  test("doctor exits non-zero with an actionable error and creates no local database when the API env is absent", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "todos-fail-closed-"));
    tempRoots.push(tempRoot);
    const env = hermeticEnv(tempRoot);

    const result = await runCli(["doctor"], env);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("HASNA_TODOS_API_URL");
    expect(result.stderr).toContain("HASNA_TODOS_API_KEY");
    expect(result.stderr).toContain("HASNA_TODOS_LOCAL=1");
    expect(result.stderr).toMatch(/fail\w*\s*closed/i);
    // The seam throws before any SQLite open can run: no database file may
    // exist anywhere under the owning HOME (the default data root resolves
    // inside it).
    expect(sqliteFilesUnder(tempRoot)).toEqual([]);
    expect(existsSync(join(tempRoot, ".hasna", "todos", "todos.db"))).toBe(false);
  });

  // Same run WITH the explicit local opt-in is legal again: the CLI serves the
  // local store and the store file is created under the owning HOME.
  test("the explicit local opt-in restores the local store for the same env", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "todos-local-opt-in-"));
    tempRoots.push(tempRoot);
    const env = hermeticEnv(tempRoot);
    env["HASNA_TODOS_LOCAL"] = "1";

    const result = await runCli(["doctor"], env);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Integrity clean");
    const localDb = join(tempRoot, ".hasna", "todos", "todos.db");
    expect(existsSync(localDb)).toBe(true);
    expect(sqliteFilesUnder(tempRoot).length).toBeGreaterThan(0);
  });

  // The alias spelling is an equally explicit opt-in.
  test("the TODOS_LOCAL alias also restores the local store", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "todos-local-opt-in-alias-"));
    tempRoots.push(tempRoot);
    const env = hermeticEnv(tempRoot);
    env["TODOS_LOCAL"] = "1";

    const result = await runCli(["doctor"], env);

    expect(result.exitCode).toBe(0);
    expect(existsSync(join(tempRoot, ".hasna", "todos", "todos.db"))).toBe(true);
  });

  // The opt-in is strict about VALUES: a blank or false-y HASNA_TODOS_LOCAL
  // is not an opt-in, so the run still fails closed.
  test("a blank HASNA_TODOS_LOCAL still fails closed", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "todos-local-blank-"));
    tempRoots.push(tempRoot);
    const env = hermeticEnv(tempRoot);

    const result = await runCli(["doctor"], env);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("HASNA_TODOS_API_URL");
    expect(existsSync(join(tempRoot, ".hasna", "todos", "todos.db"))).toBe(false);
    expect(sqliteFilesUnder(tempRoot)).toEqual([]);
  });

  // Static diagnostics are not commands that touch a store: they must keep
  // working without the API env so a misconfigured machine can still be
  // steered, but they exit non-zero nowhere — help stays at rc 0.
  test("--help still renders at rc 0 without the API env", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "todos-help-noenv-"));
    tempRoots.push(tempRoot);
    const env = hermeticEnv(tempRoot);

    const result = await runCli(["--help"], env);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Usage:");
    expect(sqliteFilesUnder(tempRoot)).toEqual([]);
  });
});
