import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as pkg from "./index.js";

// Public-surface contract for @hasna/contacts.
//
// The package entry must expose the Store abstraction (the single data entry
// point) and NOT the raw on-box SQLite layer. Re-exporting db/* functions such
// as createContact/getDatabase from the package root was the split-brain bug
// this rebuild eliminates: an SDK caller would write local SQLite even while the
// client is pointed at the cloud (self_hosted/cloud mode). All domain reads and
// writes flow through getStore() -> LocalStore | ApiStore.
describe("@hasna/contacts public surface", () => {
  it("exposes the Store abstraction as the data entry point", () => {
    expect(typeof pkg.getStore).toBe("function");
    expect(typeof pkg.resetStoreCache).toBe("function");
    expect(typeof pkg.ApiUnavailableError).toBe("function");
    // Typed cloud /v1 SDK client is public API.
    expect(typeof pkg.ContactsV1Client).toBe("function");
  });

  it("does NOT re-export the raw db/* SQLite layer (split-brain guard)", () => {
    const bag = pkg as unknown as Record<string, unknown>;
    for (const forbidden of [
      "getDatabase",
      "resetDatabase",
      "SqliteAdapter",
      "saveLocalFeedback",
      "getStorageStatus",
      // domain writers that historically wrote on-box SQLite unconditionally
      "createContact",
      "getContact",
      "updateContact",
      "deleteContact",
      "mergeContacts",
      "addEmailToContact",
      "createCompany",
      "createAudience",
    ]) {
      expect(bag[forbidden]).toBeUndefined();
    }
  });

  it("does not import the db/* layer in the package entry source", () => {
    const src = readFileSync(join(import.meta.dir, "index.ts"), "utf8");
    expect(src).not.toContain("./db/");
    expect(src).toContain("getStore");
    expect(src).toContain("./store/index.js");
  });
});
