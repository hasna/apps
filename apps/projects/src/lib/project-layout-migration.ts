import { cpSync, existsSync, lstatSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import type { Workspace } from "../types/workspace.js";
import { projectWorkspaceStorePath } from "./project-store-paths.js";

/**
 * One-time migration for the retired singular in-project layout.
 *
 * The only convention for project metadata is the plural store:
 * `~/.hasna/projects/` with per-workspace files under
 * `~/.hasna/projects/workspaces/<workspace_id>/`. Before that convention was
 * final, a stray singular directory inside project folders (holding
 * `dashboard.render.json`, `snapshots/`, `evidence/`, `private/`) was baked
 * into schemas, docs, and agent instructions. This module is the ONLY place
 * in the projects app that still mentions that singular directory: it moves
 * any leftover content into the plural workspace store and never reads the
 * singular path for anything else.
 */
export const LEGACY_PROJECT_LAYOUT_DIR_SEGMENTS = [".hasna", "project"] as const;

export interface LegacyProjectLayoutInfo {
  workspace_id: string;
  /** The retired singular in-project directory, or null when the workspace has no primary path. */
  singular_path: string | null;
  /** The canonical plural per-workspace store for the workspace. */
  plural_path: string;
  present: boolean;
}

export interface LegacyProjectLayoutMigrationResult {
  workspace_id: string;
  singular_path: string | null;
  plural_path: string;
  detected: boolean;
  dry_run: boolean;
  /** Entries moved (or planned to move in a dry run), relative to the singular directory. */
  moved: string[];
  /** Entries left in place because a same-named target already exists or the entry is a symlink. */
  skipped: string[];
  errors: string[];
  /** Whether the now-empty singular directory was removed (never true in a dry run). */
  removed_singular_dir: boolean;
}

/**
 * The retired singular directory for a workspace, absolute. Returns null when
 * the workspace has no primary path.
 */
export function legacyProjectLayoutPath(project: Pick<Workspace, "primary_path">): string | null {
  if (!project.primary_path) return null;
  return resolve(join(project.primary_path, ...LEGACY_PROJECT_LAYOUT_DIR_SEGMENTS));
}

/**
 * Whether a workspace still carries the retired singular directory. This is
 * the only read of the singular path and it is used solely to feed the
 * migration.
 */
export function inspectLegacyProjectLayout(project: Workspace): LegacyProjectLayoutInfo {
  const singularPath = legacyProjectLayoutPath(project);
  return {
    workspace_id: project.id,
    singular_path: singularPath,
    plural_path: projectWorkspaceStorePath(project.id),
    present: Boolean(singularPath && existsSync(singularPath)),
  };
}

/**
 * Move the retired singular in-project directory (see
 * `LEGACY_PROJECT_LAYOUT_DIR_SEGMENTS`) into the plural per-workspace store
 * (`~/.hasna/projects/workspaces/<id>/`), preserving
 * each entry's relative position. Entries whose plural target already exists
 * are skipped, never overwritten. Symlinked entries are skipped. When the
 * whole directory moves, the now-empty singular directory is removed; a
 * surrounding `.hasna` parent that still holds other entries (for example
 * `goals/`) is left untouched.
 */
export function migrateLegacyProjectLayout(
  project: Workspace,
  options: { dryRun?: boolean } = {},
): LegacyProjectLayoutMigrationResult {
  const dryRun = options.dryRun === true;
  const singularPath = legacyProjectLayoutPath(project);
  const pluralPath = projectWorkspaceStorePath(project.id);
  const result: LegacyProjectLayoutMigrationResult = {
    workspace_id: project.id,
    singular_path: singularPath,
    plural_path: pluralPath,
    detected: false,
    dry_run: dryRun,
    moved: [],
    skipped: [],
    errors: [],
    removed_singular_dir: false,
  };
  if (!singularPath || !existsSync(singularPath)) return result;
  if (!statSync(singularPath).isDirectory()) {
    result.errors.push(`singular layout path is not a directory: ${singularPath}`);
    return result;
  }
  if (resolve(pluralPath) === resolve(singularPath) || resolve(pluralPath).startsWith(`${resolve(singularPath)}${sep}`)) {
    result.errors.push(`plural store ${pluralPath} would be moved into itself`);
    return result;
  }

  result.detected = true;
  let entries: string[];
  try {
    entries = readdirSync(singularPath);
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : String(error));
    return result;
  }

  for (const entry of entries) {
    const source = join(singularPath, entry);
    const target = join(pluralPath, entry);
    let isSymlink = false;
    try {
      isSymlink = lstatSync(source).isSymbolicLink();
    } catch (error) {
      result.errors.push(`${entry}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    if (isSymlink) {
      result.skipped.push(entry);
      continue;
    }
    if (existsSync(target)) {
      result.skipped.push(entry);
      continue;
    }
    if (dryRun) {
      result.moved.push(entry);
      continue;
    }
    try {
      cpSync(source, target, { recursive: true });
      rmSync(source, { recursive: true, force: true });
      result.moved.push(entry);
    } catch (error) {
      result.errors.push(`${entry}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (!dryRun && result.errors.length === 0 && readdirSync(singularPath).length === 0) {
    rmSync(singularPath, { recursive: true, force: true });
    result.removed_singular_dir = true;
  }
  return result;
}
