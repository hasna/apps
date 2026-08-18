import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { getDefaultDbPath, migrateLegacyDb, resolveDbPath } from "../src/paths";
import { SQLiteStorage } from "../src/storage";

const ENV_KEYS = ["HOME", "USERPROFILE", "COMPUTERS_DB"] as const;

let saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};
let tempHome: string | null = null;
const cleanups: string[] = [];

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = saved[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  saved = {};
  if (tempHome) {
    rmSync(tempHome, { recursive: true, force: true });
    tempHome = null;
  }
  for (const path of cleanups.splice(0)) rmSync(path, { recursive: true, force: true });
});

function isolateHome(): string {
  for (const key of ENV_KEYS) saved[key] = process.env[key];
  tempHome = mkdtempSync(join(tmpdir(), "computers-home-test-"));
  process.env.HOME = tempHome;
  delete process.env.USERPROFILE;
  delete process.env.COMPUTERS_DB;
  return tempHome;
}

/** A realistic legacy database: created by a previous run of this app with the app's own schema. */
function makeLegacyDb(cwd: string): string {
  mkdirSync(cwd, { recursive: true });
  const path = join(cwd, "computers.db");
  const storage = new SQLiteStorage(path);
  storage.migrate();
  storage.close();
  return path;
}

const APP_DIR = join(import.meta.dir, "..");

