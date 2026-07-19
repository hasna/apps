import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import type {
  ExportDetail,
  ExportFormat,
  ExportMessagesOptions,
  MessageExportArtifact,
} from "../types.js";
import { getDataDir } from "./db.js";
import {
  resolveCollectionLimit,
  resolveCollectionMaxBytes,
  resolveCollectionPreviewBytes,
  resolveCollectionTimeoutMs,
} from "./message-previews.js";

export interface ResolvedExportOptions {
  format: ExportFormat;
  detail: ExportDetail;
  limit: number;
  maxBytes: number;
  previewBytes: number;
  timeoutMs: number;
}

export interface SerializedMessageExport {
  payload: string;
  count: number;
  hasMore: boolean;
  skippedCount: number;
}

interface StoredExportMetadata {
  owner_principal: string;
  artifact: MessageExportArtifact;
}

export interface LoadedMessageExportArtifact {
  artifact: MessageExportArtifact;
  payload: Uint8Array;
  contentType: string;
}

function validateDate(value: string | undefined, name: string): void {
  if (value !== undefined && !Number.isFinite(Date.parse(value))) {
    throw new Error(`${name} must be a valid ISO 8601 date`);
  }
}

export function resolveMessageExportOptions(opts: ExportMessagesOptions = {}): ResolvedExportOptions {
  const format = opts.format ?? "json";
  if (format !== "json" && format !== "csv") throw new Error("format must be json or csv");
  const detail = opts.detail ?? "preview";
  if (detail !== "preview" && detail !== "full") throw new Error("detail must be preview or full");
  validateDate(opts.since, "since");
  validateDate(opts.until, "until");
  if (opts.since && opts.until && Date.parse(opts.since) > Date.parse(opts.until)) {
    throw new Error("since must not be later than until");
  }
  if (detail === "full") {
    const authorization = opts.authorization;
    if (
      authorization?.acknowledged !== true
      || !authorization.principal?.trim()
      || !authorization.reason?.trim()
    ) {
      throw new Error("full export requires principal-bound authorization, a reason, and acknowledged=true");
    }
  }
  return {
    format,
    detail,
    limit: resolveCollectionLimit(opts.limit),
    maxBytes: resolveCollectionMaxBytes(opts.max_bytes),
    previewBytes: resolveCollectionPreviewBytes(opts.preview_bytes),
    timeoutMs: resolveCollectionTimeoutMs(opts.timeout_ms),
  };
}

function csv(value: unknown): string {
  if (value === null || value === undefined) return "";
  const raw = typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\n\r]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}

function csvColumns(detail: ExportDetail): string[] {
  return detail === "preview"
    ? [
        "id", "session_id", "from_agent", "to_agent", "channel", "project_id", "preview",
        "priority", "created_at", "unread", "blocking", "truncated", "redacted",
      ]
    : [
        "id", "uuid", "session_id", "from_agent", "to_agent", "channel", "project_id", "content",
        "priority", "created_at", "read_at", "blocking", "reply_to", "working_dir", "repository",
        "branch", "metadata", "attachments", "edited_at", "pinned_at",
      ];
}

function serializeRecords(records: Array<Record<string, unknown>>, format: ExportFormat, detail: ExportDetail): string {
  if (format === "json") return JSON.stringify(records, null, 2);
  const columns = csvColumns(detail);
  return [columns.join(","), ...records.map((row) => columns.map((column) => csv(row[column])).join(","))].join("\n");
}

/**
 * Serialize only complete records that fit the byte budget. The export never
 * truncates a full body in place: if the next record does not fit, it is left
 * for a narrower filter or an exact-id read.
 */
