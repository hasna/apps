/**
 * Tag resolution for `todos bulk tag|untag`.
 *
 * Kept as pure functions with no database or transport dependency so both the
 * remote (/v1) and local (SQLite) bulk paths resolve tags identically. A tag
 * that merges on one transport and replaces on the other would corrupt rows
 * depending on which machine ran the backfill.
 */

export type BulkTagAction = "tag" | "untag";

export interface BulkTagResolution {
  /** The full tag list to persist. */
  tags: string[];
  /**
   * False when the row already satisfies the request. Callers skip the write
   * entirely, so a re-run after a partial failure does not bump row versions
   * or emit audit noise for rows that were already correct.
   */
  changed: boolean;
}

/**
 * Parse a comma-separated `--tag` argument.
 *
 * Splits ONLY on commas: `:` and `/` are legal inside a tag and are load
 * bearing for the namespaced tags this fleet already stores (`repo:open-todos`,
 * `gh:hasna/todos`, `directive:k_msd4cz8t_ste6f4`).
 */
export function parseTagList(raw: string | undefined | null): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const segment of raw.split(",")) {
    const tag = segment.trim();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
  }
  return tags;
}

/**
 * Apply `action` to `current`, returning the tag list to persist.
 *
 * `tag` MERGES — it never replaces. `todos update --tags` replaces the list,
 * and reusing that semantic for a bulk provenance backfill would strip every
 * unrelated tag from every row it touched.
 */
export function resolveBulkTags(
  current: readonly string[] | undefined | null,
  action: BulkTagAction,
  tags: readonly string[],
): BulkTagResolution {
  const existing = Array.isArray(current) ? current.filter((tag) => typeof tag === "string") : [];

  if (tags.length === 0) return { tags: [...existing], changed: false };

  if (action === "tag") {
    const present = new Set(existing);
    const additions = tags.filter((tag) => !present.has(tag));
    if (additions.length === 0) return { tags: [...existing], changed: false };
    // Existing order is preserved and additions are appended, so a backfill
    // produces a minimal, reviewable diff rather than reordering every row.
    return { tags: [...existing, ...additions], changed: true };
  }

  const removing = new Set(tags);
  const remaining = existing.filter((tag) => !removing.has(tag));
  return { tags: remaining, changed: remaining.length !== existing.length };
}
