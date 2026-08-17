import type { Database, SQLQueryBindings } from "bun:sqlite";
import type { CreateProjectInput, CreateProjectSourceInput, Project, ProjectSource, ProjectSourceRow, UpdateProjectInput } from "../types/index.js";
import { ProjectNotFoundError, ResourceConflictError } from "../types/index.js";
import { getDatabase, now, uuid } from "./database.js";
import { getMachineId } from "./machines.js";
import { currentStorageMachineId, recordStorageTombstone } from "./storage-tombstones.js";
import { normalizeSlug } from "../lib/slugs.js";
import { claimCanonicalSlug, releaseCanonicalSlugClaims } from "./slug-claims.js";

export function slugify(name: string): string {
  return normalizeSlug(name);
}

function generatePrefix(name: string, db: Database): string {
  // Generate a 3-4 char uppercase prefix from the name
  const words = name.replace(/[^a-zA-Z0-9\s]/g, "").trim().split(/\s+/);
  let prefix: string;
  if (words.length >= 3) {
    prefix = words.slice(0, 3).map(w => w[0]!.toUpperCase()).join("");
  } else if (words.length === 2) {
    prefix = (words[0]!.slice(0, 2) + words[1]![0]!).toUpperCase();
  } else {
    prefix = words[0]!.slice(0, 3).toUpperCase();
  }

  // Ensure uniqueness by appending a number if needed
  let candidate = prefix;
  let suffix = 1;
  while (true) {
    const existing = db.query("SELECT id FROM projects WHERE task_prefix = ?").get(candidate);
    if (!existing) return candidate;
    suffix++;
    candidate = `${prefix}${suffix}`;
  }
}

