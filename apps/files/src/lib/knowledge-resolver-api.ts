/**
 * Hosted knowledge-source resolution — the `/v1` half of `knowledge-resolver.ts`.
 *
 * The on-box resolver (`knowledge-resolver.ts`) opens the local SQLite island
 * and reaches S3 with station credentials; it is correct only for an opt-in
 * local run. On the hosted transport the files service already owns every
 * operation a knowledge resolution needs, and each one has a `/v1` route:
 *
 *   metadata        GET  /v1/files/{id}            (or GET /v1/files/by-path)
 *   content         GET  /v1/files/{id}/content
 *   extracted_text  POST /v1/files/{id}/extract-text
 *   snapshot        POST /v1/files/{id}/extract-text  (+ local snapshot framing)
 *   signed_url      POST /v1/files/{id}/sign-download
 *
 * So this module is pure composition over {@link ApiStore}: no `bun:sqlite`,
 * no `@aws-sdk/*`, no filesystem. It returns exactly the same
 * `KnowledgeSourceResolution` / `KnowledgeSourceDoctorReport` shapes as the
 * on-box path so the `knowledge` app consumes one contract on both transports.
 */
import { buildExtractionSnapshot } from "./extraction-snapshot.js";
import {
  actionsFor,
  addIssue,
  DOCTOR_DEFAULT_PURPOSE,
  doctorStatus,
  mapExtractionStatus,
  normalizeDoctorLimit,
  recommendationFor,
  sanitizeStorage,
  summarizeChecks,
  uniqueRefs,
} from "./knowledge-shared.js";
import { buildOpenFilesFileRef, parseOpenFilesSourceRef } from "./source-ref.js";
import type { ApiStore } from "../store/api-store.js";
import type {
  FileWithTags,
  KnowledgeSourceDoctorCheck,
  KnowledgeSourceDoctorIssueCode,
  KnowledgeSourceDoctorOptions,
  KnowledgeSourceDoctorReport,
  KnowledgeSourceResolution,
  KnowledgeSourceResolveMode,
  KnowledgeSourceResolverOptions,
  KnowledgeSourceResolveStatus,
} from "../types/index.js";

const DEFAULT_PURPOSE = "knowledge_index";
const DEFAULT_ALLOWED_PURPOSES = ["knowledge_index", "knowledge_answer", "agent_context"];
const DEFAULT_MAX_BYTES = 256 * 1024;
const MAX_BYTES_CEILING = 10 * 1024 * 1024;
const DEFAULT_SIGNED_URL_SECONDS = 600;
const MAX_SIGNED_URL_SECONDS = 3600;

/**
 * Resolve an `open-files://` ref against the hosted files service.
 *
 * Every byte and every extraction comes from a `/v1` route; the caller's
 * credential is the only authority involved.
 */
