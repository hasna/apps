import { basename } from "node:path";
import { createDocument, getDocumentByIdOrSlug, updateDocument } from "../db/documents.js";
import { createProviderEvidence } from "../db/provider-evidence.js";
import { createSignatureField, getFieldById } from "../db/signature-fields.js";
import { createPlacement } from "../db/signature-placements.js";
import { getSignatureById } from "../db/signatures.js";
import {
  createSigningSession,
  getSessionById,
  updateSessionAttachment,
  updateSessionCompletion,
  updateSessionEvidence,
  updateSessionSigningUrl,
  updateSessionStatus,
} from "../db/signing-sessions.js";
import { createAuditEvent } from "../db/audit-events.js";
import { createPerson, getPersonByIdOrEmail } from "../db/people.js";
import { shareDocument } from "./attachments-integration.js";
import { createCompletionCertificate } from "./certificate.js";
import { sendSigningEmail } from "./email-integration.js";
import { renderMarkdownFileToPdf } from "./markdown-pdf.js";
import { signPdf } from "./pdf-signer.js";
import { assertSignatureLevel, sendWithProvider, type ProviderConnectorOptions, type ProviderRecipient, type ProviderSendResult } from "./provider-integration.js";
import { sha256File } from "./hash.js";
import type { Person, ProviderEvidence, SignatureLevel, SignaturePlacement, SigningSession, ValidationStatus } from "../types/index.js";

export interface MarkdownDocumentResult {
  document_id: string;
  document_path: string;
  html_path: string;
  fields: Array<{ id: string; anchor?: string; page: number; x: number; y: number; width?: number; height?: number }>;
}

export async function createDocumentFromMarkdown(input: {
  filePath: string;
  name?: string;
  variables?: Record<string, unknown>;
  signerName?: string;
  signerEmail?: string;
}): Promise<MarkdownDocumentResult> {
  const variables = {
    ...(input.variables ?? {}),
    signer: {
      name: input.signerName ?? input.variables?.["signer.name"],
      email: input.signerEmail ?? input.variables?.["signer.email"],
    },
  };
  const rendered = await renderMarkdownFileToPdf({ path: input.filePath, variables });
  const doc = createDocument({
    name: input.name ?? basename(input.filePath),
    file_path: rendered.pdf_path,
    file_name: basename(rendered.pdf_path),
    mime_type: "application/pdf",
    metadata: {
      source_markdown_path: input.filePath,
      rendered_html_path: rendered.html_path,
      variables,
    },
  });
  const fields = rendered.fields.map((field) => createSignatureField({
    document_id: doc.id,
    page: field.page,
    x: field.x,
    y: field.y,
    width: field.width,
    height: field.height,
    anchor: field.anchor,
    unit: "percent",
    label: field.anchor,
    field_type: "signature",
  }));
  createAuditEvent({
    document_id: doc.id,
    event_type: "document_rendered",
    message: "Rendered Markdown document to PDF",
    metadata: { source_markdown_path: input.filePath, rendered_html_path: rendered.html_path },
  });
  return {
    document_id: doc.id,
    document_path: rendered.pdf_path,
    html_path: rendered.html_path,
    fields: fields.map((field) => ({
      id: field.id,
      anchor: field.anchor,
      page: field.page,
      x: field.x,
      y: field.y,
      width: field.width,
      height: field.height,
    })),
  };
}