export function createProject(
  input: CreateProjectInput,
  db?: Database,
): Project {
  const d = db || getDatabase();
  return d.transaction(() => {
    const id = uuid();
    const timestamp = now();
    const derivedSlug = slugify(input.name);
    const taskListId = input.task_list_id === undefined ? derivedSlug : slugify(input.task_list_id);
    if (!derivedSlug || !taskListId) throw new Error("Project name and task-list slug must be non-empty");
    const slugConflict = d.query("SELECT id FROM projects WHERE task_list_id = ? LIMIT 1").get(taskListId);
    if (slugConflict || !claimCanonicalSlug("project", "global", taskListId, id, d)) {
      throw new ResourceConflictError("PROJECT_SLUG_CONFLICT", `Project slug "${taskListId}" already exists`);
    }
    const parentId = input.parent_id ?? null;
    if (parentId !== null) {
      const parent = getProject(parentId, d);
      if (!parent) throw new ProjectNotFoundError(parentId);
      assertNotProjectAncestor(id, parentId, d);
    }
    const taskPrefix = input.task_prefix || generatePrefix(input.name, d);
    const machineId = currentStorageMachineId(d);

    d.run(
      `INSERT INTO projects (id, name, path, description, task_list_id, task_prefix, task_counter, parent_id, created_at, updated_at, machine_id)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
      [id, input.name, input.path, input.description || null, taskListId, taskPrefix, parentId, timestamp, timestamp, machineId],
    );
    return getProject(id, d)!;
  })();
}

export function getProject(id: string, db?: Database): Project | null {
  const d = db || getDatabase();
  const row = d.query("SELECT * FROM projects WHERE id = ?").get(id) as Project | null;
  return row;
}

export function getProjectByPath(path: string, db?: Database): Project | null {
  const d = db || getDatabase();
  // Check machine-local path override first
  try {
    const machineId = getMachineId(d);
    const machineRow = d.query(
      `SELECT p.* FROM projects p
       JOIN project_machine_paths pmp ON pmp.project_id = p.id
       WHERE pmp.machine_id = ? AND pmp.path = ?`
    ).get(machineId, path) as Project | null;
    if (machineRow) return machineRow;
  } catch {}
  // Fall back to global path
  return d.query("SELECT * FROM projects WHERE path = ?").get(path) as Project | null;
}

export function listProjects(db?: Database): Project[] {
  const d = db || getDatabase();
  return d
    .query("SELECT * FROM projects ORDER BY name")
    .all() as Project[];
}

export function listChildProjects(parentId: string, db?: Database): Project[] {
  const d = db || getDatabase();
  return d
    .query("SELECT * FROM projects WHERE parent_id = ? ORDER BY name")
    .all(parentId) as Project[];
}

/**
 * Order projects so every parent precedes its children, regardless of name.
 *
 * projects.parent_id is an immediate foreign key, so importing a child before
 * its parent fails the constraint and drops the child — and everything that
 * points at it, such as its task rows — into the import's error list. Both
 * round-trip import paths (SQLite snapshot restore and bundle import) rely on
 * this ordering and must not depend on the export side's `ORDER BY name`.
 *
 * Stable and cycle-safe: rows whose parent is null, already emitted, or
 * outside the given set keep their original relative order; a malformed input
 * whose parent chain loops falls back to original order instead of hanging or
 * dropping rows silently — the FK constraint then rejects the offending rows
 * per-row and the import records the errors.
 */
export function orderProjectsParentFirst<T extends object>(projects: readonly T[]): T[] {
  const projectId = (project: T): string | null => {
    const id = (project as { id?: unknown }).id;
    return typeof id === "string" && id.length > 0 ? id : null;
  };
  const parentId = (project: T): string | null => {
    const parent = (project as { parent_id?: unknown }).parent_id;
    return parent == null ? null : String(parent);
  };

  const byId = new Set<string>();
  for (const project of projects) {
    const id = projectId(project);
    if (id !== null) byId.add(id);
  }

  const ordered: T[] = [];
  const emitted = new Set<string>();
  let remaining = [...projects];
  let progress = true;
  while (progress && remaining.length > 0) {
    progress = false;
    const deferred: T[] = [];
    for (const project of remaining) {
      const parent = parentId(project);
      if (parent === null || emitted.has(parent) || !byId.has(parent)) {
        ordered.push(project);
        const id = projectId(project);
        if (id !== null) emitted.add(id);
        progress = true;
      } else {
        deferred.push(project);
      }
    }
    remaining = deferred;
  }
  ordered.push(...remaining);
  return ordered;
}

/**
 * Reject making `projectId` a descendant of `ancestorId`. Walks the ancestor
 * chain of the candidate parent; if `projectId` appears anywhere in it, the
 * new link would create a cycle (a project that is its own ancestor).
 */
export function assertNotProjectAncestor(projectId: string, ancestorId: string, db?: Database): void {
  const d = db || getDatabase();
  let cursor: string | null = ancestorId;
  const seen = new Set<string>();
  while (cursor !== null) {
    if (cursor === projectId) {
      throw new ResourceConflictError(
        "PROJECT_PARENT_CYCLE",
        `Project "${projectId}" cannot be placed under its own descendant`,
      );
    }
    if (seen.has(cursor)) break; // defensive: pre-existing corrupt chain must not loop forever
    seen.add(cursor);
    const row = d.query("SELECT parent_id FROM projects WHERE id = ?").get(cursor) as { parent_id: string | null } | null;
    cursor = row?.parent_id ?? null;
  }
}

export function updateProject(
  id: string,
  input: UpdateProjectInput,
  db?: Database,
): Project {
  const d = db || getDatabase();
  const project = getProject(id, d);
  if (!project) throw new ProjectNotFoundError(id);
  if ("task_list_id" in input) {
    throw new Error("task_list_id cannot be changed by updateProject; use renameProject for an atomic canonical rename");
  }

  const sets: string[] = ["updated_at = ?"];
  const params: SQLQueryBindings[] = [now()];

  if (input.name !== undefined) {
    sets.push("name = ?");
    params.push(input.name);
  }
  if (input.description !== undefined) {
    sets.push("description = ?");
    params.push(input.description);
  }
  if (input.path !== undefined) {
    sets.push("path = ?");
    params.push(input.path);
  }
  if (input.parent_id !== undefined) {
    if (input.parent_id !== null) {
      const parent = getProject(input.parent_id, d);
      if (!parent) throw new ProjectNotFoundError(input.parent_id);
      assertNotProjectAncestor(id, input.parent_id, d);
    }
    sets.push("parent_id = ?");
    params.push(input.parent_id);
  }

  params.push(id);
  d.run(`UPDATE projects SET ${sets.join(", ")} WHERE id = ?`, params);

  return getProject(id, d)!;
}

/**
 * Rename a project: update name and/or task_list_id (slug).
 * Cascades slug change to any task_list whose slug matched the old task_list_id.
 * Validates new slug is unique if provided.
 */
export function renameProject(
  id: string,
  input: { name?: string; new_slug?: string },
  db?: Database,
): { project: Project; task_lists_updated: number } {
  const d = db || getDatabase();
  return d.transaction(() => {
    const project = getProject(id, d);
    if (!project) throw new ProjectNotFoundError(id);
    let taskListsUpdated = 0;
    const ts = now();

    if (input.new_slug !== undefined) {
      // Validate slug: lowercase, kebab-case only
      const normalised = normalizeSlug(input.new_slug);
      if (!normalised) throw new Error("Invalid slug — must be non-empty kebab-case");

      const oldSlug = project.task_list_id;
      if (normalised !== oldSlug) {
        const conflict = d.query(
          "SELECT id FROM projects WHERE task_list_id = ? AND id != ?",
        ).get(normalised, id);
        if (conflict) {
          throw new ResourceConflictError("PROJECT_SLUG_CONFLICT", `Slug "${normalised}" is already used by another project`);
        }

        const taskListConflict = d.query(
          "SELECT id FROM task_lists WHERE project_id = ? AND slug = ? AND slug != COALESCE(?, '') LIMIT 1",
        ).get(id, normalised, oldSlug) as { id: string } | null;
        if (taskListConflict) {
          throw new ResourceConflictError(
            "TASK_LIST_SLUG_CONFLICT",
            `Task-list slug "${normalised}" is already used in project "${project.name}"`,
          );
        }
        releaseCanonicalSlugClaims("project", id, d);
        if (!claimCanonicalSlug("project", "global", normalised, id, d)) {
          throw new ResourceConflictError("PROJECT_SLUG_CONFLICT", `Slug "${normalised}" is already used by another project`);
        }
        d.run("UPDATE projects SET task_list_id = ?, updated_at = ? WHERE id = ?", [normalised, ts, id]);
      }
      if (oldSlug && (normalised !== oldSlug || (input.name !== undefined && input.name !== project.name))) {
        taskListsUpdated = d.query(
          "UPDATE task_lists SET slug = ?, name = COALESCE(?, name), updated_at = ? WHERE project_id = ? AND slug = ? RETURNING id",
        ).all(normalised, input.name ?? null, ts, id, oldSlug).length;
      }
    }

    if (input.name !== undefined && input.name !== project.name) {
      d.run("UPDATE projects SET name = ?, updated_at = ? WHERE id = ?", [input.name, ts, id]);
    }

    return { project: getProject(id, d)!, task_lists_updated: taskListsUpdated };
  })();
}

export function deleteProject(id: string, db?: Database): boolean {
  const d = db || getDatabase();
  const project = getProject(id, d);
  if (!project) return false;
  recordStorageTombstone({
    object_type: "projects",
    object_id: id,
    payload: project as unknown as Record<string, unknown>,
  }, d);
  return d.transaction(() => {
    releaseCanonicalSlugClaims("project", id, d);
    return d.run("DELETE FROM projects WHERE id = ?", [id]).changes > 0;
  })();
}

// ── Project Sources ──────────────────────────────────────────────────────────

function rowToSource(row: ProjectSourceRow): ProjectSource {
  return {
    ...row,
    metadata: row.metadata ? (JSON.parse(row.metadata) as Record<string, unknown>) : {},
  };
}

export function addProjectSource(input: CreateProjectSourceInput, db?: Database): ProjectSource {
  const d = db || getDatabase();
  const id = uuid();
  const timestamp = now();
  d.run(
    `INSERT INTO project_sources (id, project_id, type, name, uri, description, metadata, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, input.project_id, input.type, input.name, input.uri, input.description || null,
     JSON.stringify(input.metadata || {}), timestamp, timestamp],
  );
  return rowToSource(d.query("SELECT * FROM project_sources WHERE id = ?").get(id) as ProjectSourceRow);
}

export function removeProjectSource(id: string, db?: Database): boolean {
  const d = db || getDatabase();
  const result = d.run("DELETE FROM project_sources WHERE id = ?", [id]);
  return result.changes > 0;
}

export function listProjectSources(projectId: string, db?: Database): ProjectSource[] {
  const d = db || getDatabase();
  const rows = d.query("SELECT * FROM project_sources WHERE project_id = ? ORDER BY name").all(projectId) as ProjectSourceRow[];
  return rows.map(rowToSource);
}

export function getProjectWithSources(id: string, db?: Database): Project | null {
  const d = db || getDatabase();
  const project = getProject(id, d);
  if (!project) return null;
  project.sources = listProjectSources(id, d);
  return project;
}

export function nextTaskShortId(projectId: string, db?: Database): string | null {
  const d = db || getDatabase();
  const project = getProject(projectId, d);
  if (!project || !project.task_prefix) return null;

  d.run("UPDATE projects SET task_counter = task_counter + 1, updated_at = ? WHERE id = ?", [now(), projectId]);
  const updated = getProject(projectId, d)!;
  const padded = String(updated.task_counter).padStart(5, "0");
  return `${updated.task_prefix}-${padded}`;
}

export function ensureProject(
  name: string,
  path: string,
  db?: Database,
): Project {
  const d = db || getDatabase();
  const existing = getProjectByPath(path, d);
  if (existing) {
    // Backfill prefix for projects created before migration 6
    if (!existing.task_prefix) {
      const prefix = generatePrefix(existing.name, d);
      d.run("UPDATE projects SET task_prefix = ?, updated_at = ? WHERE id = ?", [prefix, now(), existing.id]);
      return getProject(existing.id, d)!;
    }
    // Ensure machine-local path is registered
    setMachineLocalPath(existing.id, path, d);
    return existing;
  }
  const project = createProject({ name, path }, d);
  setMachineLocalPath(project.id, path, d);
  return project;
}

// ── Machine-local project paths ───────────────────────────────────────────────

export interface ProjectMachinePath {
  id: string;
  project_id: string;
  machine_id: string;
  path: string;
  created_at: string;
  updated_at: string;
}

/**
 * Set (upsert) the local path for a project on the current machine.
 * Safe to call at any time — idempotent if path hasn't changed.
 */
export function setMachineLocalPath(projectId: string, path: string, db?: Database): ProjectMachinePath {
  const d = db || getDatabase();
  const machineId = getMachineId(d);
  const ts = now();
  const existing = d.query(
    "SELECT * FROM project_machine_paths WHERE project_id = ? AND machine_id = ?"
  ).get(projectId, machineId) as ProjectMachinePath | null;

  if (existing) {
    if (existing.path !== path) {
      d.run(
        "UPDATE project_machine_paths SET path = ?, updated_at = ? WHERE id = ?",
        [path, ts, existing.id],
      );
    }
    return d.query("SELECT * FROM project_machine_paths WHERE id = ?").get(existing.id) as ProjectMachinePath;
  }

  const id = uuid();
  d.run(
    "INSERT INTO project_machine_paths (id, project_id, machine_id, path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    [id, projectId, machineId, path, ts, ts],
  );
  return d.query("SELECT * FROM project_machine_paths WHERE id = ?").get(id) as ProjectMachinePath;
}

/**
 * Get the local path for a project on the current machine.
 * Falls back to the project's global path if no override is set.
 */
export function getMachineLocalPath(projectId: string, db?: Database): string | null {
  const d = db || getDatabase();
  try {
    const machineId = getMachineId(d);
    const row = d.query(
      "SELECT path FROM project_machine_paths WHERE project_id = ? AND machine_id = ?"
    ).get(projectId, machineId) as { path: string } | null;
    if (row) return row.path;
  } catch {}
  const project = getProject(projectId, d);
  return project?.path ?? null;
}

/**
 * List all machine path overrides for a project.
 */
export function listMachineLocalPaths(projectId: string, db?: Database): ProjectMachinePath[] {
  const d = db || getDatabase();
  return d.query(
    "SELECT * FROM project_machine_paths WHERE project_id = ? ORDER BY machine_id"
  ).all(projectId) as ProjectMachinePath[];
}

/**
 * Remove the local path override for a project on a specific machine (default: current).
 */
export function removeMachineLocalPath(projectId: string, machineId?: string, db?: Database): boolean {
  const d = db || getDatabase();
  const mid = machineId ?? getMachineId(d);
  const existing = d.query(
    "SELECT * FROM project_machine_paths WHERE project_id = ? AND machine_id = ?",
  ).get(projectId, mid) as ProjectMachinePath | null;
  if (!existing) return false;
  recordStorageTombstone({
    object_type: "project_machine_paths",
    object_id: existing.id,
    payload: existing as unknown as Record<string, unknown>,
  }, d);
  const result = d.run(
    "DELETE FROM project_machine_paths WHERE project_id = ? AND machine_id = ?",
    [projectId, mid],
  );
  return result.changes > 0;
}
