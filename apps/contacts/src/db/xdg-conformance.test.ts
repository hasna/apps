import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDataDir, getDbPath } from "./database.js";

/**
 * XDG conformance regression (hotfixes task 5f624540):
 * @hasna/contacts must route its on-box store and vault session state through
 * the XDG resolvers (@hasna/paths dataDir/stateDir), never the legacy
 * ~/.hasna/contacts home. These tests fail on the pre-fix build, which
 * hardcodes join(home, ".hasna", "contacts").
 */

const originalHome = process.env["HOME"];
const originalUserProfile = process.env["USERPROFILE"];
const originalContactsDbPath = process.env["CONTACTS_DB_PATH"];
const originalHasnaContactsDbPath = process.env["HASNA_CONTACTS_DB_PATH"];
const originalHasnaDataHome = process.env["HASNA_DATA_HOME"];
const originalHasnaStateHome = process.env["HASNA_STATE_HOME"];
let tempRoot: string | null = null;

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function mode(path: string): number {
  return statSync(path).mode & 0o777;
}

afterEach(() => {
  restoreEnv("HOME", originalHome);
  restoreEnv("USERPROFILE", originalUserProfile);
  restoreEnv("CONTACTS_DB_PATH", originalContactsDbPath);
  restoreEnv("HASNA_CONTACTS_DB_PATH", originalHasnaContactsDbPath);
  restoreEnv("HASNA_DATA_HOME", originalHasnaDataHome);
  restoreEnv("HASNA_STATE_HOME", originalHasnaStateHome);
  if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
  tempRoot = null;
});

function setTestEnv(): void {
  tempRoot = mkdtempSync(join(tmpdir(), "contacts-xdg-"));
  process.env["HOME"] = tempRoot;
  delete process.env["USERPROFILE"];
  delete process.env["CONTACTS_DB_PATH"];
  delete process.env["HASNA_CONTACTS_DB_PATH"];
  process.env["HASNA_DATA_HOME"] = join(tempRoot, ".local", "share", "hasna");
  delete process.env["HASNA_STATE_HOME"];
}

describe("XDG conformance — @hasna/contacts routes through @hasna/paths", () => {
  it("resolves the data dir to the XDG data root, not the legacy ~/.hasna/contacts", () => {
    setTestEnv();
    const dataDir = getDataDir();
    const expected = join(tempRoot!, ".local", "share", "hasna", "contacts");
    expect(dataDir).toBe(expected);
    expect(dataDir).not.toContain(".hasna");
    expect(getDbPath()).toBe(join(expected, "contacts.db"));
  });

  it("does not create the legacy ~/.hasna/contacts home on first use", () => {
    setTestEnv();
    getDataDir();
    expect(existsSync(join(tempRoot!, ".hasna", "contacts"))).toBe(false);
  });

  it("leaves populated legacy data untouched for explicit preservation", () => {
    setTestEnv();
    const legacy = join(tempRoot!, ".hasna", "contacts");
    mkdirSync(join(legacy, "documents"), { recursive: true });
    mkdirSync(join(legacy, "images"), { recursive: true });
    writeFileSync(join(legacy, "contacts.db"), "legacy-db");
    writeFileSync(join(legacy, "documents", "c1.pdf"), "doc-payload");
    writeFileSync(join(legacy, "images", "c1.jpg"), "img-payload");

    const dataDir = getDataDir();
    expect(dataDir).toBe(join(tempRoot!, ".local", "share", "hasna", "contacts"));
    expect(existsSync(join(dataDir, "contacts.db"))).toBe(false);
    expect(readFileSync(join(legacy, "contacts.db"), "utf8")).toBe("legacy-db");
    expect(readFileSync(join(legacy, "documents", "c1.pdf"), "utf8")).toBe("doc-payload");
    expect(readFileSync(join(legacy, "images", "c1.jpg"), "utf8")).toBe("img-payload");
    expect(mode(join(tempRoot!, ".local", "share", "hasna"))).toBe(0o700);
    expect(mode(dataDir)).toBe(0o700);
  });

  it("does not clobber an existing XDG store with legacy data (gated adoption)", () => {
    setTestEnv();
    const xdg = join(tempRoot!, ".local", "share", "hasna", "contacts");
    mkdirSync(xdg, { recursive: true });
    writeFileSync(join(xdg, "contacts.db"), "xdg-db");
    const legacy = join(tempRoot!, ".hasna", "contacts");
    mkdirSync(legacy, { recursive: true });
    writeFileSync(join(legacy, "contacts.db"), "legacy-db");

    getDataDir();
    expect(readFileSync(join(xdg, "contacts.db"), "utf8")).toBe("xdg-db");
  });

  it("honors the HASNA_DATA_HOME override through the data resolver", () => {
    tempRoot = mkdtempSync(join(tmpdir(), "contacts-xdg-d-ovr-"));
    process.env["HOME"] = tempRoot;
    process.env["HASNA_DATA_HOME"] = join(tempRoot, "custom-data");
    delete process.env["USERPROFILE"];
    delete process.env["CONTACTS_DB_PATH"];
    delete process.env["HASNA_CONTACTS_DB_PATH"];
    delete process.env["HASNA_STATE_HOME"];

    expect(getDataDir()).toBe(join(tempRoot, "custom-data", "contacts"));
  });
});
