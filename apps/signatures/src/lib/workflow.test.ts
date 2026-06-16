import { beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env["SIGNATURES_DB_PATH"] = ":memory:";

import { closeDatabase } from "../db/database.js";
import { createSignature } from "../db/signatures.js";
import { listFieldsForDocument } from "../db/signature-fields.js";
import { createDocumentFromMarkdown, signDocumentLocally } from "./workflow.js";

beforeEach(() => closeDatabase());

describe("workflow", () => {
  test("renders markdown document and creates signature field anchors", async () => {
    const dir = mkdtempSync(join(tmpdir(), "open-signatures-"));
    const md = join(dir, "agreement.md");
    writeFileSync(md, "# Agreement\n\nSigner: {{ signer.name }}\n\nSignature: {{signature:client}}\n");

    const result = await createDocumentFromMarkdown({
      filePath: md,
      signerName: "Ada Lovelace",
      signerEmail: "ada@example.com",
    });

    expect(result.document_id).toMatch(/^doc-/);
    expect(result.fields[0]?.anchor).toBe("client");
    expect(listFieldsForDocument(result.document_id)[0]?.anchor).toBe("client");
  });

  test("signs a markdown field and writes a certificate", async () => {
    const dir = mkdtempSync(join(tmpdir(), "open-signatures-"));
    const md = join(dir, "agreement.md");
    writeFileSync(md, "# Agreement\n\nSignature: {{signature}}\n");
    const doc = await createDocumentFromMarkdown({ filePath: md });
    const sig = createSignature({ name: "Ada", type: "text", text_value: "Ada Lovelace" });

    const signed = await signDocumentLocally({
      documentId: doc.document_id,
      signatureId: sig.id,
      fieldId: doc.fields[0]?.id,
      signerName: "Ada Lovelace",
      signerEmail: "ada@example.com",
    });

    expect(signed.output_path).toEndWith(".pdf");
    expect(signed.certificate_path).toEndWith(".pdf");
    expect(signed.session.status).toBe("completed");
  });
});
