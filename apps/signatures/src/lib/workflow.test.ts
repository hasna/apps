import { beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env["SIGNATURES_DB_PATH"] = ":memory:";

import { closeDatabase } from "../db/database.js";
import { getSigningCertificateBySession } from "../db/certificates.js";
import { getDocumentByIdOrSlug } from "../db/documents.js";
import { listProviderEvidence } from "../db/provider-evidence.js";
import { createSignature } from "../db/signatures.js";
import { listFieldsForDocument } from "../db/signature-fields.js";
import { createSigningSession } from "../db/signing-sessions.js";
import { sha256File } from "./hash.js";
import { createDocumentFromMarkdown, sendDocumentWithProvider, signDocumentLocally } from "./workflow.js";

beforeEach(() => closeDatabase());

describe("workflow", () => {
  test("renders markdown document and creates signature field anchors", async () => {
    const dir = mkdtempSync(join(tmpdir(), "signatures-"));
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
    const dir = mkdtempSync(join(tmpdir(), "signatures-"));
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

  test("signs an agent-routed markdown field with agent evidence metadata", async () => {
    const dir = mkdtempSync(join(tmpdir(), "signatures-"));
    const md = join(dir, "agent-review.md");
    writeFileSync(md, "# Agent Review\n\nApproval: {{signature:review|type=agent|role=Reviewer|order=2}}\n");
    const doc = await createDocumentFromMarkdown({ filePath: md });
    const sig = createSignature({ name: "Sagan", type: "text", text_value: "Sagan" });

    const field = listFieldsForDocument(doc.document_id)[0]!;
    expect(field.signer_type).toBe("agent");
    expect(field.role).toBe("Reviewer");
    expect(field.signing_order).toBe(2);

    const signed = await signDocumentLocally({
      documentId: doc.document_id,
      signatureId: sig.id,
      fieldId: field.id,
      signerName: "Sagan",
      signerType: "agent",
      agentId: "agent-sagan",
      agentRunId: "run-123",
      agentPolicyId: "internal-agent-approval-v1",
      agentReason: "Policy check passed",
    });

    expect(signed.session.signer_type).toBe("agent");
    expect(signed.session.agent_id).toBe("agent-sagan");
    expect(signed.session.role).toBe("Reviewer");
    expect(signed.session.agent_output_hash).toBeTruthy();
  });

  test("keeps multi-signer documents open until all required fields are signed", async () => {
    const dir = mkdtempSync(join(tmpdir(), "signatures-"));
    const md = join(dir, "multi.md");
    writeFileSync(md, "# Multi\n\nClient: {{signature:client|type=human|role=Client|order=1}}\n\nReview: {{signature:review|type=agent|role=Reviewer|order=2}}\n");
    const doc = await createDocumentFromMarkdown({ filePath: md });
    const sig = createSignature({ name: "Signer", type: "text", text_value: "Signer" });
    const fields = listFieldsForDocument(doc.document_id);

    await expect(signDocumentLocally({
      documentId: doc.document_id,
      signatureId: sig.id,
      fieldId: fields[1]?.id,
      signerName: "Sagan",
      signerType: "agent",
      signingOrder: 1,
    })).rejects.toThrow("cannot be signed before required field");

    const first = await signDocumentLocally({
      documentId: doc.document_id,
      signatureId: sig.id,
      fieldId: fields[0]?.id,
      signerName: "Ada Lovelace",
    });
    expect(first.session.status).toBe("completed");
    expect(getDocumentByIdOrSlug(doc.document_id).status).toBe("signed");
    const firstCertificate = getSigningCertificateBySession(first.session.id);
    expect(firstCertificate.metadata?.["document_complete"]).toBe(false);
    expect(firstCertificate.metadata?.["certificate_kind"]).toBe("signer_evidence");

    const second = await signDocumentLocally({
      documentId: doc.document_id,
      signatureId: sig.id,
      fieldId: fields[1]?.id,
      signerName: "Sagan",
      signerType: "agent",
      agentId: "agent-sagan",
    });
    expect(second.session.signer_type).toBe("agent");
    expect(getDocumentByIdOrSlug(doc.document_id).status).toBe("completed");
    const secondCertificate = getSigningCertificateBySession(second.session.id);
    expect(secondCertificate.metadata?.["document_complete"]).toBe(true);
    expect(secondCertificate.metadata?.["certificate_kind"]).toBe("document_completion");
  });

  test("completes the session-bound field when no field is passed", async () => {
    const dir = mkdtempSync(join(tmpdir(), "signatures-"));
    const md = join(dir, "session-field.md");
    writeFileSync(md, "# Session Field\n\nClient: {{signature:client|type=human|role=Client|order=1}}\n\nReview: {{signature:review|type=agent|role=Reviewer|order=2}}\n");
    const doc = await createDocumentFromMarkdown({ filePath: md });
    const sig = createSignature({ name: "Reviewer", type: "text", text_value: "Reviewer" });
    const fields = listFieldsForDocument(doc.document_id);
    const client = fields.find((field) => field.role === "Client")!;
    const review = fields.find((field) => field.role === "Reviewer")!;

    await signDocumentLocally({
      documentId: doc.document_id,
      signatureId: sig.id,
      fieldId: client.id,
      signerName: "Client Human",
    });

    const session = createSigningSession({
      document_id: doc.document_id,
      field_id: review.id,
      signer_name: "Review Agent",
      signer_type: "agent",
      agent_id: "agent-reviewer",
      role: "Reviewer",
      source: "local",
    });

    await signDocumentLocally({
      documentId: doc.document_id,
      signatureId: sig.id,
      sessionId: session.id,
      signerType: "agent",
    });

    const updatedFields = listFieldsForDocument(doc.document_id);
    expect(updatedFields.find((field) => field.role === "Client")?.recipient_status).toBe("signed");
    expect(updatedFields.find((field) => field.role === "Reviewer")?.recipient_status).toBe("signed");
  });

  test("keeps fieldless multi-session documents open until all sessions are signed", async () => {
    const dir = mkdtempSync(join(tmpdir(), "signatures-"));
    const md = join(dir, "fieldless.md");
    writeFileSync(md, "# Fieldless Agreement\n\nThis agreement is signed by explicit coordinates.\n");
    const doc = await createDocumentFromMarkdown({ filePath: md });
    const sig = createSignature({ name: "Signer", type: "text", text_value: "Signer" });
    const firstSession = createSigningSession({
      document_id: doc.document_id,
      signer_name: "Ada Lovelace",
      signer_type: "human",
      signing_order: 1,
    });
    const secondSession = createSigningSession({
      document_id: doc.document_id,
      signer_name: "Sagan",
      signer_type: "agent",
      agent_id: "agent-sagan",
      signing_order: 2,
    });

    await expect(signDocumentLocally({
      documentId: doc.document_id,
      signatureId: sig.id,
      sessionId: secondSession.id,
      signerType: "agent",
      page: 1,
      x: 45,
      y: 80,
    })).rejects.toThrow("cannot proceed before session");

    const first = await signDocumentLocally({
      documentId: doc.document_id,
      signatureId: sig.id,
      sessionId: firstSession.id,
      page: 1,
      x: 10,
      y: 80,
    });
    const firstCertificate = getSigningCertificateBySession(first.session.id);
    expect(firstCertificate.metadata?.["document_complete"]).toBe(false);
    expect(firstCertificate.metadata?.["certificate_kind"]).toBe("signer_evidence");
    expect(getDocumentByIdOrSlug(doc.document_id).status).toBe("pending");

    const second = await signDocumentLocally({
      documentId: doc.document_id,
      signatureId: sig.id,
      sessionId: secondSession.id,
      signerType: "agent",
      page: 1,
      x: 45,
      y: 80,
    });
    const secondCertificate = getSigningCertificateBySession(second.session.id);
    expect(secondCertificate.metadata?.["document_complete"]).toBe(true);
    expect(secondCertificate.metadata?.["certificate_kind"]).toBe("document_completion");
    expect(getDocumentByIdOrSlug(doc.document_id).status).toBe("completed");
  });

  test("records an agent input hash for the PDF the agent actually signs", async () => {
    const dir = mkdtempSync(join(tmpdir(), "signatures-"));
    const md = join(dir, "agent-input.md");
    writeFileSync(md, "# Agent Input\n\nClient: {{signature:client|type=human|role=Client|order=1}}\n\nReview: {{signature:review|type=agent|role=Reviewer|order=2}}\n");
    const doc = await createDocumentFromMarkdown({ filePath: md });
    const sig = createSignature({ name: "Signer", type: "text", text_value: "Signer" });
    const fields = listFieldsForDocument(doc.document_id);
    const client = fields.find((field) => field.role === "Client")!;
    const review = fields.find((field) => field.role === "Reviewer")!;

    const first = await signDocumentLocally({
      documentId: doc.document_id,
      signatureId: sig.id,
      fieldId: client.id,
      signerName: "Ada Lovelace",
      certificate: false,
    });
    const second = await signDocumentLocally({
      documentId: doc.document_id,
      signatureId: sig.id,
      fieldId: review.id,
      signerName: "Sagan",
      signerType: "agent",
      agentId: "agent-sagan",
    });

    expect(second.session.agent_input_hash).toBe(sha256File(first.output_path));
    expect(second.session.agent_input_hash).not.toBe(sha256File(getDocumentByIdOrSlug(doc.document_id).file_path));
    const certificate = getSigningCertificateBySession(second.session.id);
    expect((certificate.metadata?.["agent"] as Record<string, unknown> | undefined)?.["agent_input_hash"]).toBe(sha256File(first.output_path));
  });

  test("creates PandaDoc provider dry-run evidence", async () => {
    const dir = mkdtempSync(join(tmpdir(), "signatures-"));
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
    const dir = mkdtempSync(join(tmpdir(), "signatures-"));
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
    const dir = mkdtempSync(join(tmpdir(), "signatures-"));
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
    const dir = mkdtempSync(join(tmpdir(), "signatures-"));
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
