import type { Message, MessagePreview, MessagePreviewPage, Priority } from "../types.js";

export const COLLECTION_DEFAULT_LIMIT = 20;
export const COLLECTION_MAX_LIMIT = 100;
export const COLLECTION_DEFAULT_MAX_BYTES = 16_384;
export const COLLECTION_MIN_MAX_BYTES = 512;
export const COLLECTION_MAX_MAX_BYTES = 65_536;
export const COLLECTION_DEFAULT_PREVIEW_BYTES = 320;
export const COLLECTION_MAX_PREVIEW_BYTES = 1_024;
export const COLLECTION_DEFAULT_TIMEOUT_MS = 3_000;
export const COLLECTION_MAX_TIMEOUT_MS = 5_000;
export const COLLECTION_PREVIEW_SCAN_CHARS = 4_096;
export const RESTRICTED_CHANNEL_PREVIEW = "[REDACTED:RESTRICTED_CHANNEL_BODY]";

const REDACTION_RULES: Array<[RegExp, string]> = [
  [/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/gi, "[REDACTED:PRIVATE_KEY]"],
  [/\bBearer\s+[A-Za-z0-9._~+/@=-]{20,}/gi, "[REDACTED:BEARER_TOKEN]"],
  [/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b|\bglpat-[A-Za-z0-9_-]{20,}\b/g, "[REDACTED:PAT]"],
  [/\b(?:AKIA|ASIA|AGPA|AIDA|AROA)[A-Z0-9]{16}\b/g, "[REDACTED:CLOUD_KEY]"],
  [/\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{24,}|xox[baprs]-[A-Za-z0-9-]{20,}|sk_(?:live|test)_[A-Za-z0-9]{16,})\b/g, "[REDACTED:CLOUD_KEY]"],
  [/\b(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis|rediss|mssql):\/\/[^\s"'<>`]+/gi, "[REDACTED:DATABASE_URL]"],
  [/\b(?:AWS_SECRET_ACCESS_KEY|AWS_ACCESS_KEY_ID|GOOGLE_API_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY|CLOUDFLARE_API_TOKEN|STRIPE_SECRET_KEY|GITHUB_TOKEN|GITLAB_TOKEN|PERSONAL_ACCESS_TOKEN|DATABASE_URL|DB_URL)\s*[:=]\s*["']?[A-Za-z0-9._~+/@=-]{16,}["']?/gi, "[REDACTED:SENSITIVE_VALUE]"],
];

function strictPositiveInteger(name: string, value: unknown, fallback: number): number {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "string" && !value.trim()) {
    throw new Error(`${name} must be a positive integer`);
  }
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || !Number.isInteger(parsed)) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

export function resolveCollectionLimit(value: unknown): number {
  return Math.min(strictPositiveInteger("limit", value, COLLECTION_DEFAULT_LIMIT), COLLECTION_MAX_LIMIT);
}

export function resolveCollectionOffset(value: unknown): number {
  if (value === undefined || value === null) return 0;
  if (typeof value === "string" && !value.trim()) {
    throw new Error("cursor must be a non-negative integer");
  }
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || !Number.isInteger(parsed)) {
    throw new Error("cursor must be a non-negative integer");
  }
  return parsed;
}

export function resolveCollectionMaxBytes(value: unknown): number {
  const parsed = strictPositiveInteger("max_bytes", value, COLLECTION_DEFAULT_MAX_BYTES);
  if (parsed < COLLECTION_MIN_MAX_BYTES) {
    throw new Error(`max_bytes must be at least ${COLLECTION_MIN_MAX_BYTES}`);
  }
  return Math.min(parsed, COLLECTION_MAX_MAX_BYTES);
}

export function resolveCollectionPreviewBytes(value: unknown): number {
  const parsed = strictPositiveInteger("preview_bytes", value, COLLECTION_DEFAULT_PREVIEW_BYTES);
  return Math.min(parsed, COLLECTION_MAX_PREVIEW_BYTES);
}

export function resolveCollectionTimeoutMs(value: unknown): number {
  const parsed = strictPositiveInteger("timeout_ms", value, COLLECTION_DEFAULT_TIMEOUT_MS);
  return Math.min(parsed, COLLECTION_MAX_TIMEOUT_MS);
}

export function truncateUtf8(value: string, maxBytes: number): { text: string; truncated: boolean } {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return { text: value, truncated: false };
  const suffix = maxBytes >= 3 ? "..." : "";
  const budget = Math.max(0, maxBytes - Buffer.byteLength(suffix));
  let text = "";
  let used = 0;
  for (const char of value) {
    const bytes = Buffer.byteLength(char);
    if (used + bytes > budget) break;
    text += char;
    used += bytes;
  }
  return { text: text + suffix, truncated: true };
}

export function redactSensitiveText(value: string): string {
  let redacted = value;
  for (const [pattern, replacement] of REDACTION_RULES) redacted = redacted.replace(pattern, replacement);
  return redacted;
}

function boundedSafeString(value: unknown, maxBytes = 256): string {
  return truncateUtf8(redactSensitiveText(String(value ?? "")), maxBytes).text;
}

function nullableSafeString(value: unknown, maxBytes = 256): string | null {
  return value === undefined || value === null || value === "" ? null : boundedSafeString(value, maxBytes);
}

function isRestrictedName(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return normalized.includes("incident") || normalized.includes("security");
}

export function isRestrictedCoordinationMessage(row: Record<string, unknown>): boolean {
  return isRestrictedName(row.channel) || isRestrictedName(row.to_agent) || isRestrictedName(row.session_id);
}

function attachmentCount(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  if (typeof value === "string" && value) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.length : 0;
    } catch {
      return 0;
    }
  }
  return Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
}

