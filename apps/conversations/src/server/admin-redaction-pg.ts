// Hosted message redaction: `POST /v1/admin/redact-messages`.
//
// The API-side mirror of `redactMessagesById` (src/lib/admin-redaction.ts),
// which redacts the ON-BOX SQLite store. Server-side, the rows live in the
// app's PostgreSQL store and the attachment blobs live in
// `message_attachments`, so the apply path is: UPDATE the message row,
// scrub the Conversations→Events outbox envelope preview, DELETE the
// attachment blobs, and write the same `message_redaction_audit` row the local
// path writes. Reports share the local classification and hashing so a dry-run
// against either store speaks the same language. The CLI reaches this route
// through ApiStore; store routing decides which redaction runs, never a mode
// gate.
import { randomUUID } from "node:crypto";
import type { TypedQueryClient } from "../generated/storage-kit/query.js";
import {
  classifyText,
  hashText,
  mergeClasses,
  parseAttachments,
  redactedAttachments,
  redactedMetadata,
  type RedactionMessageReport,
  type RedactMessagesOptions,
  type RedactMessagesResult,
} from "../lib/admin-redaction.js";

/** The surfaces an apply run scrubs on the hosted store. */
export const PG_REDACTION_SURFACES = [
  "messages.content",
  "messages.metadata",
  "messages.attachments",
  "message_attachments.blobs",
  "conversations_event_outbox.envelope",
];

export interface RedactMessagesRequestBody {
  ids?: unknown;
  actor?: unknown;
  reason?: unknown;
  apply?: unknown;
  authority?: unknown;
  backup_confirmed?: unknown;
  dry_run_confirmed?: unknown;
  purge_attachments?: unknown;
  replacement_content?: unknown;
  now?: unknown;
}

export function normalizeRedactMessagesBody(body: RedactMessagesRequestBody): RedactMessagesOptions {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Redaction request must be a JSON object.");
  }
  for (const field of ["apply", "backup_confirmed", "dry_run_confirmed", "purge_attachments"] as const) {
    if (body[field] !== undefined && typeof body[field] !== "boolean") {
      throw new Error(`${field} must be a JSON boolean.`);
    }
  }
  return {
    ids: Array.isArray(body.ids) ? body.ids.filter((value) => typeof value === "number" && Number.isInteger(value) && value > 0) : [],
    actor: typeof body.actor === "string" ? body.actor : "",
    reason: typeof body.reason === "string" ? body.reason : "credential-shaped message remediation",
    apply: body.apply === true,
    authority: typeof body.authority === "string" ? body.authority : undefined,
    backupConfirmed: body.backup_confirmed === true,
    dryRunConfirmed: body.dry_run_confirmed === true,
    purgeAttachments: body.purge_attachments !== false,
    replacementContent: typeof body.replacement_content === "string" ? body.replacement_content : undefined,
    now: typeof body.now === "string" ? body.now : undefined,
  };
}

interface PgMessageRow {
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
}

interface AttachmentRowStats {
  count: number;
  /** `name:size` pairs that become evidence hashes, mirroring the local path-hash evidence. */
  nameSizes: string[];
}

function uniqueIds(ids: number[]): number[] {
  const seen = new Set<number>();
  const result: number[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

function validateApplyGates(opts: RedactMessagesOptions): void {
  if (!opts.apply) return;
  if (!opts.backupConfirmed) throw new Error("Refusing live redaction without backup confirmation.");
  if (!opts.dryRunConfirmed) throw new Error("Refusing live redaction without dry-run confirmation.");
  if (!opts.authority?.trim()) throw new Error("Refusing live redaction without owner authority.");
  if (!opts.reason?.trim()) throw new Error("Refusing live redaction without an audit reason.");
  if (!opts.actor?.trim()) throw new Error("Refusing live redaction without an actor.");
}

function emptyReport(id: number): RedactionMessageReport {
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
    before_hashes: { content_sha256: null, metadata_sha256: null, attachments_sha256: null },
    attachment_count: 0,
    attachment_file_count: 0,
    attachment_file_path_hashes: [],
    attachment_files_deleted: 0,
    attachment_file_delete_errors: 0,
    unsafe_attachment_file_count: 0,
    audit_id: null,
  };
}

function reportForRow(row: PgMessageRow, stats: AttachmentRowStats, apply: boolean): RedactionMessageReport {
  const attachmentCount = parseAttachments(row.attachments).length;
  const fields = ["content"];
  if (row.metadata !== null) fields.push("metadata");
  if (row.attachments !== null) fields.push("attachments");
  if (stats.count > 0) fields.push("attachment_files");

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
    attachment_file_count: stats.count,
    attachment_file_path_hashes: stats.nameSizes.map((pair) => hashText(pair) ?? ""),
    attachment_files_deleted: 0,
    attachment_file_delete_errors: 0,
    unsafe_attachment_file_count: 0,
    audit_id: null,
  };
}

