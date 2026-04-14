/**
 * Shared cross-project types for open-knowledge, open-crm, and open-machines.
 *
 * Each project vendors this file. Keep it small — add fields only when all three
 * projects need them.
 */

export type ProjectName = "open-knowledge" | "open-crm" | "open-machines";

/**
 * A reference from a record in one project to a record in another.
 * Stored in `metadata._crossRefs` on the owning entity.
 */
export interface CrossRef {
  source_project: ProjectName;
  source_id: string;
  target_project: ProjectName;
  target_id: string;
  /** Optional human description of the relationship. */
  label?: string;
  /** Agent or user that created this reference. */
  created_by?: string;
  /** ISO timestamp of creation. */
  created_at?: string;
}

/** Reserved key inside `metadata` for cross-project references. */
export const CROSSREFS_KEY = "_crossRefs" as const;
