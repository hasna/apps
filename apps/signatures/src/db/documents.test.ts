import { describe, test, expect, beforeEach } from "bun:test";

process.env["SIGNATURES_DB_PATH"] = ":memory:";

import { closeDatabase } from "./database.js";
import {
  createDocument,
  getDocumentById,
  getDocumentBySlug,
  getDocumentByIdOrSlug,
  listDocuments,
  updateDocument,
  deleteDocument,
} from "./documents.js";
import { NotFoundError } from "../types/index.js";

beforeEach(() => { closeDatabase(); });

function makeDoc(overrides: Record<string, unknown> = {}) {
  return createDocument({
    name: "Test Doc",
    file_path: "/tmp/test.pdf",
    file_name: "test.pdf",
    ...overrides,
  } as Parameters<typeof createDocument>[0]);
}

describe("documents", () => {
  test("creates a document", () => {
    const doc = makeDoc();
    expect(doc.id).toMatch(/^doc-/);
    expect(doc.name).toBe("Test Doc");
    expect(doc.status).toBe("draft");
    expect(doc.mime_type).toBe("application/pdf");
  });

  test("creates document with metadata", () => {
    const doc = makeDoc({ metadata: { foo: "bar" } });
    expect(doc.metadata?.["foo"]).toBe("bar");
  });

  test("gets document by ID", () => {
    const doc = makeDoc();
    expect(getDocumentById(doc.id).id).toBe(doc.id);
  });

  test("throws NotFoundError for missing ID", () => {
    expect(() => getDocumentById("doc-missing")).toThrow(NotFoundError);
  });

  test("gets document by slug", () => {
    const doc = makeDoc({ slug: "my-unique-slug" });
    expect(getDocumentBySlug("my-unique-slug").id).toBe(doc.id);
  });

  test("gets document by ID or slug (by ID)", () => {
    const doc = makeDoc();
    expect(getDocumentByIdOrSlug(doc.id).id).toBe(doc.id);
  });

  test("gets document by ID or slug (by slug)", () => {
    const doc = makeDoc({ slug: "slug-test" });
    expect(getDocumentByIdOrSlug("slug-test").id).toBe(doc.id);
  });

  test("lists all documents", () => {
    makeDoc({ name: "D1", slug: "d1-x" });
    makeDoc({ name: "D2", slug: "d2-x" });
    expect(listDocuments().length).toBeGreaterThanOrEqual(2);
  });

  test("filters by status", () => {
    makeDoc({ status: "draft", slug: "draft-x" });
    makeDoc({ status: "completed", slug: "comp-x" });
    const drafts = listDocuments({ status: "draft" });
    expect(drafts.every(d => d.status === "draft")).toBe(true);
  });

  test("updates document status", () => {
    const doc = makeDoc({ slug: "upd-x" });
    const updated = updateDocument(doc.id, { status: "pending" });
    expect(updated.status).toBe("pending");
  });

  test("updates document name", () => {
    const doc = makeDoc({ slug: "name-upd" });
    const updated = updateDocument(doc.id, { name: "New Name" });
    expect(updated.name).toBe("New Name");
  });

  test("throws on update of missing document", () => {
    expect(() => updateDocument("doc-missing", { name: "x" })).toThrow(NotFoundError);
  });

  test("deletes document", () => {
    const doc = makeDoc({ slug: "del-x" });
    deleteDocument(doc.id);
    expect(() => getDocumentById(doc.id)).toThrow(NotFoundError);
  });

  test("throws on delete of missing document", () => {
    expect(() => deleteDocument("doc-missing")).toThrow(NotFoundError);
  });

  test("limits results", () => {
    for (let i = 0; i < 5; i++) {
      makeDoc({ name: `Doc ${i}`, slug: `doc-lim-${i}` });
    }
    const limited = listDocuments({ limit: 2 });
    expect(limited.length).toBeLessThanOrEqual(2);
  });
});
