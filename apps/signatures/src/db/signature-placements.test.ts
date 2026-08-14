import { describe, test, expect, beforeEach } from "bun:test";

process.env["SIGNATURES_DB_PATH"] = ":memory:";

import { closeDatabase } from "./database.js";
import { createPlacement, getPlacementById, listPlacementsForDocument, deletePlacement } from "./signature-placements.js";
import { createDocument } from "./documents.js";
import { createSignature } from "./signatures.js";
import { NotFoundError } from "../types/index.js";

beforeEach(() => { closeDatabase(); });

function makeDoc() {
  return createDocument({ name: "Doc", file_path: "/tmp/f.pdf", file_name: "f.pdf", slug: `doc-${Date.now()}` });
}

function makeSig() {
  return createSignature({ name: "Sig", type: "text", text_value: "Test" });
}

describe("signature-placements", () => {
  test("creates a placement", () => {
    const doc = makeDoc();
    const sig = makeSig();
    const plc = createPlacement({ document_id: doc.id, signature_id: sig.id, page: 1, x: 10, y: 80 });
    expect(plc.id).toMatch(/^plc-/);
    expect(plc.page).toBe(1);
    expect(plc.signed_at).toBeDefined();
  });

  test("gets placement by ID", () => {
    const doc = makeDoc();
    const sig = makeSig();
    const plc = createPlacement({ document_id: doc.id, signature_id: sig.id, page: 1, x: 0, y: 0 });
    expect(getPlacementById(plc.id).id).toBe(plc.id);
  });

  test("throws NotFoundError for missing placement", () => {
    expect(() => getPlacementById("plc-missing")).toThrow(NotFoundError);
  });

  test("lists placements for document", () => {
    const doc = makeDoc();
    const sig = makeSig();
    createPlacement({ document_id: doc.id, signature_id: sig.id, page: 1, x: 0, y: 0 });
    createPlacement({ document_id: doc.id, signature_id: sig.id, page: 2, x: 0, y: 0 });
    const list = listPlacementsForDocument(doc.id);
    expect(list.length).toBe(2);
  });

  test("deletes placement", () => {
    const doc = makeDoc();
    const sig = makeSig();
    const plc = createPlacement({ document_id: doc.id, signature_id: sig.id, page: 1, x: 0, y: 0 });
    deletePlacement(plc.id);
    expect(() => getPlacementById(plc.id)).toThrow(NotFoundError);
  });
});
