import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getStorageStatus, CONTACTS_STORAGE_TABLES } from "./storage.js";
import { resetDatabase } from "./database.js";
import { SqliteAdapter } from "./sqlite-adapter.js";

let tmpDir: string;
const originalContactsDbPath = process.env["CONTACTS_DB_PATH"];

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "contacts-storage-test-"));
  process.env["CONTACTS_DB_PATH"] = join(tmpDir, "test.db");
  resetDatabase();
});

afterEach(() => {
  resetDatabase();
  if (originalContactsDbPath === undefined) delete process.env["CONTACTS_DB_PATH"];
  else process.env["CONTACTS_DB_PATH"] = originalContactsDbPath;
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("contacts storage status", () => {
  it("reports contacts-owned local storage tables", () => {
    const status = getStorageStatus();

    expect(status.mode).toBe("local");
    expect(status.db_path).toBe(join(tmpDir, "test.db"));
    expect(status.tables.find((table) => table.table === "contacts")?.ok).toBe(true);
    expect(status.tables.find((table) => table.table === "companies")?.ok).toBe(true);
    expect(CONTACTS_STORAGE_TABLES).toContain("contact_tasks");
    expect(CONTACTS_STORAGE_TABLES).toContain("contact_documents");
    expect(CONTACTS_STORAGE_TABLES).toContain("contact_health");
    expect(CONTACTS_STORAGE_TABLES).toContain("feedback");
  });

  it("reports missing tables as schema errors instead of zero-row tables", () => {
    const db = new SqliteAdapter(":memory:");
    db.exec("CREATE TABLE contacts (id TEXT PRIMARY KEY)");

    const status = getStorageStatus(db);
    const contacts = status.tables.find((table) => table.table === "contacts");
    const documents = status.tables.find((table) => table.table === "contact_documents");

    expect(contacts).toMatchObject({ ok: true, rows: 0 });
    expect(documents?.ok).toBe(false);
    expect(documents?.rows).toBeNull();
    expect(documents?.error).toContain("no such table");

    db.close();
  });
});