export function serializeMessageExport(
  records: Array<Record<string, unknown>>,
  options: { format: ExportFormat; detail: ExportDetail; maxBytes: number; hasMore?: boolean },
): SerializedMessageExport {
  const included: Array<Record<string, unknown>> = [];
  let skippedCount = 0;
  for (const record of records) {
    const candidate = serializeRecords([...included, record], options.format, options.detail);
    if (Buffer.byteLength(candidate, "utf8") > options.maxBytes) {
      skippedCount += 1;
      break;
    }
    included.push(record);
  }
  const payload = serializeRecords(included, options.format, options.detail);
  if (Buffer.byteLength(payload, "utf8") > options.maxBytes) {
    throw new Error(`export artifact exceeds max_bytes (${Buffer.byteLength(payload, "utf8")} > ${options.maxBytes})`);
  }
  return {
    payload,
    count: included.length,
    hasMore: options.hasMore === true || skippedCount > 0,
    skippedCount,
  };
}

export function getMessageExportDir(): string {
  const configured = process.env.HASNA_CONVERSATIONS_EXPORT_DIR ?? process.env.CONVERSATIONS_EXPORT_DIR;
  return resolve(configured?.trim() || join(getDataDir(), "exports"));
}

export function writeMessageExportArtifact(
  serialized: SerializedMessageExport,
  options: ResolvedExportOptions,
  ownerPrincipal: string,
  exposure: "local" | "remote",
): MessageExportArtifact {
  const owner = ownerPrincipal.trim();
  if (!owner) throw new Error("export artifact owner principal is required");
  const directory = getMessageExportDir();
  const directoryExisted = existsSync(directory);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (!directoryExisted) chmodSync(directory, 0o700);

  const artifactId = randomUUID();
  const filename = `message-export-${artifactId}.${options.format}`;
  const filePath = join(directory, filename);
  const payloadBytes = Buffer.from(serialized.payload, "utf8");
  writeFileSync(filePath, payloadBytes, { flag: "wx", mode: 0o600 });
  chmodSync(filePath, 0o600);
  const sha256 = createHash("sha256").update(payloadBytes).digest("hex");
  const artifact: MessageExportArtifact = {
    artifact_id: artifactId,
    filename,
    path: exposure === "local" ? filePath : null,
    download_path: exposure === "remote" ? `/v1/messages/exports/${artifactId}` : null,
    sha256,
    format: options.format,
    detail: options.detail,
    count: serialized.count,
    has_more: serialized.hasMore,
    skipped_count: serialized.skippedCount,
    byte_length: payloadBytes.byteLength,
    max_bytes: options.maxBytes,
    timeout_ms: options.timeoutMs,
    created_at: new Date().toISOString(),
  };
  const stored: StoredExportMetadata = {
    owner_principal: owner,
    artifact: { ...artifact, path: filePath },
  };
  const metadataPath = join(directory, `${artifactId}.meta.json`);
  writeFileSync(metadataPath, JSON.stringify(stored), { flag: "wx", mode: 0o600 });
  chmodSync(metadataPath, 0o600);
  return artifact;
}

export function loadMessageExportArtifact(artifactId: string, principal: string): LoadedMessageExportArtifact | null {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(artifactId)) {
    return null;
  }
  const metadataPath = join(getMessageExportDir(), `${artifactId}.meta.json`);
  let stored: StoredExportMetadata;
  try {
    stored = JSON.parse(readFileSync(metadataPath, "utf8")) as StoredExportMetadata;
  } catch {
    return null;
  }
  if (stored.owner_principal.toLowerCase() !== principal.trim().toLowerCase()) return null;
  const filePath = stored.artifact.path;
  if (!filePath) return null;
  const expectedFilename = `message-export-${artifactId}.${stored.artifact.format}`;
  const expectedPath = resolve(join(getMessageExportDir(), expectedFilename));
  if (stored.artifact.filename !== expectedFilename || resolve(filePath) !== expectedPath) return null;
  const payload = readFileSync(filePath);
  const stat = statSync(filePath);
  const sha256 = createHash("sha256").update(payload).digest("hex");
  if (stat.size !== stored.artifact.byte_length || sha256 !== stored.artifact.sha256) {
    throw new Error("export artifact integrity check failed");
  }
  return {
    artifact: { ...stored.artifact, path: null, download_path: `/v1/messages/exports/${artifactId}` },
    payload,
    contentType: stored.artifact.format === "csv" ? "text/csv; charset=utf-8" : "application/json; charset=utf-8",
  };
}
