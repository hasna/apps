/** Dependency-light result contract for the Stage B-deferred redaction backfill. */

export const COMMENT_REDACTION_BACKFILL_CONFIRMATION = "REDACT_STORED_TODOS_COMMENTS";

export interface CommentRedactionBackfillOptions {
  apply?: boolean;
  confirmation?: string;
  service?: string;
  tableName?: string;
  batchSize?: number;
}

export interface CommentRedactionBackfillResult {
  dry_run: boolean;
  scanned: number;
  candidates: number;
  updated: number;
  conflicts: number;
  batches: number;
  remaining_candidates: number;
}

export function isCommentRedactionBackfillComplete(result: CommentRedactionBackfillResult): boolean {
  return !result.dry_run && result.conflicts === 0 && result.remaining_candidates === 0;
}
