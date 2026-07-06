import { describe, expect, it } from "bun:test";
import { seedFixture } from "./helpers/harness.js";
import { createDocument, getDocumentById, listDocumentsService } from "../src/services/documents.js";

describe("documents service (filing doc refs)", () => {
  it("attaches a filing document reference to an asset", () => {
    const { ctx, assetId } = seedFixture();
    const doc = createDocument(ctx, {
      asset_id: assetId,
      title: "Statement of Use",
      doc_type: "filing",
      doc_ref: "signatures://doc/abc123",
    });
    expect(doc.doc_type).toBe("filing");
    expect(doc.doc_ref).toBe("signatures://doc/abc123");
    expect(getDocumentById(ctx, doc.id).title).toBe("Statement of Use");
  });

  it("defaults doc_type to filing and lists by asset", () => {
    const { ctx, assetId } = seedFixture();
    createDocument(ctx, { asset_id: assetId, title: "Certificate" });
    const docs = listDocumentsService(ctx, { asset_id: assetId });
    expect(docs.length).toBe(1);
    expect(docs[0]!.doc_type).toBe("filing");
  });

  it("rejects an unknown doc_type", () => {
    const { ctx, assetId } = seedFixture();
    expect(() => createDocument(ctx, { asset_id: assetId, title: "X", doc_type: "invalid" as never })).toThrow();
  });
});
