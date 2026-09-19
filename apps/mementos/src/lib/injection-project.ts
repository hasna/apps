import type { SqliteAdapter as Database } from "../storage.js";
import { getProject } from "../db/projects.js";

/**
 * Resolve one optional injection project reference to its stable project id.
 *
 * Project names and registered paths remain accepted for compatibility, but no
 * downstream selector should receive the alias: memory, profile, search and
 * hook paths all operate on the stable id returned here.
 */
export function resolveInjectionProjectId(
  projectRef: string | undefined,
  db?: Database,
): string | undefined {
  if (projectRef === undefined) return undefined;
  const project = getProject(projectRef, db);
  if (!project) throw new Error(`Project not found: ${projectRef}`);
  return project.id;
}
