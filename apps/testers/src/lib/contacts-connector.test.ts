import { afterEach, describe, expect, test } from "bun:test";
import { join } from "path";
import { tmpdir } from "os";
import { mkdtempSync, rmSync } from "fs";
import { getContactsAvailability, importPersonasFromContacts } from "./contacts-connector.js";

const originalHasnaContactsDbPath = process.env.HASNA_CONTACTS_DB_PATH;
const originalOpenContactsDb = process.env.OPEN_CONTACTS_DB;
let tempDir: string | undefined;

afterEach(() => {
  if (originalHasnaContactsDbPath === undefined) delete process.env.HASNA_CONTACTS_DB_PATH;
  else process.env.HASNA_CONTACTS_DB_PATH = originalHasnaContactsDbPath;
  if (originalOpenContactsDb === undefined) delete process.env.OPEN_CONTACTS_DB;
  else process.env.OPEN_CONTACTS_DB = originalOpenContactsDb;

  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

describe("contacts connector availability", () => {
  test("reports a missing local contacts database explicitly", () => {
    tempDir = mkdtempSync(join(tmpdir(), "testers-contacts-missing-"));
    const missingPath = join(tempDir, "contacts.db");
    process.env.HASNA_CONTACTS_DB_PATH = missingPath;
    delete process.env.OPEN_CONTACTS_DB;

    expect(getContactsAvailability()).toEqual({ available: false, dbPath: missingPath });
    expect(importPersonasFromContacts({ dryRun: true })).toEqual({
      imported: 0,
      skipped: 0,
      personas: [],
      contactsAvailable: false,
      contactsDbPath: missingPath,
      skippedReason: "contacts_database_not_found",
    });
  });
});
