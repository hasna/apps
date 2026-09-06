import { createHash, randomUUID } from "crypto";
import { existsSync, realpathSync, statSync, unlinkSync } from "fs";
import { join, resolve, sep } from "path";
import { getDataDir, getDb } from "./db.js";
import { isCloudStore } from "./store/index.js";

export type RedactionClass =
  | "private_key"
  | "cloud_access_key"
  | "bearer_token"
  | "platform_api_key"
  | "package_token"
  | "database_url"
  | "webhook_url"
  | "env_assignment"
  | "sensitive_metadata_key"
  | "attachment_reference";

export interface RedactionMessageReport {
  id: number;
  exists: boolean;
  applied: boolean;
  message_uuid: string | null;
  channel: string | null;
  session_id: string | null;
  from_agent: string | null;
  to_agent: string | null;
  created_at: string | null;
  fields: string[];
  secret_classes: RedactionClass[];
  before_hashes: {
    content_sha256: string | null;
    metadata_sha256: string | null;
    attachments_sha256: string | null;
  };
  attachment_count: number;
  attachment_file_count: number;
  attachment_file_path_hashes: string[];
  attachment_files_deleted: number;
  attachment_file_delete_errors: number;
  unsafe_attachment_file_count: number;
  audit_id: string | null;
}

export interface RedactMessagesOptions {
  ids: number[];
  actor: string;
  reason: string;
  apply?: boolean;
  authority?: string;
  backupConfirmed?: boolean;
  dryRunConfirmed?: boolean;
  purgeAttachments?: boolean;
  replacementContent?: string;
  now?: string;
}

export interface RedactMessagesResult {
  dry_run: boolean;
  applied: boolean;
  actor: string;
  reason: string;
  authority: string | null;
  backup_confirmed: boolean;
  dry_run_confirmed: boolean;
  requested_ids: number[];
  matched_count: number;
  redacted_count: number;
  missing_ids: number[];
  surfaces: string[];
  messages: RedactionMessageReport[];
}

type RawMessageRow = {
  id: number;
  uuid: string | null;
  session_id: string;
  from_agent: string;
  to_agent: string;
  channel: string | null;
  content: string;
  metadata: string | null;
  attachments: string | null;
  created_at: string;
};

type AttachmentReference = {
  path_hash: string;
  path: string;
  exists: boolean;
  safe_to_delete: boolean;
};

const REDACTION_SURFACES = [
  "messages.content",
  "messages.metadata",
  "messages.attachments",
  "messages_fts",
  "export_messages",
  "attachment_files",
  "sqlite_wal",
  "sqlite_free_pages",
];

function hashText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return createHash("sha256").update(value).digest("hex");
}

