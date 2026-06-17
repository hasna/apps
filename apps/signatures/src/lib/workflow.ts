import { createHash } from "node:crypto";
import { basename } from "node:path";
import { createDocument, getDocumentByIdOrSlug, updateDocument } from "../db/documents.js";
import { createProviderEvidence } from "../db/provider-evidence.js";
import { createSignatureField, getFieldById, listFieldsForDocument, updateFieldRecipientStatus } from "../db/signature-fields.js";
import { createPlacement } from "../db/signature-placements.js";
import { getSignatureById } from "../db/signatures.js";
import {
  createSigningSession,
  getSessionById,
  listSessionsForDocument,
  updateSessionAttachment,
  updateSessionCompletion,
  updateSessionEvidence,
  updateSessionRouting,
  updateSessionSigningUrl,
  updateSessionStatus,
} from "../db/signing-sessions.js";
import { createAuditEvent } from "../db/audit-events.js";
import { assertSignerType, createPerson, getPersonByIdOrEmail } from "../db/people.js";
import { shareDocument } from "./attachments-integration.js";
import { createCompletionCertificate } from "./certificate.js";
import { sendSigningEmail } from "./email-integration.js";
import { renderMarkdownFileToPdf } from "./markdown-pdf.js";
import { signPdf } from "./pdf-signer.js";
import { assertSignatureLevel, sendWithProvider, type ProviderConnectorOptions, type ProviderRecipient, type ProviderSendResult } from "./provider-integration.js";
import { sha256File } from "./hash.js";
import type { Person, ProviderEvidence, Signature, SignatureLevel, SignaturePlacement, SignerType, SigningSession, ValidationStatus } from "../types/index.js";

export interface MarkdownDocumentResult {
  document_id: string;
  document_path: string;
  html_path: string;
  fields: Array<{
    id: string;
    anchor?: string;
    page: number;
    x: number;
    y: number;
    width?: number;
    height?: number;
    signer_type?: SignerType;
    role?: string;
    assigned_to?: string;
    signing_order?: number;
    parallel_group?: number;
  }>;
}

export async function createDocumentFromMarkdown(input: {
  filePath: string;
  name?: string;
  variables?: Record<string, unknown>;
  signerName?: string;
  signerEmail?: string;
  signerType?: SignerType;
}): Promise<MarkdownDocumentResult> {
  const inputVariables = input.variables ?? {};
  const signerVariables = getObjectPathValue(inputVariables, "signer");
  const variables = {
    ...inputVariables,
    signer: {
      ...signerVariables,
      name: input.signerName ?? getPathValue(inputVariables, "signer.name"),
      email: input.signerEmail ?? getPathValue(inputVariables, "signer.email"),
      type: input.signerType ?? getPathValue(inputVariables, "signer.type") ?? "human",
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
  const defaultSignerType = assertSignerType(input.signerType ?? getPathValue(inputVariables, "signer.type") ?? "human");
  const fields = rendered.fields.map((field) => {
    const routing = parseAnchorRouting(field.anchor, defaultSignerType);
    const signerType = assertSignerType(field.signer_type ?? routing.signer_type);
    const role = field.role ?? routing.role ?? field.anchor;
    const signingOrder = field.signing_order ?? routing.signing_order;
    return createSignatureField({
      document_id: doc.id,
      page: field.page,
      x: field.x,
      y: field.y,
      width: field.width,
      height: field.height,
      anchor: field.anchor,
      unit: "percent",
      label: role ?? field.anchor,
      field_type: "signature",
      assigned_to: field.assigned_to ?? role,
      signer_type: signerType,
      role,
      signing_order: signingOrder,
      parallel_group: field.parallel_group ?? routing.parallel_group,
      required: field.required,
      recipient_status: field.recipient_status ?? "pending",
    });
  });
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
      signer_type: field.signer_type,
      role: field.role,
      assigned_to: field.assigned_to,
      signing_order: field.signing_order,
      parallel_group: field.parallel_group,
    })),
  };
}

