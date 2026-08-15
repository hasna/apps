import { normalizeSlug } from "../lib/slugs.js";
import type { TodosTaskManifest } from "./types.js";

/**
 * Internal marker written to authority rows for applies that use the
 * deterministic plan-slug contract introduced in v0.15.26.
 *
 * This stays out of the public manifest and receipt payloads.
 */
export const TASK_MANIFEST_DETERMINISTIC_SLUG_PROVENANCE = "deterministic-v1" as const;

/**
 * Deterministic plan slug for task-manifest graph writes.
 *
 * The full deterministic plan UUID is intentionally part of the slug: plan
 * names and manifest keys can repeat inside a project, but graph ids cannot.
 * SQLite startup also backfills NULL plan slugs, so both backends must write a
 * stable slug up front for exact readback and compensation parity.
 */
export function taskManifestPlanSlug(manifest: Pick<TodosTaskManifest, "plan">, planId: string): string {
  const base = normalizeSlug(manifest.plan.key) || normalizeSlug(manifest.plan.name) || "plan";
  return `${base}-${planId}`;
}

export interface LegacySqlitePlanSlugRow {
  id: string;
  project_id: string | null;
  name: string;
  slug: string | null;
  created_at: string;
}

/**
 * Reproduce the collision-safe allocator used by SQLite schema repair for a
 * legacy task-manifest plan. The caller compares the result with the stored
 * row and may separately accept the pre-repair NULL state.
 */
export function sqliteLegacyTaskManifestPlanSlug(
  rows: readonly LegacySqlitePlanSlugRow[],
  planId: string,
  targetBase?: string,
): string | null {
  const target = rows.find((row) => row.id === planId);
  if (!target) return null;

  const used = new Set<string>();
  const ordered = [...rows]
    .filter((row) => row.project_id === target.project_id)
    .sort((left, right) => left.created_at.localeCompare(right.created_at) || left.id.localeCompare(right.id));

  for (const row of ordered) {
    const base = row.id === planId
      ? (normalizeSlug(targetBase ?? row.name) || "plan")
      : (normalizeSlug(row.slug || row.name) || "plan");
    let candidate = base;
    let suffix = 2;
    while (used.has(candidate)) {
      candidate = `${base}-${suffix}`;
      suffix += 1;
    }
    if (row.id === planId) return candidate;
    used.add(candidate);
  }
  return null;
}