async function loadAttachmentStats(client: TypedQueryClient, messageIds: number[]): Promise<Map<number, AttachmentRowStats>> {
  if (messageIds.length === 0) return new Map();
  const rows = await client.many<{ message_id: string | number; count: string | number; name_sizes: string | null }>(
    `SELECT message_id, COUNT(*)::int AS count,
            COALESCE(string_agg(name || ':' || size::text, ','), '') AS name_sizes
     FROM message_attachments
     WHERE message_id = ANY($1::bigint[])
     GROUP BY message_id`,
    [messageIds],
  );
  const byId = new Map<number, AttachmentRowStats>();
  for (const row of rows) {
    const id = Number(row.message_id);
    const nameSizes = typeof row.name_sizes === "string" && row.name_sizes
      ? row.name_sizes.split(",")
      : [];
    byId.set(id, { count: Number(row.count), nameSizes });
  }
  return byId;
}

export async function redactMessagesPg(
  client: TypedQueryClient,
  options: RedactMessagesOptions,
): Promise<RedactMessagesResult> {
  const ids = uniqueIds(options.ids);
  if (ids.length === 0) throw new Error("At least one message id is required.");

  const apply = Boolean(options.apply);
  validateApplyGates(options);

  const rows = await client.many<PgMessageRow>(
    `SELECT id, uuid, session_id, from_agent, to_agent, channel, content, metadata, attachments, created_at
     FROM messages WHERE id = ANY($1::bigint[])`,
    [ids],
  );
  const byId = new Map(rows.map((row) => [Number(row.id), row]));
  const attachmentStats = await loadAttachmentStats(client, rows.map((row) => Number(row.id)));

  const reports = ids.map((id) => {
    const row = byId.get(id);
    return row ? reportForRow(row, attachmentStats.get(id) ?? { count: 0, nameSizes: [] }, apply) : emptyReport(id);
  });

  if (apply) {
    const actor = options.actor.trim();
    const reason = options.reason.trim();
    const authority = options.authority!.trim();
    const redactedAt = options.now ?? new Date().toISOString();
    const replacementContent = options.replacementContent ?? "[REDACTED by conversations admin redaction]";

    for (const report of reports) {
      if (!report.exists) continue;
      const auditId = randomUUID();
      report.audit_id = auditId;
      await client.execute(
        `UPDATE messages SET content = $1, metadata = $2, attachments = $3, edited_at = $4 WHERE id = $5`,
        [replacementContent, redactedMetadata(report, { actor, reason, authority }, redactedAt), redactedAttachments(report, redactedAt), redactedAt, report.id],
      );
      // The Conversations→Events outbox persists a content preview in the
      // envelope; a security redaction must scrub it there too, or the
      // sensitive content stays recoverable from the hosted store.
      await client.execute(
        `UPDATE conversations_event_outbox
         SET envelope_json = jsonb_set(envelope_json::jsonb, '{data,content_preview}', to_jsonb($1::text), true)
         WHERE type = 'conversations.message.created'
           AND envelope_json::jsonb -> 'data' ->> 'uuid' = $2`,
        [replacementContent, report.message_uuid],
      );
      await client.execute(
        `INSERT INTO message_redaction_audit (
           id, message_id, message_uuid, actor, authority, reason, redacted_at,
           fields, secret_classes, before_hashes, attachment_file_count,
           attachment_file_path_hashes, attachment_files_deleted,
           attachment_file_delete_errors, unsafe_attachment_file_count
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 0, 0, $13)`,
        [
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
          report.unsafe_attachment_file_count,
        ],
      );
      if (options.purgeAttachments !== false && report.attachment_file_count > 0) {
        const purged = await client.query("DELETE FROM message_attachments WHERE message_id = $1", [report.id]);
        report.attachment_files_deleted = purged.rowCount ?? report.attachment_file_count;
        await client.execute(
          "UPDATE message_redaction_audit SET attachment_files_deleted = $1 WHERE id = $2",
          [report.attachment_files_deleted, auditId],
        );
      }
    }
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
    surfaces: PG_REDACTION_SURFACES,
    messages: reports,
  };
}