function getPathValue(source: Record<string, unknown>, path: string): unknown {
  let current: unknown = source;
  for (const part of path.split(".")) {
    if (!current || typeof current !== "object" || !(part in current)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function getObjectPathValue(source: Record<string, unknown>, path: string): Record<string, unknown> {
  const value = getPathValue(source, path);
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export async function signDocumentLocally(input: {
  documentId: string;
  signatureId: string;
  sessionId?: string;
  personIdOrEmail?: string;
  signerName?: string;
  signerEmail?: string;
  signerType?: SignerType;
  agentId?: string;
  agentProvider?: string;
  agentRunId?: string;
  agentThreadId?: string;
  agentPolicyId?: string;
  agentReason?: string;
  agentInputHash?: string;
  agentOutputHash?: string;
  role?: string;
  signingOrder?: number;
  parallelGroup?: number;
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
  const field = input.fieldId ? getFieldById(input.fieldId) : undefined;
  if (field && field.document_id !== doc.id) {
    throw new Error(`Field ${field.id} does not belong to document ${doc.id}`);
  }
  const existingSession = input.sessionId ? getSessionById(input.sessionId) : undefined;
  const signerType = assertSignerType(input.signerType ?? person?.signer_type ?? existingSession?.signer_type ?? field?.signer_type ?? "human");
  const role = input.role ?? existingSession?.role ?? field?.role ?? field?.anchor;
  const signingOrder = input.signingOrder ?? existingSession?.signing_order ?? field?.signing_order;
  const parallelGroup = input.parallelGroup ?? existingSession?.parallel_group ?? field?.parallel_group ?? signingOrder;
  const agentMetadata = signerType === "agent" ? {
    agent_id: input.agentId ?? person?.agent_id ?? existingSession?.agent_id ?? person?.id,
    agent_provider: input.agentProvider ?? person?.agent_provider ?? existingSession?.agent_provider,
    agent_run_id: input.agentRunId ?? existingSession?.agent_run_id,
    agent_thread_id: input.agentThreadId ?? existingSession?.agent_thread_id,
    agent_policy_id: input.agentPolicyId ?? existingSession?.agent_policy_id,
    agent_reason: input.agentReason ?? existingSession?.agent_reason,
    input_hash: input.agentInputHash ?? existingSession?.agent_input_hash ?? sha256File(doc.file_path),
  } : undefined;
  const session = existingSession
    ? updateSessionRouting(existingSession.id, {
      person_id: person?.id,
      signer_name: input.signerName ?? person?.name ?? existingSession.signer_name,
      signer_email: input.signerEmail ?? person?.email ?? existingSession.signer_email,
      signer_type: signerType,
      agent_id: agentMetadata?.agent_id,
      agent_provider: agentMetadata?.agent_provider,
      agent_run_id: agentMetadata?.agent_run_id,
      agent_thread_id: agentMetadata?.agent_thread_id,
      agent_policy_id: agentMetadata?.agent_policy_id,
      agent_reason: agentMetadata?.agent_reason,
      agent_input_hash: agentMetadata?.input_hash,
      field_id: field?.id,
      role,
      signing_order: signingOrder,
      parallel_group: parallelGroup,
      recipient_status: "available",
      metadata: { signer_type: signerType, role, field_anchor: field?.anchor, agent: agentMetadata },
    })
    : createSigningSession({
      document_id: doc.id,
      person_id: person?.id,
      signer_name: input.signerName ?? person?.name,
      signer_email: input.signerEmail ?? person?.email,
      signer_type: signerType,
      agent_id: agentMetadata?.agent_id,
      agent_provider: agentMetadata?.agent_provider,
      agent_run_id: agentMetadata?.agent_run_id,
      agent_thread_id: agentMetadata?.agent_thread_id,
      agent_policy_id: agentMetadata?.agent_policy_id,
      agent_reason: agentMetadata?.agent_reason,
      agent_input_hash: agentMetadata?.input_hash,
      field_id: field?.id,
      role,
      signing_order: signingOrder,
      parallel_group: parallelGroup,
      recipient_status: "available",
      source: "local",
      signature_level: "ses",
      validation_status: "not_applicable",
      metadata: {
        signer_type: signerType,
        role,
        field_anchor: field?.anchor,
        agent: agentMetadata,
      },
    });
  const effectiveSignerType = session.signer_type ?? signerType;

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
  const visualSignature = effectiveSignerType === "agent"
    ? buildAgentAttestationSignature(signature, session)
    : signature;
  const baseDocumentPath = latestSignedDocumentPath(doc.id, session.id) ?? doc.file_path;
  const signed = await signPdf({
    document_path: baseDocumentPath,
    document_name: doc.file_name,
    placements: [{ placement, signature: visualSignature }],
  });
  if (field) updateFieldRecipientStatus(field.id, "signed");
  createAuditEvent({
    document_id: doc.id,
    session_id: session.id,
    event_type: "signed",
    actor_name: session.signer_name,
    actor_email: session.signer_email,
    actor_signer_type: effectiveSignerType,
    actor_agent_id: session.agent_id,
    message: `Signed document at placement ${placement.id}`,
    metadata: {
      output_path: signed.output_path,
      pages_signed: signed.pages_signed,
      signer_type: effectiveSignerType,
      agent: effectiveSignerType === "agent" ? sessionAgentMetadata(session) : undefined,
    },
  });

  const originalHash = sha256File(doc.file_path);
  const signedHash = sha256File(signed.output_path);
  const sessionForCompletion = effectiveSignerType === "agent"
    ? updateSessionRouting(session.id, {
      agent_output_hash: input.agentOutputHash ?? signedHash,
      metadata: {
        agent: {
          ...sessionAgentMetadata(session),
          input_hash: session.agent_input_hash,
          output_hash: input.agentOutputHash ?? signedHash,
        },
      },
    })
    : session;

  let certificatePath: string | undefined;
  if (input.certificate ?? true) {
    const completed = updateSessionStatus(sessionForCompletion.id, "completed");
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
      actor_signer_type: effectiveSignerType,
      actor_agent_id: effectiveSignerType === "agent" ? session.agent_id : undefined,
      metadata: {
        certificate_id: certificate.certificate.id,
        certificate_path: certificate.output_path,
        signer_type: effectiveSignerType,
      },
    });
  }

  const completedSession = updateSessionCompletion(session.id, {
    signed_document_path: signed.output_path,
    certificate_path: certificatePath,
    metadata: {
      ...(session.metadata ?? {}),
      signature_level: "ses",
      validation_status: "not_applicable",
      signer_type: effectiveSignerType,
      agent: effectiveSignerType === "agent" ? {
        ...sessionAgentMetadata(sessionForCompletion),
        input_hash: sessionForCompletion.agent_input_hash,
        output_hash: input.agentOutputHash ?? signedHash,
      } : undefined,
      original_document_hash: originalHash,
      signed_document_hash: signedHash,
    },
  });
  updateDocumentAfterSessionChange(doc.id, field?.id);

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
  signerType?: SignerType;
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
    signer_type: input.signerType ?? "human",
    role: input.recipient.role,
    recipient_status: input.dryRun ? "pending" : "available",
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
    signer_type: input.signerType ?? "human",
    recipient_role: input.recipient.role,
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
    actor_signer_type: input.signerType ?? "human",
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
  signerType?: SignerType;
  agentId?: string;
  agentProvider?: string;
  agentRunId?: string;
  agentThreadId?: string;
  agentPolicyId?: string;
  agentReason?: string;
  role?: string;
  signingOrder?: number;
  parallelGroup?: number;
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
  const signerType = assertSignerType(input.signerType ?? person?.signer_type ?? "human");
  const session = createSigningSession({
    document_id: doc.id,
    person_id: person?.id,
    signer_name: signerName,
    signer_email: signerEmail,
    signer_type: signerType,
    agent_id: input.agentId ?? person?.agent_id,
    agent_provider: input.agentProvider ?? person?.agent_provider,
    agent_run_id: input.agentRunId,
    agent_thread_id: input.agentThreadId,
    agent_policy_id: input.agentPolicyId,
    agent_reason: input.agentReason,
    agent_input_hash: input.agentReason ? sha256String(input.agentReason) : undefined,
    role: input.role,
    signing_order: input.signingOrder,
    parallel_group: input.parallelGroup,
    recipient_status: "available",
    source: input.fromEmail ? "email" : "local",
    metadata: {
      signer_type: signerType,
      agent: signerType === "agent" ? {
        agent_id: input.agentId ?? person?.agent_id,
        agent_provider: input.agentProvider ?? person?.agent_provider,
        agent_run_id: input.agentRunId,
        agent_thread_id: input.agentThreadId,
        agent_policy_id: input.agentPolicyId,
        agent_reason: input.agentReason,
      } : undefined,
    },
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
      actor_signer_type: signerType,
      actor_agent_id: signerType === "agent" ? session.agent_id : undefined,
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
      actor_signer_type: signerType,
      actor_agent_id: signerType === "agent" ? session.agent_id : undefined,
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

function updateDocumentAfterSessionChange(documentId: string, signedFieldId?: string): void {
  const fields = listFieldsForDocument(documentId).filter((field) => field.required);
  if (fields.length > 0) {
    const allSigned = fields.every((field) => field.id === signedFieldId || field.recipient_status === "signed");
    updateDocument(documentId, { status: allSigned ? "completed" : "signed" });
    return;
  }
  const sessions = listSessionsForDocument(documentId);
  const open = sessions.some((session) => !["completed", "signed", "skipped"].includes(session.status));
  updateDocument(documentId, { status: open ? "pending" : "completed" });
}

function latestSignedDocumentPath(documentId: string, currentSessionId: string): string | undefined {
  return listSessionsForDocument(documentId)
    .filter((session) => session.id !== currentSessionId && session.signed_document_path)
    .sort((a, b) => (b.completed_at ?? b.updated_at).localeCompare(a.completed_at ?? a.updated_at))[0]
    ?.signed_document_path;
}

function sessionAgentMetadata(session: SigningSession): Record<string, unknown> {
  return {
    agent_id: session.agent_id,
    agent_provider: session.agent_provider,
    agent_run_id: session.agent_run_id,
    agent_thread_id: session.agent_thread_id,
    agent_policy_id: session.agent_policy_id,
    agent_reason: session.agent_reason,
    input_hash: session.agent_input_hash,
    output_hash: session.agent_output_hash,
  };
}

function sha256String(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function parseAnchorRouting(anchor: string | undefined, defaultSignerType: SignerType): {
  signer_type: SignerType;
  role?: string;
  signing_order: number;
  parallel_group: number;
} {
  const parts = (anchor ?? "signature").split("|").map((part) => part.trim()).filter(Boolean);
  let role = parts[0] ?? "signature";
  const options = new Map<string, string>();
  for (const part of parts.slice(1)) {
    const eq = part.indexOf("=");
    if (eq > 0) options.set(part.slice(0, eq).trim().toLowerCase(), part.slice(eq + 1).trim());
  }

  let signerType = assertSignerType(options.get("type") ?? options.get("signer_type") ?? defaultSignerType);
  if (role.startsWith("agent:")) {
    signerType = "agent";
    role = role.slice("agent:".length) || "agent";
  } else if (role.startsWith("human:")) {
    signerType = "human";
    role = role.slice("human:".length) || "human";
  }
  role = options.get("role") ?? role;

  const signingOrder = parsePositiveInt(options.get("order") ?? options.get("signing_order"), 1);
  return {
    signer_type: signerType,
    role,
    signing_order: signingOrder,
    parallel_group: parsePositiveInt(options.get("group") ?? options.get("parallel_group"), signingOrder),
  };
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function buildAgentAttestationSignature(signature: Signature, session: SigningSession): Signature {
  const label = session.signer_name ?? session.agent_id ?? "agent";
  const run = session.agent_run_id ? ` run ${session.agent_run_id}` : "";
  return {
    ...signature,
    type: "text",
    font_family: "Helvetica",
    font_size: Math.min(signature.font_size ?? 18, 14),
    color: "#1f2937",
    text_value: `Agent attestation: ${label}${run}`,
    image_path: undefined,
  };
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
