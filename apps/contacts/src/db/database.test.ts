import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDataDir, getDbPath, resetDatabase } from "./database.js";

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
