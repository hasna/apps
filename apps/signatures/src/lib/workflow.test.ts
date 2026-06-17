import { beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env["SIGNATURES_DB_PATH"] = ":memory:";

import { closeDatabase } from "../db/database.js";
import { listProviderEvidence } from "../db/provider-evidence.js";
import { createSignature } from "../db/signatures.js";
import { listFieldsForDocument } from "../db/signature-fields.js";
import { createDocumentFromMarkdown, sendDocumentWithProvider, signDocumentLocally } from "./workflow.js";

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

  test("creates PandaDoc provider dry-run evidence", async () => {
    const dir = mkdtempSync(join(tmpdir(), "open-signatures-"));
    const md = join(dir, "provider.md");
    writeFileSync(md, "# Provider Agreement\n\nSignature: {{signature}}\n");
    const doc = await createDocumentFromMarkdown({ filePath: md });

    const result = await sendDocumentWithProvider({
      documentId: doc.document_id,
      provider: "pandadoc",
      recipient: { name: "Ada Lovelace", email: "ada@example.com" },
      signatureLevel: "qes",
      dryRun: true,
    });

    expect(result.provider.status).toBe("dry_run");
    expect(result.evidence.provider).toBe("pandadoc");
    expect(result.evidence.signature_level).toBe("qes");
    expect(result.evidence.request?.["settings"]).toEqual({ qualified_electronic_signature: true });
    expect(listProviderEvidence({ document_id: doc.document_id })).toHaveLength(1);
  });

  test("creates Yousign connector dry-run evidence", async () => {
    const dir = mkdtempSync(join(tmpdir(), "open-signatures-"));
    const md = join(dir, "yousign.md");
    writeFileSync(md, "# Yousign Agreement\n\nSignature: {{signature}}\n");
    const doc = await createDocumentFromMarkdown({ filePath: md });

    const result = await sendDocumentWithProvider({
      documentId: doc.document_id,
      provider: "yousign",
      recipient: { name: "Grace Hopper", email: "grace@example.com" },
      signatureLevel: "qes",
      dryRun: true,
    });

    expect(result.provider.connector_slug).toBe("yousign");
    expect(result.provider.operation).toBe("signature_requests.create_qualified");
    expect(result.evidence.request?.["signature_level"]).toBe("qualified_electronic_signature");
    expect(result.session.provider_status).toBe("prepared");
  });

  test("requires explicit provider signature level", async () => {
    const dir = mkdtempSync(join(tmpdir(), "open-signatures-"));
    const md = join(dir, "missing-level.md");
    writeFileSync(md, "# Missing Level\n\nSignature: {{signature}}\n");
    const doc = await createDocumentFromMarkdown({ filePath: md });

    await expect(sendDocumentWithProvider({
      documentId: doc.document_id,
      provider: "yousign",
      recipient: { name: "Ada Lovelace", email: "ada@example.com" },
      signatureLevel: "not-a-level" as never,
      dryRun: true,
    })).rejects.toThrow("signature_level must be one of");
  });

  test("routes eSeal dry-runs to legal-entity seal operations", async () => {
    const dir = mkdtempSync(join(tmpdir(), "open-signatures-"));
    const md = join(dir, "seal.md");
    writeFileSync(md, "# Company Record\n\nIssued by Hasna.\n");
    const doc = await createDocumentFromMarkdown({ filePath: md });

    const result = await sendDocumentWithProvider({
      documentId: doc.document_id,
      provider: "yousign",
      recipient: { name: "Hasna, Inc.", email: "legal@example.com" },
      signatureLevel: "qeseal",
      dryRun: true,
    });

    expect(result.provider.operation).toBe("seals.create_qualified");
    expect(result.evidence.request?.["legal_entity"]).toBe(true);
    expect(result.evidence.request).not.toHaveProperty("signers");
  });
});
