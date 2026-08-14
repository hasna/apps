import { describe, test, expect, beforeEach } from "bun:test";

process.env["SIGNATURES_DB_PATH"] = ":memory:";

import { closeDatabase } from "../db/database.js";
import { createDocument } from "../db/documents.js";
import { createSignature } from "../db/signatures.js";
import { searchDocuments, searchSignatures } from "./search.js";

beforeEach(() => { closeDatabase(); });

describe("search", () => {
  test("finds document by name", () => {
    createDocument({ name: "Invoice Q1", file_path: "/f.pdf", file_name: "invoice.pdf", slug: "inv-q1" });
    const results = searchDocuments("Invoice");
    expect(results.length).toBeGreaterThan(0);
  });

  test("finds document by filename", () => {
    createDocument({ name: "Contract", file_path: "/f.pdf", file_name: "contract-2024.pdf", slug: "cont-24" });
    const results = searchDocuments("contract-2024");
    expect(results.length).toBeGreaterThan(0);
  });

  test("returns empty for no matches", () => {
    createDocument({ name: "Doc", file_path: "/f.pdf", file_name: "f.pdf", slug: "doc-no" });
    const results = searchDocuments("xyzabcnotfound123");
    expect(results.length).toBe(0);
  });

  test("finds signature by name", () => {
    createSignature({ name: "Alice Smith", type: "text", text_value: "Alice" });
    const results = searchSignatures("Alice");
    expect(results.length).toBeGreaterThan(0);
  });

  test("limits document search results", () => {
    for (let i = 0; i < 5; i++) {
      createDocument({ name: `Search Doc ${i}`, file_path: "/f.pdf", file_name: "f.pdf", slug: `srch-${i}` });
    }
    const results = searchDocuments("Search Doc", 2);
    expect(results.length).toBeLessThanOrEqual(2);
  });
});