async function runBin(name: string, args: string[], cwd: string, env: Record<string, string>): Promise<{ code: number; stdout: string; stderr: string }> {
  const entry = join(APP_DIR, "src", "bin", name);
  const proc = Bun.spawn(["bun", entry, ...args], { cwd, stdout: "pipe", stderr: "pipe", env: { ...Bun.env, ...env } });
  const [code, stdout, stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return { code, stdout, stderr };
}

describe("canonical database root", () => {
  test("getDefaultDbPath resolves to ~/.hasna/computers/computers.db", () => {
    const home = isolateHome();
    expect(getDefaultDbPath()).toBe(join(home, ".hasna", "computers", "computers.db"));
  });

  test("resolveDbPath with no override returns the canonical default", () => {
    const home = isolateHome();
    expect(resolveDbPath(undefined)).toBe(join(home, ".hasna", "computers", "computers.db"));
  });

  test("default never contains a literal ~ or undefined prefix when HOME is unset", () => {
    isolateHome();
    delete process.env.HOME;
    delete process.env.USERPROFILE;
    const path = getDefaultDbPath();
    expect(path.startsWith("~")).toBe(false);
    expect(path.startsWith("undefined")).toBe(false);
    expect(path).toContain(".hasna/computers");
  });

  test("explicit paths win and do not migrate", () => {
    const home = isolateHome();
    const cwd = mkdtempSync(join(tmpdir(), "computers-explicit-cwd-")); cleanups.push(cwd);
    const legacy = makeLegacyDb(cwd);
    const explicit = join(cwd, "explicit.db");
    expect(resolveDbPath(explicit, cwd)).toBe(explicit);
    expect(existsSync(legacy)).toBe(true); // legacy untouched
    expect(existsSync(join(home, ".hasna", "computers"))).toBe(false); // no migration fired
  });

  test(":memory: passes through unchanged", () => {
    isolateHome();
    expect(resolveDbPath(":memory:")).toBe(":memory:");
  });

  test("migration copies a cwd-relative ./computers.db into the canonical root and records a receipt", () => {
    const home = isolateHome();
    const cwd = mkdtempSync(join(tmpdir(), "computers-migrate-cwd-")); cleanups.push(cwd);
    const legacy = makeLegacyDb(cwd);

    const receipt = migrateLegacyDb(cwd);

    const target = join(home, ".hasna", "computers", "computers.db");
    expect(receipt).toEqual({ migrated: true, from: legacy, to: target });
    expect(existsSync(target)).toBe(true);
    expect(existsSync(legacy)).toBe(true); // never delete the original
    expect(readFileSync(target)).toEqual(readFileSync(legacy)); // copy verified byte-for-byte
    const receiptFile = JSON.parse(readFileSync(join(dirname(target), "migration-receipt.json"), "utf8")) as { from: string; to: string };
    expect(receiptFile).toMatchObject({ from: legacy, to: target });
  });

  test("migration is idempotent and resumable", () => {
    const home = isolateHome();
    const cwd = mkdtempSync(join(tmpdir(), "computers-migrate-cwd2-")); cleanups.push(cwd);
    const legacy = makeLegacyDb(cwd);

    const first = migrateLegacyDb(cwd);
    expect(first.migrated).toBe(true);
    const target = join(home, ".hasna", "computers", "computers.db");
    const receiptPath = join(dirname(target), "migration-receipt.json");
    const firstReceipt = readFileSync(receiptPath, "utf8");

    const second = migrateLegacyDb(cwd);
    expect(second).toEqual({ migrated: false, reason: "canonical-data-exists" });
    expect(readFileSync(receiptPath, "utf8")).toBe(firstReceipt); // receipt not rewritten
    expect(readFileSync(target)).toEqual(readFileSync(legacy)); // data untouched
  });

  test("migration never overwrites existing canonical data", () => {
    const home = isolateHome();
    const cwd = mkdtempSync(join(tmpdir(), "computers-migrate-cwd3-")); cleanups.push(cwd);
    const legacy = makeLegacyDb(cwd);
    const target = join(home, ".hasna", "computers", "computers.db");
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, "existing-canonical-data");

    const receipt = migrateLegacyDb(cwd);

    expect(receipt).toEqual({ migrated: false, reason: "canonical-data-exists" });
    expect(readFileSync(target, "utf8")).toBe("existing-canonical-data");
    expect(existsSync(legacy)).toBe(true);
  });

  test("no legacy data means no migration", () => {
    isolateHome();
    const cwd = mkdtempSync(join(tmpdir(), "computers-nolegacy-cwd-")); cleanups.push(cwd);
    const receipt = migrateLegacyDb(cwd);
    expect(receipt).toEqual({ migrated: false, reason: "no-legacy-data" });
  });

  test("cli bin resolves the canonical default under a fake HOME with no override", async () => {
    const home = isolateHome();
    const cwd = mkdtempSync(join(tmpdir(), "computers-bin-cwd-")); cleanups.push(cwd);
    const result = await runBin("computers.ts", ["doctor"], cwd, { HOME: home });
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    const payload = JSON.parse(result.stdout) as { database: string };
    expect(payload.database).toBe(join(home, ".hasna", "computers", "computers.db"));
  });

  test("cli bin honors COMPUTERS_DB over the canonical default", async () => {
    const home = isolateHome();
    const cwd = mkdtempSync(join(tmpdir(), "computers-bin-cwd2-")); cleanups.push(cwd);
    const explicit = join(cwd, "override.db");
    const result = await runBin("computers.ts", ["doctor"], cwd, { HOME: home, COMPUTERS_DB: explicit });
    expect(result.code).toBe(0);
    const payload = JSON.parse(result.stdout) as { database: string };
    expect(payload.database).toBe(explicit);
  });

  test("migrate bin migrates a cwd-relative legacy database into the canonical root", async () => {
    const home = isolateHome();
    const cwd = mkdtempSync(join(tmpdir(), "computers-bin-migrate-cwd-")); cleanups.push(cwd);
    const legacy = makeLegacyDb(cwd);

    const result = await runBin("computers-migrate.ts", [], cwd, { HOME: home });

    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    const target = join(home, ".hasna", "computers", "computers.db");
    const payload = JSON.parse(result.stdout) as { migrated: boolean; database: string };
    expect(payload.database).toBe(target);
    expect(payload.migrated).toBe(true);
    expect(existsSync(target)).toBe(true);
    expect(existsSync(legacy)).toBe(true); // original preserved
    const db = new Database(target, { readonly: true });
    try {
      const version = db.query("SELECT MAX(version) AS version FROM schema_migrations").get() as { version: number };
      expect(version.version).toBe(4); // the legacy database's schema travelled with it
    } finally {
      db.close();
    }
  });

  test("worker bin resolves the canonical default under a fake HOME", async () => {
    const home = isolateHome();
    const cwd = mkdtempSync(join(tmpdir(), "computers-bin-cwd3-")); cleanups.push(cwd);
    const worker = await runBin("computers-worker.ts", [], cwd, { HOME: home, COMPUTERS_TENANT: "tenant_local" });
    expect(worker.code).toBe(0);
    expect(worker.stderr).toBe("");
    expect(existsSync(join(home, ".hasna", "computers", "computers.db"))).toBe(true);
  });
});