export function buildMessagePreview(row: Record<string, unknown>, previewBytes = COLLECTION_DEFAULT_PREVIEW_BYTES): MessagePreview {
  const restricted = isRestrictedCoordinationMessage(row);
  const source = restricted ? "" : String(row.preview_source ?? "").replace(/\s+/g, " ").trim();
  const redactedSource = restricted ? RESTRICTED_CHANNEL_PREVIEW : redactSensitiveText(source);
  const preview = truncateUtf8(redactedSource, resolveCollectionPreviewBytes(previewBytes));
  const contentBytes = Math.max(0, Number(row.content_bytes ?? Buffer.byteLength(source)) || 0);
  const attachments = attachmentCount(row.attachment_count ?? row.attachments);
  const replyCount = row.reply_count == null ? undefined : Math.max(0, Number(row.reply_count) || 0);
  const message: MessagePreview = {
    id: Number(row.id),
    session_id: boundedSafeString(row.session_id),
    from_agent: boundedSafeString(row.from_agent),
    to_agent: boundedSafeString(row.to_agent),
    channel: nullableSafeString(row.channel),
    project_id: nullableSafeString(row.project_id),
    priority: (["low", "normal", "high", "urgent"].includes(String(row.priority)) ? String(row.priority) : "normal") as Priority,
    working_dir: nullableSafeString(row.working_dir, 512),
    repository: nullableSafeString(row.repository, 256),
    branch: nullableSafeString(row.branch, 256),
    created_at: boundedSafeString(row.created_at, 64),
    edited_at: nullableSafeString(row.edited_at, 64),
    pinned_at: nullableSafeString(row.pinned_at, 64),
    unread: row.unread === true || row.unread === 1 || (row.unread === undefined && (row.read_at === null || row.read_at === undefined)),
    blocking: row.blocking === true || row.blocking === 1,
    reply_to: row.reply_to == null ? null : Number(row.reply_to),
    attachment_count: attachments,
    has_attachments: attachments > 0,
    has_metadata: row.has_metadata === true || row.has_metadata === 1 || Boolean(row.metadata),
    preview: preview.text,
    preview_bytes: Buffer.byteLength(preview.text),
    content_bytes: contentBytes,
    truncated: restricted || preview.truncated || contentBytes > Buffer.byteLength(source),
    redacted: restricted || redactedSource !== source,
  };
  if (row.mention_id != null) message.mention_id = Number(row.mention_id);
  if (row.uuid != null) message.uuid = boundedSafeString(row.uuid, 128);
  if (replyCount !== undefined) message.reply_count = replyCount;
  if (row.relevance_score != null) message.relevance_score = Number(row.relevance_score) || 0;
  return message;
}

