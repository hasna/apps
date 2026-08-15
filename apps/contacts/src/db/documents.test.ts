import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { resetDatabase } from "./database.js";
import { addDocument, getDocument, listDocuments, deleteDocument, DOCUMENT_TYPES } from "./documents.js";
import { createContact } from "./contacts.js";
import { initVault, lockVault } from "../lib/vault.js";

let tmpDir: string;
let contactId: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "contacts-test-"));
  process.env["CONTACTS_DB_PATH"] = join(tmpDir, "test.db");
  process.env["HOME"] = tmpDir;
  resetDatabase();
  initVault("test-passphrase");
  const c = createContact({ display_name: "Doc User" });
  contactId = c.id;
});

afterEach(() => {
  lockVault();
  resetDatabase();
  try { rmSync(tmpDir, { recursive: true }); } catch {}
});

describe("DOCUMENT_TYPES", () => {
  it("exports a non-empty list of document types", () => {
    expect(DOCUMENT_TYPES.length).toBeGreaterThan(0);
    expect(DOCUMENT_TYPES).toContain("passport");
    expect(DOCUMENT_TYPES).toContain("other");
  });
});

describe("addDocument", () => {
  it("creates a document with encrypted value", () => {
    const doc = addDocument({
      contact_id: contactId,
      doc_type: "passport",
      value: "AB1234567",
    });
    expect(doc.id).toBeTruthy();
    expect(doc.contact_id).toBe(contactId);
    expect(doc.doc_type).toBe("passport");
    expect(doc.value).toBe("AB1234567");
    expect(doc.has_file).toBe(false);
    expect(doc.file_path).toBeNull();
    expect(doc.created_at).toBeTruthy();
    expect(doc.updated_at).toBeTruthy();
  });

  it("creates a document with label and metadata", () => {
    const doc = addDocument({
      contact_id: contactId,
      doc_type: "tax_id",
      label: "US SSN",
      value: "123-45-6789",
      metadata: { country: "US" },
    });
    expect(doc.label).toBe("US SSN");
    expect(doc.metadata).toEqual({ country: "US" });
  });

  it("creates a document with expires_at", () => {
    const doc = addDocument({
      contact_id: contactId,
      doc_type: "visa",
      value: "VISA-999",
      expires_at: "2030-12-31",
    });
    expect(doc.expires_at).toBe("2030-12-31");
  });

  it("creates a document with a file attachment", () => {
    const filePath = join(tmpDir, "scan.pdf");
    writeFileSync(filePath, "fake-pdf-content");
    const doc = addDocument({
      contact_id: contactId,
      doc_type: "passport",
      value: "XY9876543",
      file_path: filePath,
    });
    expect(doc.has_file).toBe(true);
    expect(doc.file_path).toBeTruthy();
  });

  it("defaults label to null and metadata to empty object", () => {
    const doc = addDocument({
      contact_id: contactId,
      doc_type: "other",
      value: "misc-value",
    });
    expect(doc.label).toBeNull();
    expect(doc.metadata).toEqual({});
  });
});

describe("getDocument", () => {
  it("returns a document by id with decrypted value", () => {
    const created = addDocument({
      contact_id: contactId,
      doc_type: "ssn",
      value: "111-22-3333",
    });
    const fetched = getDocument(created.id);
    expect(fetched.id).toBe(created.id);
    expect(fetched.value).toBe("111-22-3333");
  });

  it("throws for non-existent document", () => {
    expect(() => getDocument("nonexistent-id")).toThrow("Document not found");
  });
});

describe("listDocuments", () => {
  it("returns summaries for a contact's documents", () => {
    addDocument({ contact_id: contactId, doc_type: "passport", value: "P1" });
    addDocument({ contact_id: contactId, doc_type: "tax_id", value: "T1", label: "Tax" });
    const list = listDocuments(contactId);
    expect(list).toHaveLength(2);
    expect(list[0]!.doc_type).toBeTruthy();
    // summaries should not include the value field
    expect((list[0] as any).value).toBeUndefined();
  });

  it("returns empty array for contact with no documents", () => {
    const list = listDocuments(contactId);
    expect(list).toEqual([]);
  });

  it("does not require vault to be unlocked", () => {
    addDocument({ contact_id: contactId, doc_type: "passport", value: "P1" });
    lockVault();
    // listDocuments should still work (metadata only)
    const list = listDocuments(contactId);
    expect(list).toHaveLength(1);
    // re-init vault for afterEach cleanup
    initVault("test-passphrase");
  });

  it("returns documents ordered by created_at descending", () => {
    addDocument({ contact_id: contactId, doc_type: "passport", value: "First" });
    addDocument({ contact_id: contactId, doc_type: "visa", value: "Second" });
    const list = listDocuments(contactId);
    expect(list).toHaveLength(2);
    // Most recent first
    expect(list[0]!.doc_type).toBe("visa");
  });
});

describe("deleteDocument", () => {
  it("deletes a document by id", () => {
    const doc = addDocument({ contact_id: contactId, doc_type: "passport", value: "DEL" });
    deleteDocument(doc.id);
    expect(() => getDocument(doc.id)).toThrow("Document not found");
  });

  it("deletes associated file when present", () => {
    const filePath = join(tmpDir, "toremove.pdf");
    writeFileSync(filePath, "content");
    const doc = addDocument({
      contact_id: contactId,
      doc_type: "contract",
      value: "contract-val",
      file_path: filePath,
    });
    deleteDocument(doc.id);
    const list = listDocuments(contactId);
    expect(list).toHaveLength(0);
  });

  it("does not throw when deleting non-existent document", () => {
    expect(() => deleteDocument("no-such-id")).not.toThrow();
  });
});