export async function resolveKnowledgeSourceRefViaApi(
  api: ApiStore,
  sourceRef: string,
  opts: KnowledgeSourceResolverOptions = {},
): Promise<KnowledgeSourceResolution> {
  const mode: KnowledgeSourceResolveMode = opts.mode ?? "metadata";
  const purpose = opts.purpose ?? DEFAULT_PURPOSE;
  const allowedPurposes = opts.allowed_purposes ?? DEFAULT_ALLOWED_PURPOSES;

  if (!allowedPurposes.includes(purpose)) {
    return bareResolution(
      sourceRef,
      "denied",
      `Purpose is not allowed for source resolution: ${purpose}`,
      purpose,
      allowedPurposes,
      mode,
    );
  }

  let file: FileWithTags | null;
  let requestedRevisionId: string | undefined;
  try {
    const parsed = parseOpenFilesSourceRef(sourceRef);
    if (parsed.kind === "asset") {
      // Evidence assets have their own hosted family (`/v1/evidence/assets`)
      // with a different value shape; the resolver does not model them here
      // rather than inventing fields the service does not return.
      return bareResolution(
        sourceRef,
        "unsupported",
        "Evidence asset refs are resolved through the evidence commands on the hosted transport.",
        purpose,
        allowedPurposes,
        mode,
      );
    }
    if (parsed.kind === "file") {
      requestedRevisionId = parsed.revision_id;
      file = await api.getFile(parsed.file_id);
      if (!file) {
        return bareResolution(sourceRef, "not_found", `File not found: ${parsed.file_id}`, purpose, allowedPurposes, mode);
      }
    } else {
      file = await api.getFileByPath(parsed.source_id, parsed.path);
      if (!file) {
        return bareResolution(sourceRef, "not_found", `File not found for ref: ${sourceRef}`, purpose, allowedPurposes, mode);
      }
    }
  } catch (error) {
    return bareResolution(sourceRef, "error", errorMessage(error), purpose, allowedPurposes, mode);
  }

  const resolvedRef = requestedRevisionId ? sourceRef : buildOpenFilesFileRef(file.id);
  const base: KnowledgeSourceResolution = {
    source_ref: resolvedRef,
    requested_ref: sourceRef,
    file_id: file.id,
    revision_id: requestedRevisionId,
    source_id: file.source_id,
    path: file.path,
    name: file.name,
    status: "ready",
    // The hosted service owns the object store; the client is never told which
    // bucket or key backs a file, so the provider is reported as remote-opaque
    // rather than guessed.
    storage: { provider: "unknown", source_id: file.source_id },
    content: {
      mime: file.mime,
      size: file.size,
      hash: file.hash,
      text_available: false,
    },
    permissions: {
      mode: "read_only",
      purpose,
      requested_mode: mode,
      allowed_purposes: allowedPurposes,
      write: false,
    },
    updated_at: file.modified_at ?? file.indexed_at,
    deleted: file.status === "deleted",
  };

  if (base.deleted && mode !== "metadata") {
    return { ...base, status: "denied", status_reason: "File is deleted." };
  }

  try {
    switch (mode) {
      case "metadata":
        return base;
      case "content":
        return await resolveContentViaApi(api, base, opts);
      case "extracted_text":
        return await resolveExtractedTextViaApi(api, base, opts, false);
      case "snapshot":
        return await resolveExtractedTextViaApi(api, base, opts, true);
      case "signed_url":
        return await resolveSignedUrlViaApi(api, base, opts);
      default:
        return { ...base, status: "unsupported", status_reason: `Unsupported resolve mode: ${String(mode)}` };
    }
  } catch (error) {
    return { ...base, status: "error", status_reason: errorMessage(error) };
  }
}

/** `extracted_text` mode as a standalone hosted call (`resolve_extracted_text`). */
export async function resolveExtractedTextRefViaApi(
  api: ApiStore,
  sourceRef: string,
  opts: KnowledgeSourceResolverOptions = {},
): Promise<KnowledgeSourceResolution> {
  return resolveKnowledgeSourceRefViaApi(api, sourceRef, { ...opts, mode: "extracted_text" });
}

async function resolveContentViaApi(
  api: ApiStore,
  base: KnowledgeSourceResolution,
  opts: KnowledgeSourceResolverOptions,
): Promise<KnowledgeSourceResolution> {
  const maxBytes = normalizeMaxBytes(opts.max_bytes);
  if (opts.allowed_mimes?.length && !opts.allowed_mimes.includes(base.content.mime)) {
    return { ...base, status: "denied", status_reason: `Mime is not allowed for this purpose: ${base.content.mime}` };
  }

  const chunks: Uint8Array[] = [];
  let read = 0;
  let clipped = false;
  const result = await api.downloadFileContent(base.file_id!, (chunk) => {
    if (clipped || read >= maxBytes) {
      clipped = true;
      return;
    }
    const remaining = maxBytes - read;
    if (chunk.byteLength > remaining) {
      chunks.push(chunk.subarray(0, remaining));
      read += remaining;
      clipped = true;
    } else {
      chunks.push(chunk);
      read += chunk.byteLength;
    }
  }, { max_bytes: maxBytes });

  const truncated = clipped || result.truncated;
  const bytes = Buffer.concat(chunks);
  const text = bytes.toString("utf8");
  // A UTF-8 decode of binary bytes yields replacement characters; a truncated
  // read can also split a multi-byte codepoint at the tail, which is expected
  // and not a binary signal.
  const binary = looksBinary(text, truncated);

  if (binary && !opts.allow_binary) {
    return {
      ...base,
      status: "unsupported",
      status_reason: "File content is not readable as text.",
      content: {
        ...base.content,
        size: result.totalBytes ?? base.content.size,
        text_available: false,
        bytes_read: bytes.byteLength,
        truncated,
      },
    };
  }

  const redacted = applyRedactions(text, opts);
  return {
    ...base,
    status: truncated ? "too_large" : "ready",
    status_reason: truncated ? `Content exceeded ${maxBytes} bytes and was truncated.` : undefined,
    content: {
      ...base.content,
      size: result.totalBytes ?? base.content.size,
      text_available: true,
      bytes_read: bytes.byteLength,
      truncated,
      encoding: "utf-8",
      text: redacted,
    },
  };
}

