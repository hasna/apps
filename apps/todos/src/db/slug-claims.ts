import type { Database } from "bun:sqlite";

export type CanonicalSlugKind = "project" | "task_list";

export function taskListSlugScopeKey(projectId: string | null | undefined): string {
  return projectId ? `project:${projectId}` : "standalone:";
}

/**
 * Claim a slug for newly-created or explicitly-renamed local records.
 * Legacy rows are deliberately not backfilled: historical duplicates remain
 * readable until an operator reconciles them explicitly.
 */
export function claimCanonicalSlug(
  kind: CanonicalSlugKind,
  scopeKey: string,
  slug: string,
  objectId: string,
  db: Database,
): boolean {
  db.run(
    `INSERT OR IGNORE INTO canonical_slug_claims (kind, scope_key, slug, object_id)
     VALUES (?, ?, ?, ?)`,
    [kind, scopeKey, slug, objectId],
  );
  const claim = db.query(
    "SELECT object_id FROM canonical_slug_claims WHERE kind = ? AND scope_key = ? AND slug = ?",
  ).get(kind, scopeKey, slug) as { object_id: string } | null;
  return claim?.object_id === objectId;
}

export function releaseCanonicalSlugClaims(kind: CanonicalSlugKind, objectId: string, db: Database): void {
  db.run("DELETE FROM canonical_slug_claims WHERE kind = ? AND object_id = ?", [kind, objectId]);
}
