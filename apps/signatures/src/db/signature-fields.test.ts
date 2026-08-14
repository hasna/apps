import { describe, test, expect, beforeEach } from "bun:test";

process.env["SIGNATURES_DB_PATH"] = ":memory:";

import { closeDatabase } from "./database.js";
import {
  createSignatureField,
  getFieldById,
  listFieldsForDocument,
  deleteFieldsForDocument,
  deleteField,
} from "./signature-fields.js";
import { createDocument } from "./documents.js";
import { NotFoundError } from "../types/index.js";

beforeEach(() => { closeDatabase(); });

function makeDoc() {
  return createDocument({ name: "Doc", file_path: "/tmp/f.pdf", file_name: "f.pdf", slug: `doc-${Date.now()}` });
}

describe("signature-fields", () => {
  test("creates a field", () => {
    const doc = makeDoc();
    const field = createSignatureField({ document_id: doc.id, page: 1, x: 10, y: 80 });
    expect(field.id).toMatch(/^fld-/);
    expect(field.page).toBe(1);
    expect(field.x).toBe(10);
    expect(field.y).toBe(80);
    expect(field.field_type).toBe("signature");
  });

  test("defaults required to 1", () => {
    const doc = makeDoc();
    const field = createSignatureField({ document_id: doc.id, page: 1, x: 0, y: 0 });
    expect(field.required).toBe(1);
  });

  test("marks as detected", () => {
    const doc = makeDoc();
    const field = createSignatureField({ document_id: doc.id, page: 1, x: 0, y: 0, detected: 1 });
    expect(field.detected).toBe(1);
  });

  test("gets field by ID", () => {
    const doc = makeDoc();
    const field = createSignatureField({ document_id: doc.id, page: 1, x: 5, y: 5 });
    expect(getFieldById(field.id).id).toBe(field.id);
  });

  test("throws NotFoundError for missing field", () => {
    expect(() => getFieldById("fld-missing")).toThrow(NotFoundError);
  });

  test("lists fields for document", () => {
    const doc = makeDoc();
    createSignatureField({ document_id: doc.id, page: 1, x: 10, y: 10 });
    createSignatureField({ document_id: doc.id, page: 2, x: 20, y: 20 });
    const fields = listFieldsForDocument(doc.id);
    expect(fields.length).toBe(2);
  });

  test("orders fields by page and y", () => {
    const doc = makeDoc();
    createSignatureField({ document_id: doc.id, page: 2, x: 0, y: 50 });
    createSignatureField({ document_id: doc.id, page: 1, x: 0, y: 80 });
    const fields = listFieldsForDocument(doc.id);
    expect(fields[0]?.page).toBe(1);
  });

  test("deletes all fields for document", () => {
    const doc = makeDoc();
    createSignatureField({ document_id: doc.id, page: 1, x: 0, y: 0 });
    deleteFieldsForDocument(doc.id);
    expect(listFieldsForDocument(doc.id).length).toBe(0);
  });

  test("deletes individual field", () => {
    const doc = makeDoc();
    const f = createSignatureField({ document_id: doc.id, page: 1, x: 0, y: 0 });
    deleteField(f.id);
    expect(() => getFieldById(f.id)).toThrow(NotFoundError);
  });
});
