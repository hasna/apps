import { redactEvidenceText } from "../lib/redaction.js";
import {
  DEFAULT_TODOS_POSTGRES_SYNC_TABLE,
  type TodosPostgresQueryClient,
} from "./postgres-sync.js";
import {
  COMMENT_REDACTION_BACKFILL_CONFIRMATION,
  type CommentRedactionBackfillOptions,
  type CommentRedactionBackfillResult,
} from "./comment-redaction-contract.js";
export {
  COMMENT_REDACTION_BACKFILL_CONFIRMATION,
  isCommentRedactionBackfillComplete,
} from "./comment-redaction-contract.js";
export type {
  CommentRedactionBackfillOptions,
  CommentRedactionBackfillResult,
} from "./comment-redaction-contract.js";

interface CommentPayloadRow {
  object_id: string;
  payload: unknown;
}

function assertSafeIdentifier(value: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`Unsafe Postgres identifier: ${value}`);
  }
}

function payloadObject(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

/**
 * Scan historical Postgres comment payloads (including deleted/tombstoned rows)
 * in bounded keyset batches and, only after an explicit confirmation, replace
 * secret-like content in place without changing tombstone state. The update is
 * idempotent and compare-and-set guarded so a concurrently edited comment is
 * never overwritten. Neither payload contents nor credentials are returned.
 */
export async function backfillPostgresCommentRedaction(
  client: TodosPostgresQueryClient,
  options: CommentRedactionBackfillOptions = {},
): Promise<CommentRedactionBackfillResult> {
  const apply = options.apply === true;
  if (apply && options.confirmation !== COMMENT_REDACTION_BACKFILL_CONFIRMATION) {
    throw new Error(
      `Applying the comment redaction backfill requires confirmation ${COMMENT_REDACTION_BACKFILL_CONFIRMATION}`,
    );
  }

  const tableName = options.tableName ?? DEFAULT_TODOS_POSTGRES_SYNC_TABLE;
  assertSafeIdentifier(tableName);
  const service = options.service ?? "todos";
  const batchSize = options.batchSize ?? 100;
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 500) {
    throw new Error("Comment redaction backfill batchSize must be an integer between 1 and 500");
  }

  const result: CommentRedactionBackfillResult = {
    dry_run: !apply,
    scanned: 0,
    candidates: 0,
    updated: 0,
    conflicts: 0,
    batches: 0,
    remaining_candidates: 0,
  };
  let afterId = "";

  while (true) {
    const page = await client.query<CommentPayloadRow>(
      `/* todos:comment-redaction-backfill-scan */
       SELECT object_id, payload
       FROM ${tableName}
       WHERE service = $1 AND object_type = 'comments'
         AND object_id > $2
       ORDER BY object_id ASC
       LIMIT $3`,
      [service, afterId, batchSize],
    );
    if (page.rows.length === 0) break;
    result.batches += 1;

    for (const row of page.rows) {
      afterId = row.object_id;
      result.scanned += 1;
      const payload = payloadObject(row.payload);
      const original = payload?.["content"];
      if (typeof original !== "string") continue;
      const redacted = redactEvidenceText(original);
      if (redacted === original) continue;
      result.candidates += 1;
      if (!apply) continue;

      const nextPayload = { ...payload, content: redacted };
      const update = await client.query<{ object_id: string }>(
        `/* todos:comment-redaction-backfill-apply */
         UPDATE ${tableName}
         SET payload = $3::jsonb
         WHERE service = $1 AND object_type = 'comments' AND object_id = $2
           AND payload = $4::jsonb
         RETURNING object_id`,
        [service, row.object_id, nextPayload, row.payload],
      );
      if (update.rows.length === 1) result.updated += 1;
      else result.conflicts += 1;
    }

    if (page.rows.length < batchSize) break;
  }

  if (!apply) {
    result.remaining_candidates = result.candidates;
    return result;
  }
  const verification = await backfillPostgresCommentRedaction(client, {
    ...options,
    apply: false,
    confirmation: undefined,
  });
  result.remaining_candidates = verification.candidates;
  return result;
}
