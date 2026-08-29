import { afterEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { tmpdir } from "os";
import { copyContextDatabase, getDataDir, getDatabase, getDbPath, resetDatabase } from "./database.js";

const oldEnv = new Map<string, string | undefined>();
const ENV_NAMES = [
  "HOME",
  "USERPROFILE",
  "HASNA_DATA_HOME",
  "CONTEXT_DB_PATH",
  "HASNA_CONTEXT_DB_PATH",
  "CONTEXT_DATA_DIR",
  "HASNA_CONTEXT_DATA_DIR",
] as const;

let tempRoot: string | null = null;
let oldCwd = process.cwd();

afterEach(() => {
  resetDatabase();
  process.chdir(oldCwd);
  for (const name of ENV_NAMES) {
    if (!oldEnv.has(name)) continue;
    const value = oldEnv.get(name);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  oldEnv.clear();
  if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
  tempRoot = null;
});

/** A realistic legacy database: a valid SQLite file with data. */
function makeContextDb(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.exec("CREATE TABLE IF NOT EXISTS legacy_probe (value TEXT)");
  db.query("INSERT INTO legacy_probe (value) VALUES ('legacy-data')").run();
  db.close();
}

describe("database path resolution", () => {
  it("resolves the canonical context data path without creating it until the database opens", () => {
    const root = isolateHome();
    const expected = join(root, "home", ".hasna", "context", "context.db");

    expect(getDbPath()).toBe(expected);
    expect(existsSync(dirname(expected))).toBe(false);

    const db = getDatabase();
    expect(db).toBeDefined();
    expect(existsSync(dirname(expected))).toBe(true);
  });

  it("migrates context data from the legacy ~/.hasna/apps/knowledge store into the canonical root", () => {
    const root = isolateHome();
    const legacyDir = join(root, "home", ".hasna", "apps", "knowledge");
    mkdirSync(legacyDir, { recursive: true });
    makeContextDb(join(legacyDir, "context.db"));
    writeFileSync(join(legacyDir, "notes.md"), "knowledge-owned file");
    writeFileSync(join(legacyDir, "knowledge.db"), "knowledge-owned database");

    const dataDir = getDataDir();
    const canonical = join(root, "home", ".hasna", "context");

    expect(dataDir).toBe(canonical);
    expect(existsSync(join(canonical, "context.db"))).toBe(true);
    // Only context-owned files travel; knowledge-owned files stay behind.
    expect(existsSync(join(canonical, "notes.md"))).toBe(false);
    expect(existsSync(join(canonical, "knowledge.db"))).toBe(false);
    expect(existsSync(join(legacyDir, "context.db"))).toBe(true); // original preserved
    const receipt = JSON.parse(readFileSync(join(canonical, "migration-receipt.json"), "utf8")) as { from: string; to: string };
    expect(receipt).toMatchObject({ from: legacyDir, to: canonical });
  });

  it("migrates the older ~/.context legacy store when the wrong default has no context data", () => {
    const root = isolateHome();
    const legacyDir = join(root, "home", ".context");
    mkdirSync(legacyDir, { recursive: true });
    makeContextDb(join(legacyDir, "context.db"));

    const dataDir = getDataDir();

    expect(dataDir).toBe(join(root, "home", ".hasna", "context"));
    expect(existsSync(join(dataDir, "context.db"))).toBe(true);
    expect(existsSync(join(dataDir, "migration-receipt.json"))).toBe(true);
  });

  it("migrates the pre-XDG ~/.hasna/context store when HASNA_DATA_HOME adopts the XDG home", () => {
    const root = isolateHome();
    const legacyDir = join(root, "home", ".hasna", "context");
    mkdirSync(legacyDir, { recursive: true });
    makeContextDb(join(legacyDir, "context.db"));

    // The operator deliberately opts into the XDG data home. The legacy
    // ~/.hasna/context store must travel into the effective home — otherwise
    // the upgrade opens an empty database and existing data is invisible.
    const xdgRoot = join(root, "xdg-data");
    process.env.HASNA_DATA_HOME = xdgRoot;

    const dataDir = getDataDir();
    const xdgHome = join(xdgRoot, "context");

    expect(dataDir).toBe(xdgHome);
    expect(existsSync(join(xdgHome, "context.db"))).toBe(true);
    // Original legacy store preserved, never deleted.
    expect(existsSync(join(legacyDir, "context.db"))).toBe(true);
    const receipt = JSON.parse(readFileSync(join(xdgHome, "migration-receipt.json"), "utf8")) as { from: string; to: string };
    expect(receipt).toMatchObject({ from: legacyDir, to: xdgHome });
  });

  it("snapshots a live WAL-mode legacy store atomically, including uncheckpointed rows", () => {
    const root = isolateHome();
    const legacyDir = join(root, "home", ".hasna", "context");
    mkdirSync(legacyDir, { recursive: true });

    // A WAL-mode source with the writer still open: the committed row lives
    // in the uncheckpointed WAL, not in the main database file. The migration
    // must snapshot the committed state atomically (VACUUM INTO) — a naive
    // copy of the main file plus sidecars could miss this row entirely.
    const source = join(legacyDir, "context.db");
    const writer = new Database(source);
    writer.exec("PRAGMA journal_mode = WAL");
    writer.exec("CREATE TABLE IF NOT EXISTS legacy_probe (value TEXT)");
    writer.query("INSERT INTO legacy_probe (value) VALUES ('wal-committed-row')").run();

    const xdgRoot = join(root, "xdg-data");
    process.env.HASNA_DATA_HOME = xdgRoot;

    const dataDir = getDataDir();
    const xdgHome = join(xdgRoot, "context");

    expect(dataDir).toBe(xdgHome);
    expect(existsSync(join(xdgHome, "context.db"))).toBe(true);
    // The snapshot is a single self-contained file: no sidecar copies.
    expect(existsSync(join(xdgHome, "context.db-wal"))).toBe(false);
    expect(existsSync(join(xdgHome, "context.db-shm"))).toBe(false);
    const probe = new Database(join(xdgHome, "context.db"));
    try {
      const row = probe.query("SELECT value FROM legacy_probe WHERE value = 'wal-committed-row'").get();
      expect(row).toEqual({ value: "wal-committed-row" });
      const integrity = probe.query("PRAGMA integrity_check").get() as { integrity_check: string };
      expect(integrity.integrity_check).toBe("ok");
    } finally {
      probe.close();
    }
    // Original legacy store preserved with its WAL.
    writer.close();
    expect(existsSync(source)).toBe(true);
  });

  it("never deletes or replaces a snapshot another migration already placed (concurrent first-use race)", () => {
    const root = isolateHome();
    const legacyDir = join(root, "home", ".hasna", "context");
    mkdirSync(legacyDir, { recursive: true });
    const source = join(legacyDir, "context.db");
    makeContextDb(source);

    // Process B already placed its verified snapshot at the canonical path
    // while process A was still snapshotting (a CLI and the -serve process
    // upgrading at the same moment). A's migration must not unlink or
    // overwrite B's placed snapshot — the old remove-a-stale-target-first
    // logic could delete a live snapshot, after which the verification open
    // created an empty database that passed integrity_check and became
    // canonical, leaving committed legacy rows invisible (release-review P1).
    const canonicalDir = join(root, "home", ".hasna", "context-canonical");
    mkdirSync(canonicalDir, { recursive: true });
    const target = join(canonicalDir, "context.db");
    const bSnapshot = new Database(target);
    bSnapshot.exec("CREATE TABLE legacy_probe (value TEXT)");
    bSnapshot.query("INSERT INTO legacy_probe (value) VALUES ('b-snapshot-won')").run();
    bSnapshot.close();

    expect(copyContextDatabase(source, target)).toBe(true);

    // B's verified snapshot is untouched: its distinguishing row survives
    // and integrity still holds. (Same legacy source, same committed rows —
    // the discriminator proves no replacement happened.)
    const probe = new Database(target);
    try {
      expect(probe.query("SELECT value FROM legacy_probe WHERE value = 'b-snapshot-won'").get()).toEqual({ value: "b-snapshot-won" });
      const integrity = probe.query("PRAGMA integrity_check").get() as { integrity_check: string };
      expect(integrity.integrity_check).toBe("ok");
    } finally {
      probe.close();
    }
    // No stray snapshot temp is left behind by the losing attempt.
    expect(readdirSync(canonicalDir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  it("concurrent first-use migrations converge on one verified canonical snapshot", () => {
    const root = isolateHome();
    const legacyDir = join(root, "home", ".hasna", "context");
    mkdirSync(legacyDir, { recursive: true });
    const source = join(legacyDir, "context.db");
    // A WAL-mode source with the writer still open and an uncheckpointed
    // committed row: both migration attempts must snapshot the committed
    // state, and the loser of the placement race must never touch the
    // winner's placed snapshot.
    const writer = new Database(source);
    writer.exec("PRAGMA journal_mode = WAL");
    writer.exec("CREATE TABLE legacy_probe (value TEXT)");
    writer.query("INSERT INTO legacy_probe (value) VALUES ('wal-committed-row')").run();

    const canonicalDir = join(root, "home", ".hasna", "context-canonical");
    mkdirSync(canonicalDir, { recursive: true });
    const target = join(canonicalDir, "context.db");

    // The loser arrives second; the canonical path must still hold a
    // verified snapshot of the same legacy source.
    expect(copyContextDatabase(source, target)).toBe(true);
    expect(copyContextDatabase(source, target)).toBe(true);

    const probe = new Database(target);
    try {
      expect(probe.query("SELECT value FROM legacy_probe WHERE value = 'wal-committed-row'").get()).toEqual({ value: "wal-committed-row" });
      const integrity = probe.query("PRAGMA integrity_check").get() as { integrity_check: string };
      expect(integrity.integrity_check).toBe("ok");
    } finally {
      probe.close();
    }
    writer.close();
    expect(readdirSync(canonicalDir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  it("migration is idempotent and does not rewrite the receipt or the data", () => {
    const root = isolateHome();
    const legacyDir = join(root, "home", ".hasna", "apps", "knowledge");
    mkdirSync(legacyDir, { recursive: true });
    makeContextDb(join(legacyDir, "context.db"));

    getDataDir();
    const canonical = join(root, "home", ".hasna", "context");
    const receiptPath = join(canonical, "migration-receipt.json");
    const firstReceipt = readFileSync(receiptPath, "utf8");
    const migrated = readFileSync(join(canonical, "context.db"));

    getDataDir();

    expect(readFileSync(receiptPath, "utf8")).toBe(firstReceipt);
    expect(readFileSync(join(canonical, "context.db"))).toEqual(migrated);
  });

  it("migration never overwrites existing canonical data", () => {
    const root = isolateHome();
    const legacyDir = join(root, "home", ".hasna", "apps", "knowledge");
    mkdirSync(legacyDir, { recursive: true });
    makeContextDb(join(legacyDir, "context.db"));
    const canonical = join(root, "home", ".hasna", "context");
    mkdirSync(canonical, { recursive: true });
    writeFileSync(join(canonical, "context.db"), "existing-canonical-data");

    const dataDir = getDataDir();

    expect(dataDir).toBe(canonical);
    expect(readFileSync(join(canonical, "context.db"), "utf8")).toBe("existing-canonical-data");
    expect(existsSync(join(legacyDir, "context.db"))).toBe(true);
  });

  it("does not select a repo-local knowledge.db owned by another knowledge schema", () => {
    const root = isolateHome();
    const otherDbDir = join(root, ".hasna", "apps", "knowledge");
    mkdirSync(otherDbDir, { recursive: true });
    writeFileSync(join(otherDbDir, "knowledge.db"), "not a context database");

    expect(getDbPath()).toBe(join(root, "home", ".hasna", "context", "context.db"));
  });

  it("still selects a repo-local canonical context store", () => {
    const root = isolateHome();
    const localDir = join(root, ".hasna", "context");
    mkdirSync(localDir, { recursive: true });
    makeContextDb(join(localDir, "context.db"));

    expect(getDbPath()).toBe(join(root, ".hasna", "context", "context.db"));
  });

  it("env overrides still win over the canonical default", () => {
    const root = isolateHome();
    process.env.HASNA_CONTEXT_DATA_DIR = join(root, "override-data");
    expect(getDataDir()).toBe(join(root, "override-data"));
    process.env.CONTEXT_DB_PATH = join(root, "override.db");
    expect(getDbPath()).toBe(join(root, "override.db"));
  });

  it("default never contains a literal ~ or undefined prefix when HOME is unset", () => {
    const root = isolateHome();
    // Pin the data-kind override so the fallback home cannot leak real
    // machine state into the assertion: on a machine with an existing store
    // at the XDG data home the resolver is legitimately adopted and the
    // legacy ".hasna/context" shape no longer appears. The property under
    // test is the path hygiene, not the legacy-vs-XDG selection.
    process.env.HASNA_DATA_HOME = join(root, "xdg-data");
    delete process.env.HOME;
    delete process.env.USERPROFILE;
    const path = getDbPath();
    expect(path.startsWith("~")).toBe(false);
    expect(path.startsWith("undefined")).toBe(false);
    expect(path).toBe(join(root, "xdg-data", "context", "context.db"));
  });
});

function isolateHome(): string {
  oldCwd = process.cwd();
  for (const name of ENV_NAMES) oldEnv.set(name, process.env[name]);
  tempRoot = mkdtempSync(join(tmpdir(), "context-db-path-"));
  const home = join(tempRoot, "home");
  mkdirSync(home, { recursive: true });
  process.chdir(tempRoot);
  process.env["HOME"] = home;
  delete process.env["USERPROFILE"];
  delete process.env["CONTEXT_DB_PATH"];
  delete process.env["HASNA_CONTEXT_DB_PATH"];
  delete process.env["CONTEXT_DATA_DIR"];
  delete process.env["HASNA_CONTEXT_DATA_DIR"];
  resetDatabase();
  return tempRoot;
}