export async function signDocumentLocally(input: {
  documentId: string;
  signatureId: string;
  sessionId?: string;
  personIdOrEmail?: string;
  signerName?: string;
  signerEmail?: string;
  fieldId?: string;
  page?: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  certificate?: boolean;
}): Promise<{
  session: SigningSession;
  output_path: string;
  certificate_path?: string;
  placement_id: string;
  pages_signed: number[];
}> {
  const doc = getDocumentByIdOrSlug(input.documentId);
  const signature = getSignatureById(input.signatureId);
  const person = input.personIdOrEmail ? resolvePerson(input.personIdOrEmail) : undefined;
  const session = input.sessionId
    ? getSessionById(input.sessionId)
    : createSigningSession({
      document_id: doc.id,
      person_id: person?.id,
      signer_name: input.signerName ?? person?.name,
      signer_email: input.signerEmail ?? person?.email,
      source: "local",
      signature_level: "ses",
      validation_status: "not_applicable",
    });

  const placementInput = resolvePlacement({
    document_id: doc.id,
    signature_id: signature.id,
    fieldId: input.fieldId,
    page: input.page,
    x: input.x,
    y: input.y,
    width: input.width,
    height: input.height,
  });
  const placement = createPlacement(placementInput);
  const signed = await signPdf({
    document_path: doc.file_path,
    document_name: doc.file_name,
    placements: [{ placement, signature }],
  });
  updateDocument(doc.id, { status: "completed" });
  createAuditEvent({
    document_id: doc.id,
    session_id: session.id,
    event_type: "signed",
    actor_name: session.signer_name,
    actor_email: session.signer_email,
    message: `Signed document at placement ${placement.id}`,
    metadata: { output_path: signed.output_path, pages_signed: signed.pages_signed },
  });

  let certificatePath: string | undefined;
  if (input.certificate ?? true) {
    const completed = updateSessionStatus(session.id, "completed");
    const certificate = await createCompletionCertificate({
      document: doc,
      session: completed,
      signedDocumentPath: signed.output_path,
    });
    certificatePath = certificate.output_path;
    createAuditEvent({
      document_id: doc.id,
      session_id: session.id,
      event_type: "certificate_created",
      message: "Generated completion certificate",
      metadata: { certificate_id: certificate.certificate.id, certificate_path: certificate.output_path },
    });
  }

  const completedSession = updateSessionCompletion(session.id, {
    signed_document_path: signed.output_path,
    certificate_path: certificatePath,
    metadata: {
      signature_level: "ses",
      validation_status: "not_applicable",
      original_document_hash: sha256File(doc.file_path),
      signed_document_hash: sha256File(signed.output_path),
    },
  });

  return {
    session: completedSession,
    output_path: signed.output_path,
    certificate_path: certificatePath,
    placement_id: placement.id,
    pages_signed: signed.pages_signed,
  };
}

export async function sendDocumentWithProvider(input: {
  documentId: string;
  provider: string;
  apiKey?: string;
  recipient: ProviderRecipient;
  subject?: string;
  message?: string;
  silent?: boolean;
  documentUrl?: string;
  signatureLevel: SignatureLevel;
  connectors?: ProviderConnectorOptions;
  dryRun?: boolean;
}): Promise<{
  session: SigningSession;
  provider: ProviderSendResult;
  evidence: ProviderEvidence;
}> {
  const doc = getDocumentByIdOrSlug(input.documentId);
  const signatureLevel = assertSignatureLevel(input.signatureLevel);
  const session = createSigningSession({
    document_id: doc.id,
    signer_name: input.recipient.name,
    signer_email: input.recipient.email,
    source: "provider",
    connector_name: input.provider,
    signature_level: signatureLevel,
    provider_status: input.dryRun ? "prepared" : "sent",
    validation_status: validationStatusFor(signatureLevel),
    metadata: {
      provider: input.provider,
      dry_run: !!input.dryRun,
    },
  });
  const provider = await sendWithProvider({
    provider: input.provider,
    apiKey: input.apiKey,
    documentName: doc.name,
    documentPath: input.documentUrl ? undefined : doc.file_path,
    documentUrl: input.documentUrl,
    recipients: [input.recipient],
    subject: input.subject,
    message: input.message,
    silent: input.silent,
    signatureLevel,
    connectors: input.connectors,
    dryRun: input.dryRun,
  });
  const evidence = createProviderEvidence({
    document_id: doc.id,
    session_id: session.id,
    provider: provider.provider,
    connector_slug: provider.connector_slug,
    operation: provider.operation,
    signature_level: signatureLevel,
    status: provider.status === "dry_run" ? "prepared" : provider.status === "failed" ? "failed" : "sent",
    validation_status: provider.status === "dry_run" ? "pending" : validationStatusFor(signatureLevel),
    remote_document_id: provider.remote_document_id,
    remote_status: provider.remote_status,
    request: provider.request,
    response: provider.response,
    evidence: {
      dry_run: !!input.dryRun,
      provider_status: provider.status,
      error: provider.error,
      connector_slug: provider.connector_slug,
      operation: provider.operation,
    },
    original_document_hash: sha256File(doc.file_path),
  });
  const updated = updateSessionEvidence(session.id, {
    signature_level: signatureLevel,
    provider_status: evidence.status,
    validation_status: evidence.validation_status,
    metadata: {
      provider_evidence_id: evidence.id,
      provider: provider.provider,
      connector_slug: provider.connector_slug,
      operation: provider.operation,
      remote_document_id: provider.remote_document_id,
      provider_error: provider.error,
    },
  });
  createAuditEvent({
    document_id: doc.id,
    session_id: updated.id,
    event_type: provider.status === "failed" ? "provider_evidence_created" : "provider_sent",
    actor_name: input.recipient.name,
    actor_email: input.recipient.email,
    message: `${provider.provider} provider ${provider.status === "dry_run" ? "dry run prepared" : provider.status}`,
    metadata: {
      evidence_id: evidence.id,
      provider: provider.provider,
      connector_slug: provider.connector_slug,
      operation: provider.operation,
      signature_level: signatureLevel,
      validation_status: evidence.validation_status,
      error: provider.error,
    },
  });
  if (provider.status !== "dry_run" && provider.status !== "failed") {
    updateDocument(doc.id, { status: "pending" });
  }
  return { session: updated, provider, evidence };
}

