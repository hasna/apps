import { beforeEach, describe, expect, test } from "bun:test";

process.env["SIGNATURES_DB_PATH"] = ":memory:";

import { closeDatabase } from "./database.js";
import { createDocument } from "./documents.js";
import { createProviderEvidence, listProviderEvidence, updateProviderEvidence } from "./provider-evidence.js";

beforeEach(() => closeDatabase());

describe("provider evidence", () => {
  test("creates, lists, and updates provider evidence", () => {
    const doc = createDocument({ name: "Agreement", file_path: "/tmp/agreement.pdf", file_name: "agreement.pdf" });
    const evidence = createProviderEvidence({
      document_id: doc.id,
      provider: "yousign",
      connector_slug: "yousign",
      operation: "signature_requests.create_qualified",
      signature_level: "qes",
      status: "prepared",
      validation_status: "pending",
      request: { signature_level: "qualified_electronic_signature" },
      original_document_hash: "abc",
    });

    expect(evidence.id).toMatch(/^evd-/);
    expect(listProviderEvidence({ document_id: doc.id })).toHaveLength(1);

    const updated = updateProviderEvidence(evidence.id, {
      status: "validated",
      validation_status: "valid",
      remote_document_id: "remote-1",
    });
    expect(updated.remote_document_id).toBe("remote-1");
    expect(updated.validation_status).toBe("valid");
  });
});
