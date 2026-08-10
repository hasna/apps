import { normalizeSlug } from "../lib/slugs.js";
import type { TodosTaskManifest } from "./types.js";

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