/**
 * Temporary compatibility shape for older Store callers. `content` is the
 * already bounded/redacted preview and raw metadata/attachments are withheld.
 * New collection consumers should use MessagePreviewPage directly.
 */
export function previewAsCompatibilityMessage(preview: MessagePreview): Message {
  return {
    id: preview.id,
    session_id: preview.session_id,
    from_agent: preview.from_agent,
    to_agent: preview.to_agent,
    channel: preview.channel,
    project_id: preview.project_id,
    content: preview.preview,
    priority: preview.priority,
    working_dir: preview.working_dir,
    repository: preview.repository,
    branch: preview.branch,
    metadata: null,
    created_at: preview.created_at,
    read_at: preview.unread ? null : preview.created_at,
    edited_at: preview.edited_at,
    pinned_at: preview.pinned_at,
    blocking: preview.blocking,
    attachments: null,
    reply_to: preview.reply_to,
    reply_count: preview.reply_count,
    truncated: true,
  };
}

export function finalizeMessagePreviewPage(page: MessagePreviewPage): MessagePreviewPage {
  let finalized = page;
  for (let i = 0; i < 3; i++) {
    finalized = { ...finalized, byte_length: Buffer.byteLength(JSON.stringify(finalized), "utf8") };
  }
  return finalized;
}

export function packMessagePreviewPage(
  candidates: MessagePreview[],
  options: { limit?: unknown; cursor?: unknown; max_bytes?: unknown; timeout_ms?: unknown; query?: string } = {},
): MessagePreviewPage {
  const limit = resolveCollectionLimit(options.limit);
  const cursor = resolveCollectionOffset(options.cursor);
  const maxBytes = resolveCollectionMaxBytes(options.max_bytes);
  const timeoutMs = resolveCollectionTimeoutMs(options.timeout_ms);
  const windowed = candidates.slice(0, limit + 1);
  const available = windowed.slice(0, limit);
  let messages: MessagePreview[] = [];
  let skippedCount = 0;

  const build = (items: MessagePreview[], hasMore: boolean, skipped: number): MessagePreviewPage => finalizeMessagePreviewPage({
    messages: items,
    count: items.length,
    limit,
    cursor,
    next_cursor: hasMore || skipped > 0 ? cursor + items.length + skipped : null,
    has_more: hasMore,
    skipped_count: skipped,
    byte_length: 0,
    max_bytes: maxBytes,
    timeout_ms: timeoutMs,
    compact: true,
    detail_path: "messages/{id}",
    ...(options.query ? { query: boundedSafeString(options.query, 256) } : {}),
  });

  for (const candidate of available) {
    const next = build([...messages, candidate], windowed.length > messages.length + 1, skippedCount);
    if (next.byte_length > maxBytes) {
      if (messages.length === 0) skippedCount = 1;
      break;
    }
    messages = [...messages, candidate];
  }

  const consumed = messages.length + skippedCount;
  const result = build(messages, windowed.length > consumed, skippedCount);
  if (result.byte_length > maxBytes) {
    throw new Error(`message preview envelope exceeds max_bytes (${result.byte_length} > ${maxBytes})`);
  }
  return result;
}

export const RESTRICTED_COLLECTION_SQL_PREDICATE = `(lower(COALESCE(channel, '')) LIKE '%incident%' OR lower(COALESCE(channel, '')) LIKE '%security%' OR lower(COALESCE(to_agent, '')) LIKE '%incident%' OR lower(COALESCE(to_agent, '')) LIKE '%security%' OR lower(COALESCE(session_id, '')) LIKE '%incident%' OR lower(COALESCE(session_id, '')) LIKE '%security%')`;
