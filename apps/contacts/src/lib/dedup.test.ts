import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { resetDatabase, getDatabase } from "../db/database.js";
import { createContact, addEmailToContact } from "../db/contacts.js";
import { findEmailDuplicates, findNameDuplicates } from "./dedup.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "contacts-test-"));
  process.env["CONTACTS_DB_PATH"] = join(tmpDir, "test.db");
  resetDatabase();
});

afterEach(() => {
  resetDatabase();
  try { rmSync(tmpDir, { recursive: true }); } catch {}
});

describe("findEmailDuplicates", () => {
  it("returns empty array when no duplicates", () => {
    const db = getDatabase();
    const c1 = createContact({ display_name: "Alice" });
    const c2 = createContact({ display_name: "Bob" });
    addEmailToContact(c1.id, { address: "alice@example.com", type: "work", is_primary: true });
    addEmailToContact(c2.id, { address: "bob@example.com", type: "work", is_primary: true });
    const dups = findEmailDuplicates(db);
    expect(dups).toHaveLength(0);
  });

  it("returns empty array when no contacts exist", () => {
    const db = getDatabase();
    const dups = findEmailDuplicates(db);
    expect(dups).toHaveLength(0);
  });

  it("finds contacts sharing the same email", () => {
    const db = getDatabase();
    const c1 = createContact({ display_name: "Alice" });
    const c2 = createContact({ display_name: "Bob" });
    addEmailToContact(c1.id, { address: "shared@example.com", type: "work", is_primary: true });
    addEmailToContact(c2.id, { address: "shared@example.com", type: "personal", is_primary: false });
    const dups = findEmailDuplicates(db);
    expect(dups).toHaveLength(1);
    expect(dups[0]!.contact_ids).toContain(c1.id);
    expect(dups[0]!.contact_ids).toContain(c2.id);
  });

  it("is case-insensitive for email matching", () => {
    const db = getDatabase();
    const c1 = createContact({ display_name: "Alice" });
    const c2 = createContact({ display_name: "Bob" });
    addEmailToContact(c1.id, { address: "Test@Example.COM", type: "work", is_primary: true });
    addEmailToContact(c2.id, { address: "test@example.com", type: "work", is_primary: true });
    const dups = findEmailDuplicates(db);
    expect(dups).toHaveLength(1);
  });
});

describe("findNameDuplicates", () => {
  it("returns empty array when no contacts", () => {
    const db = getDatabase();
    const dups = findNameDuplicates(db);
    expect(dups).toHaveLength(0);
  });

  it("returns empty array for very different names", () => {
    const db = getDatabase();
    createContact({ display_name: "Alice" });
    createContact({ display_name: "Zebedee" });
    const dups = findNameDuplicates(db);
    expect(dups).toHaveLength(0);
  });

  it("finds names with Levenshtein distance <= 2", () => {
    const db = getDatabase();
    const c1 = createContact({ display_name: "Alice" });
    const c2 = createContact({ display_name: "Alicx" }); // distance 1
    const dups = findNameDuplicates(db);
    expect(dups).toHaveLength(1);
    expect(dups[0]!.contact_ids).toEqual([c1.id, c2.id]);
    expect(dups[0]!.similarity).toBeLessThanOrEqual(2);
    expect(dups[0]!.similarity).toBeGreaterThan(0);
  });

  it("does NOT flag exact duplicates (distance 0)", () => {
    const db = getDatabase();
    createContact({ display_name: "Alice" });
    createContact({ display_name: "Alice" });
    const dups = findNameDuplicates(db);
    // Levenshtein distance is 0 for exact match, which is excluded (dist > 0)
    expect(dups).toHaveLength(0);
  });

  it("handles distance 2 names", () => {
    const db = getDatabase();
    createContact({ display_name: "Alice" });
    createContact({ display_name: "Alxyz" }); // distance 3, should NOT match
    const dups = findNameDuplicates(db);
    expect(dups).toHaveLength(0);
  });

  it("is case-insensitive", () => {
    const db = getDatabase();
    const c1 = createContact({ display_name: "alice" });
    const c2 = createContact({ display_name: "Alicx" }); // case diff + 1 char diff
    const dups = findNameDuplicates(db);
    expect(dups).toHaveLength(1);
  });
});