async function resolveExtractedTextViaApi(
  api: ApiStore,
  base: KnowledgeSourceResolution,
  opts: KnowledgeSourceResolverOptions,
  asSnapshot: boolean,
): Promise<KnowledgeSourceResolution> {
  const extraction = await api.extractFileText(base.file_id!, {
    max_bytes: normalizeMaxBytes(opts.max_bytes),
    max_segment_chars: opts.max_segment_chars,
    redact_patterns: redactSources(opts),
  });
  const status = mapExtractionStatus(extraction);
  const content: KnowledgeSourceResolution["content"] = {
    ...base.content,
    mime: extraction.mime || base.content.mime,
    size: extraction.total_size ?? base.content.size,
    text_available: extraction.status === "ready" || extraction.status === "too_large",
    bytes_read: extraction.bytes_read,
    truncated: extraction.truncated,
    extraction: {
      status: extraction.status,
      extractor: extraction.metadata.extractor,
      bytes_read: extraction.bytes_read,
      truncated: extraction.truncated,
    },
  };

  if (!asSnapshot) {
    return { ...base, status, status_reason: extraction.status_reason, content, extracted_text: extraction };
  }

  const snapshot = buildExtractionSnapshot(extraction);
  return {
    ...base,
    status,
    status_reason: extraction.status_reason,
    content: { ...content, extraction: { ...content.extraction!, snapshot_id: snapshot.snapshot_id } },
    snapshot,
  };
}

async function resolveSignedUrlViaApi(
  api: ApiStore,
  base: KnowledgeSourceResolution,
  opts: KnowledgeSourceResolverOptions,
): Promise<KnowledgeSourceResolution> {
  const expiresIn = normalizeExpiresIn(opts.signed_url_expires_in);
  const url = await api.signFileDownload(base.file_id!, expiresIn);
  return {
    ...base,
    access: {
      kind: "signed_url",
      method: "GET",
      url,
      expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
    },
  };
}

/**
 * Hosted `knowledge doctor` / `doctor_knowledge_sources`.
 *
 * Refs come either from the caller or from `GET /v1/files` (the same filter
 * surface the on-box doctor gets from the local manifest); each ref is then
 * checked with the hosted resolver above.
 */
export async function doctorKnowledgeSourcesViaApi(
  api: ApiStore,
  opts: KnowledgeSourceDoctorOptions = {},
): Promise<KnowledgeSourceDoctorReport> {
  const generatedAt = new Date().toISOString();
  const purpose = opts.purpose ?? DOCTOR_DEFAULT_PURPOSE;
  const requireExtractedText = opts.require_extracted_text ?? true;
  const checkExtractedText = opts.check_extracted_text ?? false;
  const limit = normalizeDoctorLimit(opts.limit);

  let refs: string[];
  if (opts.source_refs?.length) {
    refs = uniqueRefs(opts.source_refs).slice(0, limit);
  } else {
    const files = await api.listFiles({
      source_id: opts.source_id,
      collection_id: opts.collection_id,
      project_id: opts.project_id,
      tag: opts.tag,
      status: opts.status === "all" ? undefined : opts.status,
      limit,
    });
    refs = files.map((file) => buildOpenFilesFileRef(file.id));
  }

  const checks: KnowledgeSourceDoctorCheck[] = [];
  for (const sourceRef of refs) {
    checks.push(await doctorRefViaApi(api, sourceRef, {
      ...opts,
      purpose,
      require_extracted_text: requireExtractedText,
      check_extracted_text: checkExtractedText,
    }));
  }

  return {
    generated_at: generatedAt,
    purpose,
    require_extracted_text: requireExtractedText,
    check_extracted_text: checkExtractedText,
    checked_count: checks.length,
    summary: summarizeChecks(checks),
    checks,
  };
}

