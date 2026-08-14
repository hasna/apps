/**
 * Local import/export/sync primitives for hosted-bridge workflows.
 * Produces stable JSON bundles — no automatic cloud calls from OSS.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Database, SQLQueryBindings } from "bun:sqlite";
import { getDatabase, now } from "../db/database.js";
import { listProjects, getProject } from "../db/projects.js";
import { listTasks, getTask, createTask } from "../db/tasks.js";
import { listPlans } from "../db/plans.js";
import { listComments } from "../db/comments.js";
import { listTemplates, exportTemplate, importTemplate } from "../db/templates.js";
import { exportArtifacts } from "../db/artifacts.js";
import { listVerificationRecords } from "./verification-providers.js";
import { applyExportProfile, assertExportProfileAllowed, type ExportProfile } from "./local-encryption.js";
import { redactExportRecord } from "./secret-redaction.js";
import { sanitizePreWriteText, sanitizePreWriteValue } from "./prewrite-secrets.js";
import type { Plan, Project, Task, TaskComment, TaskDependency } from "../types/index.js";

export const BUNDLE_SCHEMA = "todos.bundle.v1";

export const BUNDLE_TYPES = ["full_export", "tasks", "partial"] as const;
export type BundleType = (typeof BUNDLE_TYPES)[number];

export const MERGE_STRATEGIES = ["skip_existing", "remote_wins", "local_wins", "newest_wins"] as const;
export type MergeStrategy = (typeof MERGE_STRATEGIES)[number];

export const CONFLICT_TYPES = [
  "version_mismatch",
  "updated_at_newer_remote",
  "updated_at_newer_local",
  "missing_local",
  "missing_remote",
  "id_collision",
] as const;
export type ConflictType = (typeof CONFLICT_TYPES)[number];

export interface ImportExportBundle {
  schema_version: typeof BUNDLE_SCHEMA;
  bundle_type: BundleType;
  exported_at: string;
  source?: {
    machine_id?: string;
    hostname?: string;
  };
  project_id?: string | null;
  projects: Record<string, unknown>[];
  tasks: Record<string, unknown>[];
  plans: Record<string, unknown>[];
  dependencies: TaskDependency[];
  templates: Record<string, unknown>[];
  comments: Record<string, unknown>[];
  verification_records: Record<string, unknown>[];
  artifacts: Record<string, unknown>;
  metadata: Record<string, unknown>;
  export_profile?: ExportProfile;
  warnings?: string[];
}

export interface ExportLocalBundleOptions {
  project_id?: string;
  bundle_type?: BundleType;
  profile?: ExportProfile;
  acknowledge_plaintext?: boolean;
  include_templates?: boolean;
  include_comments?: boolean;
  include_dependencies?: boolean;
  include_verification?: boolean;
  include_artifacts?: boolean;
}

export interface SyncConflict {
  entity_type: string;
  entity_id: string;
  conflict_type: ConflictType;
  local_version?: number;
  remote_version?: number;
  local_updated_at?: string | null;
  remote_updated_at?: string | null;
  suggested_resolution: MergeStrategy;
}

export interface SyncPreview {
  schema_version: typeof BUNDLE_SCHEMA;
  compared_at: string;
  conflicts: SyncConflict[];
  summary: {
    create: number;
    update: number;
    skip: number;
    conflict: number;
  };
}

export interface ImportBundleOptions {
  strategy?: MergeStrategy;
  dry_run?: boolean;
}

export interface ImportResult {
  schema_version: typeof BUNDLE_SCHEMA;
  dry_run: boolean;
  created: Record<string, number>;
  updated: Record<string, number>;
  skipped: Record<string, number>;
  conflicts: SyncConflict[];
  errors: string[];
}

function sqlValue(value: unknown): SQLQueryBindings {
  if (value === undefined || value === null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "bigint" || typeof value === "boolean") return value;
  if (value instanceof Uint8Array) return value;
  return JSON.stringify(value);
}

function serializeProject(project: Project): Record<string, unknown> {
  return {
    schema_version: "todos.project.v1",
    ...project,
  };
}

function serializeTask(task: Task): Record<string, unknown> {
  return {
    schema_version: "todos.task.v1",
    ...task,
  };
}

function serializePlan(plan: Plan): Record<string, unknown> {
  return {
    schema_version: "todos.plan.v1",
    ...plan,
  };
}

function serializeComment(comment: TaskComment): Record<string, unknown> {
  return {
    schema_version: "todos.comment.v1",
    ...comment,
  };
}

function getHostname(): string {
  try {
    return require("node:os").hostname() as string;
  } catch {
    return "unknown";
  }
}

function listAllDependencies(taskIds: Set<string>, db: Database): TaskDependency[] {
  if (taskIds.size === 0) return [];
  const placeholders = [...taskIds].map(() => "?").join(", ");
  return db
    .query(`SELECT * FROM task_dependencies WHERE task_id IN (${placeholders}) OR depends_on IN (${placeholders})`)
    .all(...taskIds, ...taskIds) as TaskDependency[];
}

function listAllComments(taskIds: Set<string>, db: Database): TaskComment[] {
  const out: TaskComment[] = [];
  for (const taskId of taskIds) {
    out.push(...listComments(taskId, db));
  }
  return out;
}

export function validateBundle(bundle: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!bundle || typeof bundle !== "object") {
    return { valid: false, errors: ["Bundle must be an object"] };
  }
  const b = bundle as Partial<ImportExportBundle>;
  if (b.schema_version !== BUNDLE_SCHEMA) errors.push(`schema_version must be ${BUNDLE_SCHEMA}`);
  if (!b.bundle_type || !BUNDLE_TYPES.includes(b.bundle_type)) errors.push(`bundle_type must be one of: ${BUNDLE_TYPES.join(", ")}`);
  if (!b.exported_at) errors.push("exported_at is required");
  if (!Array.isArray(b.tasks)) errors.push("tasks must be an array");
  if (!Array.isArray(b.projects)) errors.push("projects must be an array");
  if (!Array.isArray(b.plans)) errors.push("plans must be an array");
  if (!Array.isArray(b.dependencies)) errors.push("dependencies must be an array");
  if (!Array.isArray(b.templates)) errors.push("templates must be an array");
  if (!Array.isArray(b.comments)) errors.push("comments must be an array");
  if (!Array.isArray(b.verification_records)) errors.push("verification_records must be an array");
  return { valid: errors.length === 0, errors };
}

export function exportLocalBundle(options: ExportLocalBundleOptions = {}, db?: Database): ImportExportBundle {
  const d = db || getDatabase();
  const profile = assertExportProfileAllowed(options.profile ?? "redacted");
  const projectId = options.project_id;
  const warnings: string[] = [];

  const projects = (projectId ? [getProject(projectId, d)].filter(Boolean) : listProjects(d)) as Project[];
  const tasks = listTasks(projectId ? { project_id: projectId } : {}, d);
  const taskIds = new Set(tasks.map((t) => t.id));

  const plans = projectId ? listPlans(projectId, d) : listPlans(undefined, d);
  const dependencies = options.include_dependencies === false ? [] : listAllDependencies(taskIds, d);
  const comments = options.include_comments === false ? [] : listAllComments(taskIds, d);

  const templates =
    options.include_templates === false
      ? []
      : listTemplates(d).map((t) => ({ schema_version: "todos.template.v1", id: t.id, ...exportTemplate(t.id, d) }));

  const verificationRecords =
    options.include_verification === false
      ? []
      : listVerificationRecords({}, d).map((r) => ({ schema_version: "todos.verification.v1", ...r }));

  const artifacts =
    options.include_artifacts === false
      ? { schema_version: "todos.artifacts.v1", artifacts: [] }
      : exportArtifacts(projectId ? { entity_type: "project", entity_id: projectId } : {}, d);

  const bundleData: Record<string, unknown> = {
    projects: projects.map(serializeProject),
    tasks: tasks.map(serializeTask),
    plans: plans.map(serializePlan),
    dependencies,
    templates,
    comments: comments.map(serializeComment),
    verification_records: verificationRecords,
    artifacts,
  };

  const { data, warnings: profileWarnings } = applyExportProfile(bundleData, {
    profile,
    acknowledge_plaintext: options.acknowledge_plaintext,
  });
  const redacted = data as Partial<ImportExportBundle>;
  warnings.push(...profileWarnings);

  return {
    schema_version: BUNDLE_SCHEMA,
    bundle_type: options.bundle_type ?? (projectId ? "partial" : "full_export"),
    exported_at: new Date().toISOString(),
    source: {
      machine_id: process.env["TODOS_MACHINE_ID"],
      hostname: getHostname(),
    },
    project_id: projectId ?? null,
    projects: (redacted.projects as Record<string, unknown>[]) ?? [],
    tasks: (redacted.tasks as Record<string, unknown>[]) ?? [],
    plans: (redacted.plans as Record<string, unknown>[]) ?? [],
    dependencies: (redacted.dependencies as TaskDependency[]) ?? [],
    templates: (redacted.templates as Record<string, unknown>[]) ?? [],
    comments: (redacted.comments as Record<string, unknown>[]) ?? [],
    verification_records: (redacted.verification_records as Record<string, unknown>[]) ?? [],
    artifacts: (redacted.artifacts as Record<string, unknown>) ?? {},
    metadata: {
      entity_counts: {
        projects: projects.length,
        tasks: tasks.length,
        plans: plans.length,
        dependencies: dependencies.length,
        templates: templates.length,
        comments: comments.length,
        verification_records: verificationRecords.length,
      },
    },
    export_profile: profile,
    warnings,
  };
}

function compareEntity(
  entityType: string,
  entityId: string,
  remote: { version?: number; updated_at?: string | null },
  local: { version?: number; updated_at?: string | null } | null,
  strategy: MergeStrategy,
): { action: "create" | "update" | "skip" | "conflict"; conflict?: SyncConflict } {
  if (!local) {
    return { action: "create" };
  }

  const localVersion = local.version ?? 1;
  const remoteVersion = remote.version ?? 1;
  const localUpdated = local.updated_at ?? null;
  const remoteUpdated = remote.updated_at ?? null;

  if (localVersion !== remoteVersion) {
    const conflict: SyncConflict = {
      entity_type: entityType,
      entity_id: entityId,
      conflict_type: "version_mismatch",
      local_version: localVersion,
      remote_version: remoteVersion,
      local_updated_at: localUpdated,
      remote_updated_at: remoteUpdated,
      suggested_resolution: strategy,
    };
    if (strategy === "skip_existing") return { action: "skip", conflict };
    if (strategy === "local_wins") return { action: "skip", conflict };
    if (strategy === "remote_wins") return { action: "update", conflict };
    // newest_wins
    if (remoteUpdated && localUpdated && remoteUpdated > localUpdated) return { action: "update", conflict };
    if (remoteUpdated && localUpdated && localUpdated > remoteUpdated) return { action: "skip", conflict };
    return { action: "conflict", conflict };
  }

  if (remoteUpdated && localUpdated && remoteUpdated !== localUpdated) {
    const conflict: SyncConflict = {
      entity_type: entityType,
      entity_id: entityId,
      conflict_type: remoteUpdated > localUpdated ? "updated_at_newer_remote" : "updated_at_newer_local",
      local_updated_at: localUpdated,
      remote_updated_at: remoteUpdated,
      suggested_resolution: strategy,
    };
    if (strategy === "skip_existing" || strategy === "local_wins") return { action: "skip", conflict };
    if (strategy === "remote_wins") return { action: "update", conflict };
    return remoteUpdated > localUpdated ? { action: "update", conflict } : { action: "skip", conflict };
  }

  return { action: "skip" };
}

export function previewSync(bundle: ImportExportBundle, strategy: MergeStrategy = "newest_wins", db?: Database): SyncPreview {
  const d = db || getDatabase();
  const validation = validateBundle(bundle);
  if (!validation.valid) throw new Error(`Invalid bundle: ${validation.errors.join("; ")}`);

  const conflicts: SyncConflict[] = [];
  let create = 0;
  let update = 0;
  let skip = 0;
  let conflict = 0;

  for (const raw of bundle.tasks) {
    const id = raw.id as string;
    const local = getTask(id, d);
    const result = compareEntity("task", id, raw as unknown as Task, local, strategy);
    if (result.action === "create") create++;
    else if (result.action === "update") update++;
    else if (result.action === "conflict") conflict++;
    else skip++;
    if (result.conflict) conflicts.push(result.conflict);
  }

  for (const raw of bundle.projects) {
    const id = raw.id as string;
    const local = getProject(id, d);
    const result = compareEntity("project", id, raw as unknown as Project, local, strategy);
    if (result.action === "create") create++;
    else if (result.action === "update") update++;
    else if (result.action === "conflict") conflict++;
    else skip++;
    if (result.conflict) conflicts.push(result.conflict);
  }

  return {
    schema_version: BUNDLE_SCHEMA,
    compared_at: new Date().toISOString(),
    conflicts,
    summary: { create, update, skip, conflict },
  };
}

function upsertProject(raw: Record<string, unknown>, d: Database): "created" | "updated" {
  const id = raw.id as string;
  const existing = getProject(id, d);
  const ts = now();
  if (!existing) {
    d.run(
      `INSERT INTO projects (id, name, path, description, task_list_id, task_prefix, task_counter, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        raw.name,
        raw.path,
        raw.description ?? null,
        raw.task_list_id ?? `todos-${String(raw.name).toLowerCase().replace(/\s+/g, "-")}`,
        raw.task_prefix ?? "TSK",
        raw.task_counter ?? 0,
        raw.created_at ?? ts,
        raw.updated_at ?? ts,
      ].map(sqlValue),
    );
    return "created";
  }
  d.run(
    `UPDATE projects SET name = ?, path = ?, description = ?, task_list_id = ?, task_prefix = ?, task_counter = ?, updated_at = ?
     WHERE id = ?`,
    [
      raw.name ?? existing.name,
      raw.path ?? existing.path,
      raw.description ?? existing.description,
      raw.task_list_id ?? existing.task_list_id,
      raw.task_prefix ?? existing.task_prefix,
      raw.task_counter ?? existing.task_counter,
      raw.updated_at ?? ts,
      id,
    ].map(sqlValue),
  );
  return "updated";
}

function upsertTask(raw: Record<string, unknown>, d: Database): "created" | "updated" {
  const id = raw.id as string;
  const existing = getTask(id, d);
  if (!existing) {
    createTask(
      {
        title: raw.title as string,
        description: (raw.description as string) ?? undefined,
        project_id: (raw.project_id as string) ?? undefined,
        parent_id: (raw.parent_id as string) ?? undefined,
        plan_id: (raw.plan_id as string) ?? undefined,
        task_list_id: (raw.task_list_id as string) ?? undefined,
        status: raw.status as Task["status"],
        priority: raw.priority as Task["priority"],
        tags: (raw.tags as string[]) ?? [],
        metadata: (raw.metadata as Record<string, unknown>) ?? {},
      },
      d,
    );
    // createTask generates new id — reassign if we need preserved id
    const created = d.query("SELECT id FROM tasks ORDER BY created_at DESC LIMIT 1").get() as { id: string };
    if (created.id !== id) {
      d.run("UPDATE tasks SET id = ? WHERE id = ?", [id, created.id]);
    }
    return "created";
  }

  d.run(
    `UPDATE tasks SET title = ?, description = ?, status = ?, priority = ?, tags = ?, metadata = ?, version = ?, updated_at = ?
     WHERE id = ?`,
    [
      sanitizePreWriteText(String(raw.title ?? existing.title), "import.task.title"),
      raw.description !== undefined
        ? sanitizePreWriteText(String(raw.description ?? ""), "import.task.description")
        : existing.description,
      raw.status ?? existing.status,
      raw.priority ?? existing.priority,
      JSON.stringify(sanitizePreWriteValue(raw.tags ?? existing.tags, "import.task.tags")),
      JSON.stringify(redactExportRecord(sanitizePreWriteValue((raw.metadata ?? existing.metadata) as Record<string, unknown>, "import.task.metadata"))),
      raw.version ?? existing.version,
      raw.updated_at ?? now(),
      id,
    ].map(sqlValue),
  );
  return "updated";
}

function upsertComment(raw: Record<string, unknown>, d: Database): "created" | "skipped" {
  const id = raw.id as string;
  const exists = d.query("SELECT id FROM task_comments WHERE id = ?").get(id);
  if (exists) return "skipped";
  d.run(
    `INSERT INTO task_comments (id, task_id, agent_id, session_id, content, type, progress_pct, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      raw.task_id,
      raw.agent_id ?? null,
      raw.session_id ?? null,
      raw.content === undefined || raw.content === null ? null : sanitizePreWriteText(String(raw.content), "import.comment.content"),
      raw.type ?? "comment",
      raw.progress_pct ?? null,
      raw.created_at ?? now(),
    ].map(sqlValue),
  );
  return "created";
}

export function importBundle(bundle: ImportExportBundle, options: ImportBundleOptions = {}, db?: Database): ImportResult {
  const d = db || getDatabase();
  const validation = validateBundle(bundle);
  if (!validation.valid) throw new Error(`Invalid bundle: ${validation.errors.join("; ")}`);

  const strategy = options.strategy ?? "newest_wins";
  const preview = previewSync(bundle, strategy, d);
  const result: ImportResult = {
    schema_version: BUNDLE_SCHEMA,
    dry_run: !!options.dry_run,
    created: {},
    updated: {},
    skipped: {},
    conflicts: preview.conflicts,
    errors: [],
  };

  const bump = (map: Record<string, number>, key: string) => {
    map[key] = (map[key] ?? 0) + 1;
  };

  if (options.dry_run) return result;

  for (const raw of bundle.projects) {
    try {
      const id = raw.id as string;
      const local = getProject(id, d);
      const action = compareEntity("project", id, raw as unknown as Project, local, strategy).action;
      if (action === "skip" || action === "conflict") {
        bump(result.skipped, "projects");
        continue;
      }
      const outcome = upsertProject(raw, d);
      bump(outcome === "created" ? result.created : result.updated, "projects");
    } catch (e) {
      result.errors.push(`project ${raw.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  for (const raw of bundle.tasks) {
    try {
      const id = raw.id as string;
      const local = getTask(id, d);
      const action = compareEntity("task", id, raw as unknown as Task, local, strategy).action;
      if (action === "skip" || action === "conflict") {
        bump(result.skipped, "tasks");
        continue;
      }
      const outcome = upsertTask(raw, d);
      bump(outcome === "created" ? result.created : result.updated, "tasks");
    } catch (e) {
      result.errors.push(`task ${raw.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  for (const dep of bundle.dependencies) {
    try {
      d.run("INSERT OR IGNORE INTO task_dependencies (task_id, depends_on) VALUES (?, ?)", [dep.task_id, dep.depends_on]);
      bump(result.created, "dependencies");
    } catch (e) {
      result.errors.push(`dependency ${dep.task_id}->${dep.depends_on}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  for (const raw of bundle.comments) {
    try {
      const outcome = upsertComment(raw, d);
      bump(outcome === "created" ? result.created : result.skipped, "comments");
    } catch (e) {
      result.errors.push(`comment ${raw.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  for (const raw of bundle.templates) {
    try {
      const { id: _id, schema_version: _sv, ...templateExport } = raw;
      importTemplate(templateExport as unknown as Parameters<typeof importTemplate>[0], d);
      bump(result.created, "templates");
    } catch (e) {
      result.errors.push(`template ${raw.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return result;
}

export function writeBundleFile(bundle: ImportExportBundle, path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(bundle, null, 2), "utf8");
}

export function readBundleFile(path: string): ImportExportBundle {
  const raw = JSON.parse(readFileSync(path, "utf8")) as ImportExportBundle;
  const validation = validateBundle(raw);
  if (!validation.valid) throw new Error(`Invalid bundle file: ${validation.errors.join("; ")}`);
  return raw;
}

export function getBridgeDocs(): string {
  return `# Local Import/Export/Sync Bridge

OSS @hasna/todos produces stable \`${BUNDLE_SCHEMA}\` JSON bundles for hosted wrapper consumption.
No automatic cloud calls are made from the OSS package.

## Bundle types
- \`full_export\` — all local entities
- \`partial\` — scoped to a project
- \`tasks\` — task-focused subset

## Merge strategies
- \`skip_existing\` — never overwrite local records
- \`local_wins\` — keep local on conflict
- \`remote_wins\` — incoming bundle wins
- \`newest_wins\` — compare \`updated_at\` timestamps (default)

## Conflict metadata
Each sync preview includes \`version_mismatch\` and timestamp conflicts with suggested resolution.

## Export profiles
Use \`redacted\` (default) or \`encrypted\` for sensitive data. Plaintext exports require an explicit acknowledgement and should not be used for task evidence.
`;
}
