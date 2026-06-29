import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDataDir, getDatabase, getDbPath, resetDatabase } from "./database.js";
import { SqliteAdapter } from "./sqlite-adapter.js";

const originalHome = process.env["HOME"];
const originalUserProfile = process.env["USERPROFILE"];
const originalContactsDbPath = process.env["CONTACTS_DB_PATH"];
const originalHasnaContactsDbPath = process.env["HASNA_CONTACTS_DB_PATH"];
let tempRoot: string | null = null;

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterEach(() => {
  resetDatabase();
  restoreEnv("HOME", originalHome);
  restoreEnv("USERPROFILE", originalUserProfile);
  restoreEnv("CONTACTS_DB_PATH", originalContactsDbPath);
  restoreEnv("HASNA_CONTACTS_DB_PATH", originalHasnaContactsDbPath);
  if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
  tempRoot = null;
});

describe("contacts data directory", () => {
  it("migrates legacy ~/.contacts files into ~/.hasna/contacts", () => {
    tempRoot = mkdtempSync(join(tmpdir(), "contacts-home-"));
    const oldDir = join(tempRoot, ".contacts");
    const newDir = join(tempRoot, ".hasna", "contacts");

    mkdirSync(oldDir, { recursive: true });
    writeFileSync(join(oldDir, "contacts.db"), "legacy-db");

    process.env["HOME"] = tempRoot;
    delete process.env["USERPROFILE"];
    delete process.env["CONTACTS_DB_PATH"];
    delete process.env["HASNA_CONTACTS_DB_PATH"];
    resetDatabase();

    expect(getDataDir()).toBe(newDir);
    expect(getDbPath()).toBe(join(newDir, "contacts.db"));
    expect(existsSync(join(newDir, "contacts.db"))).toBe(true);
    expect(readFileSync(join(newDir, "contacts.db"), "utf8")).toBe("legacy-db");
  });
});

describe("contacts migrations", () => {
  it("replays migrations idempotently when migration rows are behind existing columns", () => {
    tempRoot = mkdtempSync(join(tmpdir(), "contacts-migrations-"));
    const dbPath = join(tempRoot, "contacts.db");
    process.env["CONTACTS_DB_PATH"] = dbPath;
    delete process.env["HASNA_CONTACTS_DB_PATH"];
    resetDatabase();

    const db = getDatabase();
    const latest = (db.query("SELECT MAX(version) as v FROM _migrations").get() as { v: number | null }).v;
    expect(latest).toBeGreaterThan(0);
    db.run("DELETE FROM _migrations WHERE version > 0");
    db.close();
    resetDatabase();

    const reopened = getDatabase();
    const replayed = (reopened.query("SELECT MAX(version) as v FROM _migrations").get() as { v: number | null }).v;
    const columns = reopened.query("PRAGMA table_info(contacts)").all() as Array<{ name: string }>;
    const columnNames = columns.map((column) => column.name);

    expect(replayed).toBe(latest);
    expect(columnNames).toContain("relationship_health");
    expect(columnNames).toContain("sensitivity");
  });

  it("does not stamp a broken migration as current", () => {
    tempRoot = mkdtempSync(join(tmpdir(), "contacts-broken-migrations-"));
    const dbPath = join(tempRoot, "contacts.db");
    const seed = new SqliteAdapter(dbPath);
    seed.exec("CREATE TABLE _migrations (version INTEGER PRIMARY KEY)");
    seed.run("INSERT INTO _migrations(version) VALUES(?)", 3);
    seed.close();

    process.env["CONTACTS_DB_PATH"] = dbPath;
    delete process.env["HASNA_CONTACTS_DB_PATH"];
    resetDatabase();

    expect(() => getDatabase()).toThrow(/Failed to apply contacts migration 4/);

    const inspect = new SqliteAdapter(dbPath);
    const row = inspect.query("SELECT MAX(version) as v FROM _migrations").get() as { v: number | null };
    expect(row.v).toBe(3);
    inspect.close();
  });
});