async function doctorRefViaApi(
  api: ApiStore,
  sourceRef: string,
  opts: KnowledgeSourceDoctorOptions & {
    purpose: string;
    require_extracted_text: boolean;
    check_extracted_text: boolean;
  },
): Promise<KnowledgeSourceDoctorCheck> {
  const checkedAt = new Date().toISOString();
  const resolution = await resolveKnowledgeSourceRefViaApi(api, sourceRef, {
    mode: "metadata",
    purpose: opts.purpose,
    allowed_purposes: opts.allowed_purposes,
  });
  const issueCodes: KnowledgeSourceDoctorIssueCode[] = [];

  if (resolution.status === "not_found") addIssue(issueCodes, "not_found");
  if (resolution.status === "denied") addIssue(issueCodes, "denied");
  if (resolution.status === "unsupported") addIssue(issueCodes, "unsupported");
  if (resolution.status === "error") addIssue(issueCodes, "error");
  if (resolution.deleted) addIssue(issueCodes, "deleted");

  let extractionStatus = resolution.content.extraction?.status;
  // On the hosted transport `text_available` is not part of file metadata —
  // the service answers "is there extracted text" only by extracting. So when
  // extracted text is REQUIRED the hosted doctor always asks (one
  // POST /v1/files/{id}/extract-text per ref) rather than inferring an answer
  // the server never sent. `check_extracted_text` is a no-op here: it exists
  // on the on-box path to opt into work the local store can otherwise skip.
  const resolvable = resolution.status === "ready" && !resolution.deleted && resolution.file_id !== undefined;
  if (opts.require_extracted_text && resolvable) {
    // The metadata above already identified the file, so extract directly
    // rather than re-resolving the ref (one round trip per ref, not two).
    try {
      const extraction = await api.extractFileText(resolution.file_id!, {
        max_bytes: opts.max_bytes,
        max_segment_chars: opts.max_segment_chars,
      });
      extractionStatus = extraction.status;
      const mapped = mapExtractionStatus(extraction);
      if (mapped !== "ready" && mapped !== "too_large") addIssue(issueCodes, "missing_extracted_text");
    } catch {
      addIssue(issueCodes, "missing_extracted_text");
    }
  } else if (opts.require_extracted_text) {
    addIssue(issueCodes, "missing_extracted_text");
  }

  const status = doctorStatus(issueCodes);
  return {
    source_ref: sourceRef,
    requested_ref: resolution.requested_ref,
    resolved_ref: resolution.source_ref !== sourceRef ? resolution.source_ref : undefined,
    resolvable: resolution.status !== "not_found" && resolution.status !== "error",
    status,
    resolution_status: resolution.status,
    status_reason: resolution.status_reason,
    recommendation: recommendationFor(issueCodes),
    actions: actionsFor(issueCodes),
    issue_codes: issueCodes,
    file_id: resolution.file_id,
    revision_id: resolution.revision_id,
    source_id: resolution.source_id,
    path: resolution.path,
    deleted: resolution.deleted,
    // Revision staleness is a property of the local version table; the hosted
    // service exposes no revision history route, so it is reported as false
    // rather than guessed from metadata the server did not send.
    stale: false,
    content: {
      mime: resolution.content.mime,
      size: resolution.content.size,
      hash: resolution.content.hash,
      text_available: resolution.content.text_available,
      extracted_text_ref: resolution.content.extracted_text_ref,
      extraction_status: extractionStatus,
    },
    storage: sanitizeStorage(resolution.storage),
    checked_at: checkedAt,
  };
}

function bareResolution(
  sourceRef: string,
  status: KnowledgeSourceResolveStatus,
  reason: string,
  purpose: string,
  allowedPurposes: string[],
  mode: KnowledgeSourceResolveMode,
): KnowledgeSourceResolution {
  return {
    source_ref: sourceRef,
    requested_ref: sourceRef,
    status,
    status_reason: reason,
    content: { mime: "application/octet-stream", text_available: false },
    permissions: {
      mode: "read_only",
      purpose,
      requested_mode: mode,
      allowed_purposes: allowedPurposes,
      write: false,
    },
    deleted: false,
  };
}

function applyRedactions(text: string, opts: KnowledgeSourceResolverOptions): string {
  let out = opts.redactor ? opts.redactor(text) : text;
  for (const pattern of opts.redact_patterns ?? []) {
    out = out.replace(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`), "[REDACTED]");
  }
  return out;
}

function redactSources(opts: KnowledgeSourceResolverOptions): string[] | undefined {
  if (!opts.redact_patterns?.length) return undefined;
  return opts.redact_patterns.map((pattern) => pattern.source);
}

function looksBinary(text: string, truncated: boolean): boolean {
  const replacements = (text.match(/�/g) ?? []).length;
  if (replacements === 0) return false;
  // Allow up to 3 trailing replacement chars from a cut multi-byte codepoint.
  if (truncated && replacements <= 3) return false;
  return replacements > Math.max(1, Math.floor(text.length * 0.01));
}

function normalizeMaxBytes(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_MAX_BYTES;
  return Math.min(Math.max(Math.floor(value), 1), MAX_BYTES_CEILING);
}

function normalizeExpiresIn(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_SIGNED_URL_SECONDS;
  return Math.min(Math.max(Math.floor(value), 1), MAX_SIGNED_URL_SECONDS);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