export async function sendDocumentForSignature(input: {
  documentId: string;
  signerName?: string;
  signerEmail?: string;
  personIdOrEmail?: string;
  fromEmail?: string;
  baseUrl?: string;
  expiry?: string;
  dryRunEmail?: boolean;
}): Promise<{
  session: SigningSession;
  signing_url: string;
  share_link?: string;
  email?: ReturnType<typeof sendSigningEmail>;
}> {
  const doc = getDocumentByIdOrSlug(input.documentId);
  const person = input.personIdOrEmail ? resolvePerson(input.personIdOrEmail) : undefined;
  const signerName = input.signerName ?? person?.name;
  const signerEmail = input.signerEmail ?? person?.email;
  const session = createSigningSession({
    document_id: doc.id,
    person_id: person?.id,
    signer_name: signerName,
    signer_email: signerEmail,
    source: input.fromEmail ? "email" : "local",
  });
  const baseUrl = input.baseUrl ?? "http://localhost:19440";
  const signingUrl = `${baseUrl.replace(/\/$/, "")}/sign/${session.token}`;
  let updated = updateSessionSigningUrl(session.id, signingUrl);

  let shareLink: string | undefined;
  try {
    const shared = await shareDocument(doc.file_path, doc.file_name, { expiry: input.expiry ?? "7d" });
    updated = updateSessionAttachment(updated.id, {
      attachment_id: shared.attachmentId,
      share_link: shared.shareLink,
      share_expires_at: shared.expiresAt,
    });
    shareLink = shared.shareLink;
  } catch (error) {
    createAuditEvent({
      document_id: doc.id,
      session_id: updated.id,
      event_type: "session_created",
      message: "Created signing session without attachment share link",
      metadata: { share_error: error instanceof Error ? error.message : String(error) },
    });
  }

  let email: ReturnType<typeof sendSigningEmail> | undefined;
  if (input.fromEmail && signerEmail) {
    email = sendSigningEmail({
      from: input.fromEmail,
      to: signerEmail,
      signerName,
      documentName: doc.name,
      signingUrl,
      attachmentPath: doc.file_path,
      dryRun: input.dryRunEmail,
    });
    createAuditEvent({
      document_id: doc.id,
      session_id: updated.id,
      event_type: email.sent ? "email_sent" : "email_prepared",
      actor_name: signerName,
      actor_email: signerEmail,
      metadata: { ...email },
    });
  }

  updateDocument(doc.id, { status: "pending" });
  return { session: updated, signing_url: signingUrl, share_link: shareLink, email };
}

function validationStatusFor(level: SignatureLevel): ValidationStatus {
  return level === "ses" ? "not_applicable" : "pending";
}

function resolvePerson(idOrEmail: string): Person | undefined {
  try {
    return getPersonByIdOrEmail(idOrEmail);
  } catch {
    if (idOrEmail.includes("@")) {
      return createPerson({ name: idOrEmail.split("@")[0] ?? idOrEmail, email: idOrEmail });
    }
    throw new Error(`Person not found: ${idOrEmail}`);
  }
}

function resolvePlacement(input: {
  document_id: string;
  signature_id: string;
  fieldId?: string;
  page?: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}): Parameters<typeof createPlacement>[0] {
  if (input.fieldId) {
    const field = getFieldById(input.fieldId);
    if (field.document_id !== input.document_id) {
      throw new Error(`Field ${field.id} does not belong to document ${input.document_id}`);
    }
    return {
      document_id: input.document_id,
      signature_id: input.signature_id,
      field_id: field.id,
      page: field.page,
      x: input.x ?? field.x,
      y: input.y ?? field.y,
      width: input.width ?? field.width,
      height: input.height ?? field.height,
    };
  }
  return {
    document_id: input.document_id,
    signature_id: input.signature_id,
    page: input.page ?? 1,
    x: input.x ?? 10,
    y: input.y ?? 80,
    width: input.width,
    height: input.height,
  };
}