function uniqueIds(ids: number[]): number[] {
  const seen = new Set<number>();
  const result: number[] = [];
  for (const id of ids) {
    if (!Number.isInteger(id) || id <= 0) {
      throw new Error(`Invalid message id: ${id}`);
    }
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

function privateKeyRegex(): RegExp {
  const begin = "-----BEGIN";
  const suffix = "PRIVATE KEY-----";
  return new RegExp(`${begin}\\s+(?:[A-Z]+\\s+)?${suffix}`, "i");
}

function classifyText(value: string | null | undefined, surface: "content" | "metadata" | "attachments"): Set<RedactionClass> {
  const classes = new Set<RedactionClass>();
  if (!value) return classes;

  if (privateKeyRegex().test(value)) classes.add("private_key");
  if (/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/.test(value)) classes.add("cloud_access_key");
  if (/\bBearer\s+[A-Za-z0-9._~+/=-]{20,}\b/i.test(value)) classes.add("bearer_token");
  if (/\b(?:sk-[A-Za-z0-9_-]{20,}|sk[-]ant-[A-Za-z0-9._-]{20,}|gh[pousr]_[A-Za-z0-9_]{20,})\b/.test(value)) classes.add("platform_api_key");
  if (/\bnpm_[A-Za-z0-9]{20,}\b/.test(value)) classes.add("package_token");
  if (/\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s"']+/i.test(value)) classes.add("database_url");
  if (/\bhttps:\/\/hooks\.[^\s"']+|webhook[_-]?url/i.test(value)) classes.add("webhook_url");
  if (/^[A-Z][A-Z0-9_]{2,}\s*=\s*\S+/m.test(value)) classes.add("env_assignment");

  if (surface === "metadata" && /"(?:api[_-]?key|token|secret|password|private[_-]?key|database[_-]?url|webhook[_-]?url)"\s*:/i.test(value)) {
    classes.add("sensitive_metadata_key");
  }
  if (surface === "attachments") {
    classes.add("attachment_reference");
  }

  return classes;
}

function mergeClasses(...sets: Set<RedactionClass>[]): RedactionClass[] {
  return [...new Set(sets.flatMap((set) => [...set]))].sort();
}

function parseAttachments(raw: string | null): Array<Record<string, unknown>> {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item === "object") as Array<Record<string, unknown>> : [];
  } catch {
    return [];
  }
}

/** The canonical (symlink-resolved) form of a directory, or the path itself when it does not exist yet. */
function canonicalDir(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/**
 * The per-message attachment directory, CANONICALISED on the same terms as the
 * attachment path it is compared against. `attachmentReferences` resolves the
 * candidate file through `realpathSync` before the containment check; a base
 * that is not canonicalised the same way disagrees with it wherever a data dir
 * sits behind a symlink — on macOS every temp root does (`/var/...` is
 * `/private/var/...`), so `safe_to_delete` was false there and an apply run
 * left the leaked attachment on disk.
 */
function attachmentsBaseDir(messageId: number): string {
  const root = resolve(process.env.CONVERSATIONS_ATTACHMENTS_DIR || join(getDataDir(), "attachments"));
  return resolve(canonicalDir(root), String(messageId));
}

function attachmentReferences(row: RawMessageRow): AttachmentReference[] {
  const base = `${attachmentsBaseDir(row.id)}${sep}`;
  return parseAttachments(row.attachments)
    .map((attachment) => typeof attachment.path === "string" ? attachment.path : null)
    .filter((path): path is string => Boolean(path))
    .map((path) => {
      const resolved = resolve(path);
      const pathForSafety = existsSync(resolved) ? realpathSync(resolved) : resolved;
      const exists = existsSync(pathForSafety);
      const safeToDelete = pathForSafety.startsWith(base) && exists && statSync(pathForSafety).isFile();
      return {
        path_hash: hashText(pathForSafety) ?? "",
        path: pathForSafety,
        exists,
        safe_to_delete: safeToDelete,
      };
    });
}

function reportForRow(row: RawMessageRow, apply: boolean): RedactionMessageReport {
  const attachmentRefs = attachmentReferences(row);
  const attachmentCount = parseAttachments(row.attachments).length;
  const fields = ["content"];
  if (row.metadata !== null) fields.push("metadata");
  if (row.attachments !== null) fields.push("attachments");
  if (attachmentRefs.length > 0) fields.push("attachment_files");

  return {
    id: row.id,
    exists: true,
    applied: apply,
    message_uuid: row.uuid,
    channel: row.channel,
    session_id: row.session_id,
    from_agent: row.from_agent,
    to_agent: row.to_agent,
    created_at: row.created_at,
    fields,
    secret_classes: mergeClasses(
      classifyText(row.content, "content"),
      classifyText(row.metadata, "metadata"),
      classifyText(row.attachments, "attachments"),
    ),
    before_hashes: {
      content_sha256: hashText(row.content),
      metadata_sha256: hashText(row.metadata),
      attachments_sha256: hashText(row.attachments),
    },
    attachment_count: attachmentCount,
    attachment_file_count: attachmentRefs.filter((ref) => ref.exists).length,
    attachment_file_path_hashes: attachmentRefs.map((ref) => ref.path_hash),
    attachment_files_deleted: 0,
    attachment_file_delete_errors: 0,
    unsafe_attachment_file_count: attachmentRefs.filter((ref) => ref.exists && !ref.safe_to_delete).length,
    audit_id: null,
  };
}

function missingReport(id: number): RedactionMessageReport {
  return {
    id,
    exists: false,
    applied: false,
    message_uuid: null,
    channel: null,
    session_id: null,
    from_agent: null,
    to_agent: null,
    created_at: null,
    fields: [],
    secret_classes: [],
    before_hashes: {
      content_sha256: null,
      metadata_sha256: null,
      attachments_sha256: null,
    },
    attachment_count: 0,
    attachment_file_count: 0,
    attachment_file_path_hashes: [],
    attachment_files_deleted: 0,
    attachment_file_delete_errors: 0,
    unsafe_attachment_file_count: 0,
    audit_id: null,
  };
}

function ensureRedactionAuditTable(): void {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS message_redaction_audit (
      id TEXT PRIMARY KEY,
      message_id INTEGER NOT NULL,
      message_uuid TEXT,
      actor TEXT NOT NULL,
      authority TEXT NOT NULL,
      reason TEXT NOT NULL,
      redacted_at TEXT NOT NULL,
      fields TEXT NOT NULL,
      secret_classes TEXT NOT NULL,
      before_hashes TEXT NOT NULL,
      attachment_file_count INTEGER NOT NULL DEFAULT 0,
      attachment_file_path_hashes TEXT NOT NULL,
      attachment_files_deleted INTEGER NOT NULL DEFAULT 0,
      attachment_file_delete_errors INTEGER NOT NULL DEFAULT 0,
      unsafe_attachment_file_count INTEGER NOT NULL DEFAULT 0
    )
  `);
}

function redactedMetadata(report: RedactionMessageReport, opts: Required<Pick<RedactMessagesOptions, "actor" | "reason" | "authority">>, redactedAt: string): string {
  return JSON.stringify({
    redacted: true,
    redacted_at: redactedAt,
    redaction: {
      actor: opts.actor,
      reason: opts.reason,
      authority: opts.authority,
    },
    original_hashes: report.before_hashes,
    original_fields: report.fields,
    secret_classes: report.secret_classes,
  });
}

function redactedAttachments(report: RedactionMessageReport, redactedAt: string): string | null {
  if (report.attachment_count === 0 && !report.before_hashes.attachments_sha256) return null;
  return JSON.stringify([{
    name: "redacted-attachments",
    path: "[redacted]",
    size: 0,
    mime_type: "application/x-redacted",
    redacted: true,
    redacted_at: redactedAt,
    original_attachment_count: report.attachment_count,
    original_attachments_sha256: report.before_hashes.attachments_sha256,
  }]);
}

function validateApplyGates(opts: RedactMessagesOptions): void {
  if (!opts.apply) return;
  if (!opts.backupConfirmed) {
    throw new Error("Refusing live redaction without backup confirmation.");
  }
  if (!opts.dryRunConfirmed) {
    throw new Error("Refusing live redaction without dry-run confirmation.");
  }
  if (!opts.authority?.trim()) {
    throw new Error("Refusing live redaction without owner authority.");
  }
  if (!opts.reason?.trim()) {
    throw new Error("Refusing live redaction without an audit reason.");
  }
  if (!opts.actor?.trim()) {
    throw new Error("Refusing live redaction without an actor.");
  }
}

function prepareSqliteSecureRedaction(): void {
  getDb().exec("PRAGMA secure_delete = ON");
}

function scrubSqliteResidualStorage(): void {
  const db = getDb();
  db.exec("PRAGMA secure_delete = ON");
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  db.exec("VACUUM");
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
}

function purgeAttachmentFiles(row: RawMessageRow): { deleted: number; errors: number } {
  let deleted = 0;
  let errors = 0;
  for (const ref of attachmentReferences(row)) {
    if (!ref.safe_to_delete) continue;
    try {
      unlinkSync(ref.path);
      deleted++;
    } catch {
      errors++;
    }
  }
  return { deleted, errors };
}

export function redactMessagesById(options: RedactMessagesOptions): RedactMessagesResult {
  // This tool redacts on-box SQLite only (secure_delete + WAL truncate + VACUUM).
  // When the client is flipped to the HTTP API, the messages live in the API
  // store (RDS), not in local sqlite — running here would silently scan an
  // empty/stale local DB and falsely report a clean result. Fail loud instead so a
  // security remediation is never mistaken for done. Mirrors the split-brain guard
  // the public SDK surface enforces via getStore().
  if (isCloudStore()) {
    throw new Error(
      "Refusing to run local SQLite redaction: conversations is flipped to the HTTP API. " +
      "The target messages live in the API store (RDS), not on-box sqlite. " +
      "Redact through the cloud API/database, or unset the API client-flip env to operate on local sqlite.",
    );
  }

  const ids = uniqueIds(options.ids);
  if (ids.length === 0) throw new Error("At least one message id is required.");

  const apply = Boolean(options.apply);
  validateApplyGates(options);

  const db = getDb();
  const rows = new Map<number, RawMessageRow>();
  const select = db.prepare("SELECT id, uuid, session_id, from_agent, to_agent, channel, content, metadata, attachments, created_at FROM messages WHERE id = ?");
  for (const id of ids) {
    const row = select.get(id) as RawMessageRow | null;
    if (row) rows.set(id, row);
  }

  const reports = ids.map((id) => {
    const row = rows.get(id);
    return row ? reportForRow(row, apply) : missingReport(id);
  });

  if (apply) {
    const actor = options.actor.trim();
    const reason = options.reason.trim();
    const authority = options.authority!.trim();
    const redactedAt = options.now ?? new Date().toISOString();
    const replacementContent = options.replacementContent ?? "[REDACTED by conversations admin redaction]";

    prepareSqliteSecureRedaction();
    ensureRedactionAuditTable();
    db.transaction(() => {
      const updateMessage = db.prepare(`
        UPDATE messages
        SET content = ?, metadata = ?, attachments = ?, edited_at = ?
        WHERE id = ?
      `);
      const insertAudit = db.prepare(`
        INSERT INTO message_redaction_audit (
          id, message_id, message_uuid, actor, authority, reason, redacted_at,
          fields, secret_classes, before_hashes, attachment_file_count,
          attachment_file_path_hashes, attachment_files_deleted,
          attachment_file_delete_errors, unsafe_attachment_file_count
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      // The Conversations→Events source outbox persists a content preview in
      // the envelope. A security redaction must scrub that preview too, or the
      // sensitive content stays recoverable from the local store.
      const scrubOutbox = db.prepare(`
        UPDATE conversations_event_outbox
        SET envelope_json = json_set(envelope_json, '$.data.content_preview', ?)
        WHERE type = 'conversations.message.created'
          AND json_extract(envelope_json, '$.data.uuid') = ?
      `);

      for (const report of reports) {
        if (!report.exists) continue;
        const auditId = randomUUID();
        report.audit_id = auditId;
        updateMessage.run(
          replacementContent,
          redactedMetadata(report, { actor, reason, authority }, redactedAt),
          redactedAttachments(report, redactedAt),
          redactedAt,
          report.id,
        );
        scrubOutbox.run(replacementContent, report.message_uuid);
        insertAudit.run(
          auditId,
          report.id,
          report.message_uuid,
          actor,
          authority,
          reason,
          redactedAt,
          JSON.stringify(report.fields),
          JSON.stringify(report.secret_classes),
          JSON.stringify(report.before_hashes),
          report.attachment_file_count,
          JSON.stringify(report.attachment_file_path_hashes),
          0,
          0,
          report.unsafe_attachment_file_count,
        );
      }
    });

    if (options.purgeAttachments !== false) {
      const updateAudit = db.prepare(`
        UPDATE message_redaction_audit
        SET attachment_files_deleted = ?, attachment_file_delete_errors = ?
        WHERE id = ?
      `);
      for (const report of reports) {
        const row = rows.get(report.id);
        if (!row || !report.audit_id) continue;
        const purge = purgeAttachmentFiles(row);
        report.attachment_files_deleted = purge.deleted;
        report.attachment_file_delete_errors = purge.errors;
        updateAudit.run(purge.deleted, purge.errors, report.audit_id);
      }
    }
    scrubSqliteResidualStorage();
  }

  const matchedCount = reports.filter((report) => report.exists).length;
  return {
    dry_run: !apply,
    applied: apply,
    actor: options.actor,
    reason: options.reason,
    authority: options.authority?.trim() || null,
    backup_confirmed: Boolean(options.backupConfirmed),
    dry_run_confirmed: Boolean(options.dryRunConfirmed),
    requested_ids: ids,
    matched_count: matchedCount,
    redacted_count: apply ? matchedCount : 0,
    missing_ids: reports.filter((report) => !report.exists).map((report) => report.id),
    surfaces: REDACTION_SURFACES,
    messages: reports,
  };
}
