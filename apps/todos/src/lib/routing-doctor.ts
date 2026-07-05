import type { Database } from "bun:sqlite";
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { getDatabase, getDatabasePath, now } from "../db/database.js";
import { addComment } from "../db/comments.js";
import { getProject, listProjects } from "../db/projects.js";
import { getTaskList, getTaskListBySlug } from "../db/task-lists.js";
import { getTask, listTasks, updateTask } from "../db/tasks.js";
import type { Project, Task, TaskList, TaskStatus } from "../types/index.js";
import { getTaskRouteState } from "./task-routing.js";
import { isWorktreePath } from "./task-route-contract.js";

export const TODOS_ROUTING_DOCTOR_SCHEMA_VERSION = "todos.routing_doctor.v1";

/** Deterministic finding categories the routing doctor can emit. */
export type RoutingFindingCategory =
  | "null_working_dir"
  | "wrong_working_dir"
  | "null_task_list_id"
  | "unresolvable_task_list"
  | "invalid_project_path"
  | "missing_project"
  | "no_auto_conflict"
  | "cross_repo_intent"
  | "route_not_enabled";

/**
 * Repairability classification consumed by OpenLoops. Only `safe_auto` findings
 * are ever mutated by `--apply`; every other class is reported for a human or a
 * different owning repo and is never guessed at.
 */
export type RoutingRepairClass =
  | "safe_auto"
  | "blocker_human"
  | "blocker_cross_repo"
  | "blocker_invalid_path"
  | "unsupported";

export type RoutingFindingSeverity = "error" | "warn";

export type RoutingRepairField = "working_dir" | "task_list_id";

export interface RoutingSuggestedRepair {
  field: RoutingRepairField;
  from: string | null;
  to: string;
  /** Supported CLI invocation that performs this exact repair. */
  command: string;
}

export interface RoutingFinding {
  category: RoutingFindingCategory;
  severity: RoutingFindingSeverity;
  repair_class: RoutingRepairClass;
  task_id: string;
  task_short_id: string | null;
  title: string;
  status: TaskStatus;
  project_id: string | null;
  project_name: string | null;
  /** Resolved owning-repo path (machine-local override honoured). */
  project_path: string | null;
  working_dir: string | null;
  expected_working_dir: string | null;
  task_list_id: string | null;
  task_list_state: "ok" | "null" | "unresolvable";
  route_eligible: boolean;
  route_class: string;
  route_reasons: string[];
  detail: string;
  suggested_repair: RoutingSuggestedRepair | null;
}

export interface RoutingRepairRecord {
  task_id: string;
  task_short_id: string | null;
  category: RoutingFindingCategory;
  field: RoutingRepairField;
  from: string | null;
  to: string;
  command: string;
  applied: boolean;
  error?: string;
}

export interface RoutingDoctorSummary {
  inspected: number;
  eligible: number;
  findings_total: number;
  by_category: Record<string, number>;
  by_repair_class: Record<string, number>;
  safe_auto: number;
  blockers: number;
  unsupported: number;
  repaired: number;
  repair_failed: number;
}

export interface RoutingDoctorScope {
  statuses: TaskStatus[];
  project_id: string | null;
  tag: string | null;
  shard: { index: number; total: number } | null;
  include_archived: boolean;
  verify_project_root: boolean;
  limit: number | null;
}

export interface RoutingDoctorBackup {
  path: string;
  files: string[];
}

export interface RoutingDoctorResult {
  schema_version: typeof TODOS_ROUTING_DOCTOR_SCHEMA_VERSION;
  generated_at: string;
  /** True when no findings remain (post-repair when `apply` is set). */
  ok: boolean;
  dry_run: boolean;
  database_path: string;
  scope: RoutingDoctorScope;
  summary: RoutingDoctorSummary;
  findings: RoutingFinding[];
  repairs: RoutingRepairRecord[];
  backup?: RoutingDoctorBackup;
  undo_record_path?: string;
}

export interface RunRoutingDoctorOptions {
  db?: Database;
  dbPath?: string;
  statuses?: TaskStatus[];
  projectId?: string;
  tag?: string;
  shardIndex?: number;
  shardTotal?: number;
  includeArchived?: boolean;
  verifyProjectRoot?: boolean;
  apply?: boolean;
  actor?: string;
  undoRecordPath?: string;
  limit?: number;
  now?: () => string;
}

const DEFAULT_STATUSES: TaskStatus[] = ["pending", "in_progress"];

function normalizePath(path: string | null | undefined): string | null {
  if (!path) return null;
  const trimmed = path.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

function looksLikeRemoteUri(path: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(path);
}

function looksLikeLocalAbsolutePath(path: string): boolean {
  return path.startsWith("/") && !looksLikeRemoteUri(path);
}

function looksLikeMacHomePath(path: string): boolean {
  return /^\/Users\//.test(path);
}

/** FNV-1a — a small, dependency-free, stable string hash for deterministic sharding. */
function stableHash(key: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Assign a stable shard. A task's shard key is its project (so a project never splits) else its id. */
export function routingShardOf(task: Pick<Task, "id" | "project_id">, total: number): number {
  if (total <= 1) return 0;
  const key = task.project_id ?? task.id;
  return stableHash(key) % total;
}

function repoSlugForProject(project: Project): string {
  const fromPath = project.path && looksLikeLocalAbsolutePath(project.path) ? basename(normalizePath(project.path) ?? "") : "";
  if (fromPath) return fromPath.toLowerCase();
  return project.name.trim().toLowerCase().replace(/\s+/g, "-");
}

const REPO_NAME_RE = /\bopen-[a-z0-9][a-z0-9-]{1,48}\b/gi;

/**
 * Conservative, heuristic cross-repo intent detector. Returns the foreign repo
 * slug only when the title explicitly names a *different, known* `open-*` repo
 * and does NOT also name its own repo. Never triggers an automatic repair —
 * cross-repo findings are always reported for a human.
 */
export function detectCrossRepoIntent(
  task: Pick<Task, "title" | "tags">,
  project: Project | null,
  knownRepoSlugs: Set<string>,
): string | null {
  if (!project) return null;
  const ownSlug = repoSlugForProject(project);
  const named = new Set<string>();
  for (const match of task.title.matchAll(REPO_NAME_RE)) named.add(match[0].toLowerCase());
  for (const tag of task.tags) {
    const m = /^repo:(.+)$/i.exec(tag);
    if (m && m[1]) named.add(m[1].trim().toLowerCase());
  }
  if (named.size === 0) return null;
  if (named.has(ownSlug)) return null;
  for (const candidate of named) {
    if (candidate !== ownSlug && knownRepoSlugs.has(candidate)) return candidate;
  }
  return null;
}

function bump(map: Record<string, number>, key: string): void {
  map[key] = (map[key] ?? 0) + 1;
}

function resolveCanonicalTaskList(project: Project | null, db: Database): TaskList | null {
  if (!project?.task_list_id) return null;
  return getTaskList(project.task_list_id, db) ?? getTaskListBySlug(project.task_list_id, project.id, db);
}

function taskListState(task: Task, project: Project | null, db: Database): "ok" | "null" | "unresolvable" {
  if (!task.task_list_id) return "null";
  const resolved = getTaskList(task.task_list_id, db) ?? (project ? getTaskListBySlug(task.task_list_id, project.id, db) : null);
  return resolved ? "ok" : "unresolvable";
}

interface ClassifyContext {
  task: Task;
  project: Project | null;
  db: Database;
  knownRepoSlugs: Set<string>;
  verifyProjectRoot: boolean;
}

interface TaskRoutingEvaluation {
  findings: RoutingFinding[];
  eligible: boolean;
}

/**
 * Pure-ish classification for one task. Emits zero or more findings. Depends on
 * `getTaskRouteState` for the authoritative eligibility/route context so the
 * doctor and the OpenLoops drain agree on route enablement.
 */
export function classifyTaskRouting(ctx: ClassifyContext): RoutingFinding[] {
  return evaluateTaskRouting(ctx).findings;
}

function evaluateTaskRouting(ctx: ClassifyContext): TaskRoutingEvaluation {
  const { task, project, db, knownRepoSlugs, verifyProjectRoot } = ctx;
  const rs = getTaskRouteState(task, db, { verifyProjectRoot });
  const findings: RoutingFinding[] = [];
  const projectPath = normalizePath(rs.route.project_path);
  const workingDir = task.working_dir ? normalizePath(task.working_dir) : null;
  const projectRootExists = rs.evidence.project_root_exists; // boolean | null
  const routeOptIn = rs.gates.tag_opt_in || rs.gates.route_enabled;
  const crossRepoForeign = detectCrossRepoIntent(task, project, knownRepoSlugs);

  const base = {
    task_id: task.id,
    task_short_id: task.short_id,
    title: task.title,
    status: task.status,
    project_id: rs.route.project_id,
    project_name: project?.name ?? null,
    project_path: rs.route.project_path,
    working_dir: task.working_dir,
    task_list_id: task.task_list_id,
    route_eligible: rs.eligible,
    route_class: rs.route_class,
    route_reasons: rs.reasons,
  };

  const listState = taskListState(task, project, db);

  // --- Project path / project presence ---------------------------------------
  const pathIsLocal = projectPath ? looksLikeLocalAbsolutePath(projectPath) : false;
  const pathInvalidOnMachine = verifyProjectRoot && pathIsLocal && projectRootExists === false;
  const projectMissingPath = project !== null && (!projectPath || (pathIsLocal === false && !looksLikeRemoteUri(projectPath ?? "")));

  if (!project && !task.project_id) {
    if (routeOptIn && !workingDir) {
      findings.push({
        ...base,
        category: "missing_project",
        severity: "warn",
        repair_class: "unsupported",
        expected_working_dir: null,
        task_list_state: listState,
        detail: "Route-opted-in task has no project and no working_dir; cannot derive an owning repo path.",
        suggested_repair: null,
      });
    }
  } else if (pathInvalidOnMachine || projectMissingPath) {
    const macHome = projectPath ? looksLikeMacHomePath(projectPath) : false;
    findings.push({
      ...base,
      category: "invalid_project_path",
      severity: "warn",
      repair_class: "blocker_invalid_path",
      expected_working_dir: null,
      task_list_state: listState,
      detail: projectMissingPath
        ? "Owning project has no usable local/remote path."
        : `Owning project path does not exist on this machine${macHome ? " (macOS home path — likely valid on its home Mac)" : ""}. Reported, not rewritten.`,
      suggested_repair: null,
    });
  }

  // Whether working_dir/task_list repairs may proceed: only when we have a
  // verified, existing, local owning path and no cross-repo doubt.
  const haveGoodProjectPath = Boolean(projectPath && pathIsLocal && projectRootExists === true);

  // --- working_dir -----------------------------------------------------------
  if (project && projectPath) {
    if (!workingDir) {
      if (crossRepoForeign) {
        findings.push({
          ...base,
          category: "null_working_dir",
          severity: "warn",
          repair_class: "blocker_cross_repo",
          expected_working_dir: rs.route.project_path,
          task_list_state: listState,
          detail: `working_dir is empty and title names a different repo (${crossRepoForeign}); resolve project ownership before setting a path.`,
          suggested_repair: null,
        });
      } else if (haveGoodProjectPath) {
        findings.push({
          ...base,
          category: "null_working_dir",
          severity: "error",
          repair_class: "safe_auto",
          expected_working_dir: rs.route.project_path,
          task_list_state: listState,
          detail: "working_dir is empty; set it to the owning project path.",
          suggested_repair: {
            field: "working_dir",
            from: null,
            to: rs.route.project_path as string,
            command: `todos update ${task.id} --working-dir ${rs.route.project_path}`,
          },
        });
      } else if (pathInvalidOnMachine) {
        findings.push({
          ...base,
          category: "null_working_dir",
          severity: "warn",
          repair_class: "blocker_invalid_path",
          expected_working_dir: rs.route.project_path,
          task_list_state: listState,
          detail: "working_dir is empty but the owning project path is not present on this machine; cannot safely set it here.",
          suggested_repair: null,
        });
      }
    } else if (!isWorktreePath(task.working_dir as string) && workingDir !== projectPath) {
      if (crossRepoForeign) {
        findings.push({
          ...base,
          category: "wrong_working_dir",
          severity: "warn",
          repair_class: "blocker_cross_repo",
          expected_working_dir: rs.route.project_path,
          task_list_state: listState,
          detail: `working_dir (${task.working_dir}) differs from the owning project and the title names a different repo (${crossRepoForeign}); resolve ownership first.`,
          suggested_repair: null,
        });
      } else if (haveGoodProjectPath) {
        findings.push({
          ...base,
          category: "wrong_working_dir",
          severity: "error",
          repair_class: "safe_auto",
          expected_working_dir: rs.route.project_path,
          task_list_state: listState,
          detail: `working_dir (${task.working_dir}) does not match the owning project path; repoint it.`,
          suggested_repair: {
            field: "working_dir",
            from: task.working_dir,
            to: rs.route.project_path as string,
            command: `todos update ${task.id} --working-dir ${rs.route.project_path}`,
          },
        });
      } else if (pathInvalidOnMachine) {
        findings.push({
          ...base,
          category: "wrong_working_dir",
          severity: "warn",
          repair_class: "blocker_invalid_path",
          expected_working_dir: rs.route.project_path,
          task_list_state: listState,
          detail: `working_dir (${task.working_dir}) differs from the owning project, but that project path is absent on this machine; reported, not rewritten.`,
          suggested_repair: null,
        });
      }
    }
  }

  // --- task_list_id ----------------------------------------------------------
  if (listState === "null") {
    const canonical = resolveCanonicalTaskList(project, db);
    if (canonical) {
      findings.push({
        ...base,
        category: "null_task_list_id",
        severity: "error",
        repair_class: "safe_auto",
        expected_working_dir: rs.route.project_path,
        task_list_state: listState,
        detail: `task_list_id is null; link to the owning project's task list (${canonical.slug ?? canonical.id}) by UUID.`,
        suggested_repair: {
          field: "task_list_id",
          from: null,
          to: canonical.id,
          command: `todos update ${task.id} --list ${canonical.id}`,
        },
      });
    } else if (project) {
      findings.push({
        ...base,
        category: "null_task_list_id",
        severity: "warn",
        repair_class: "unsupported",
        expected_working_dir: rs.route.project_path,
        task_list_state: listState,
        detail: `task_list_id is null and the owning project has no resolvable task list${project.task_list_id ? ` (slug ${project.task_list_id} resolves to no row)` : ""}; create the list before linking.`,
        suggested_repair: null,
      });
    }
  } else if (listState === "unresolvable") {
    const canonical = resolveCanonicalTaskList(project, db);
    if (canonical && canonical.id !== task.task_list_id) {
      findings.push({
        ...base,
        category: "unresolvable_task_list",
        severity: "error",
        repair_class: "safe_auto",
        expected_working_dir: rs.route.project_path,
        task_list_state: listState,
        detail: `task_list_id (${task.task_list_id}) resolves to no task list; relink to the owning project's list (${canonical.slug ?? canonical.id}) by UUID.`,
        suggested_repair: {
          field: "task_list_id",
          from: task.task_list_id,
          to: canonical.id,
          command: `todos update ${task.id} --list ${canonical.id}`,
        },
      });
    } else {
      findings.push({
        ...base,
        category: "unresolvable_task_list",
        severity: "warn",
        repair_class: "blocker_human",
        expected_working_dir: rs.route.project_path,
        task_list_state: listState,
        detail: `task_list_id (${task.task_list_id}) resolves to no task list and no canonical project list is available to relink to; reported without guessing.`,
        suggested_repair: null,
      });
    }
  }

  // --- automation contradictions & route enablement --------------------------
  if (rs.gates.tag_opt_in && rs.gates.no_auto) {
    findings.push({
      ...base,
      category: "no_auto_conflict",
      severity: "warn",
      repair_class: "blocker_human",
      expected_working_dir: rs.route.project_path,
      task_list_state: listState,
      detail: "Task carries both an auto:route/route:enabled tag and a no-auto deny signal; a triage decision is required (doctor does not guess).",
      suggested_repair: null,
    });
  }

  if (rs.gates.tag_opt_in && !rs.eligible && rs.reasons.includes("route_not_enabled")) {
    findings.push({
      ...base,
      category: "route_not_enabled",
      severity: "warn",
      repair_class: "blocker_human",
      expected_working_dir: rs.route.project_path,
      task_list_state: listState,
      detail: "Task is tag-opted-in to routing but an explicit route_enabled:false denies it; reconcile the contradiction (doctor does not override an explicit deny).",
      suggested_repair: null,
    });
  }

  return { findings, eligible: rs.eligible };
}

function createBackup(dbPath: string, generatedAt: string): RoutingDoctorBackup | undefined {
  if (dbPath === ":memory:" || dbPath.startsWith("file::memory:")) return undefined;
  if (!existsSync(dbPath)) return undefined;
  const stamp = generatedAt.replace(/[:.]/g, "-");
  const backupDir = join(dirname(dbPath), `${basename(dbPath)}.routing-doctor-backup-${stamp}`);
  const files: string[] = [];
  mkdirSync(backupDir, { recursive: true });
  for (const source of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    if (!existsSync(source)) continue;
    const target = join(backupDir, basename(source));
    copyFileSync(source, target);
    files.push(target);
  }
  return files.length > 0 ? { path: backupDir, files } : undefined;
}

/**
 * Supported CLI command that restores a repair's prior value. Null-origin
 * repairs (the field was null before we set it) restore via the explicit
 * `--clear-working-dir` / `--clear-list` reset flags — a bare `--working-dir ''`
 * or `--list ''` is falsy in the CLI wiring and would be a silent no-op, which
 * is exactly the fake-undo the record must never contain.
 */
export function routingRepairUndoCommand(repair: Pick<RoutingRepairRecord, "task_id" | "field" | "from">): string {
  if (repair.field === "working_dir") {
    return repair.from === null
      ? `todos update ${repair.task_id} --clear-working-dir`
      : `todos update ${repair.task_id} --working-dir ${repair.from}`;
  }
  return repair.from === null
    ? `todos update ${repair.task_id} --clear-list`
    : `todos update ${repair.task_id} --list ${repair.from}`;
}

function applySafeRepair(
  finding: RoutingFinding,
  actor: string,
  generatedAt: string,
  db: Database,
): RoutingRepairRecord {
  const repair = finding.suggested_repair as RoutingSuggestedRepair;
  const record: RoutingRepairRecord = {
    task_id: finding.task_id,
    task_short_id: finding.task_short_id,
    category: finding.category,
    field: repair.field,
    from: repair.from,
    to: repair.to,
    command: repair.command,
    applied: false,
  };
  try {
    const current = getTask(finding.task_id, db);
    if (!current) throw new Error("task not found");
    const patch = repair.field === "working_dir"
      ? { version: current.version, working_dir: repair.to }
      : { version: current.version, task_list_id: repair.to };
    updateTask(finding.task_id, patch, db);
    const recheck = getTaskRouteState(finding.task_id, db, { verifyProjectRoot: true });
    addComment(
      {
        task_id: finding.task_id,
        agent_id: actor,
        type: "comment",
        content:
          `[routing-doctor] repaired ${repair.field}: from=${repair.from ?? "(null)"} to=${repair.to}; ` +
          `source_project=${finding.project_id ?? "(none)"}${finding.project_name ? ` (${finding.project_name})` : ""}` +
          `${finding.project_path ? ` path=${finding.project_path}` : ""}; command="${repair.command}"; ` +
          `doctor_run=${generatedAt}; route_recheck=eligible:${recheck.eligible} class:${recheck.route_class}`,
      },
      db,
    );
    record.applied = true;
  } catch (error) {
    record.error = error instanceof Error ? error.message : String(error);
  }
  return record;
}

export function runRoutingDoctor(options: RunRoutingDoctorOptions = {}): RoutingDoctorResult {
  const db = options.db ?? getDatabase();
  const dbPath = options.dbPath ?? getDatabasePath();
  const clock = options.now ?? now;
  const generatedAt = clock();
  const apply = options.apply === true;
  const statuses = options.statuses && options.statuses.length > 0 ? options.statuses : DEFAULT_STATUSES;
  const verifyProjectRoot = options.verifyProjectRoot !== false; // default true — the doctor is machine-aware
  const shardTotal = options.shardTotal && options.shardTotal > 1 ? Math.floor(options.shardTotal) : 1;
  const shardIndex = shardTotal > 1 ? Math.max(0, Math.floor(options.shardIndex ?? 0)) % shardTotal : 0;
  const actor = options.actor ?? "routing-doctor";

  const knownRepoSlugs = new Set<string>();
  const projectCache = new Map<string, Project | null>();
  for (const project of listProjects(db)) {
    projectCache.set(project.id, project);
    knownRepoSlugs.add(repoSlugForProject(project));
  }
  const resolveProjectCached = (id: string | null): Project | null => {
    if (!id) return null;
    if (projectCache.has(id)) return projectCache.get(id) ?? null;
    const project = getProject(id, db);
    projectCache.set(id, project);
    return project;
  };

  const filter: Parameters<typeof listTasks>[0] = {
    status: statuses,
    include_archived: options.includeArchived === true,
  };
  if (options.projectId) filter.project_id = options.projectId;
  if (options.tag) filter.tags = [options.tag];
  let tasks = listTasks(filter, db);
  if (shardTotal > 1) tasks = tasks.filter((task) => routingShardOf(task, shardTotal) === shardIndex);
  if (options.limit && options.limit > 0) tasks = tasks.slice(0, options.limit);

  const findings: RoutingFinding[] = [];
  let eligible = 0;
  for (const task of tasks) {
    const project = resolveProjectCached(task.project_id);
    const evaluation = evaluateTaskRouting({ task, project, db, knownRepoSlugs, verifyProjectRoot });
    if (evaluation.findings.length > 0) findings.push(...evaluation.findings);
    if (evaluation.eligible) eligible++;
  }

  const repairs: RoutingRepairRecord[] = [];
  let backup: RoutingDoctorBackup | undefined;
  let undoRecordPath: string | undefined;

  if (apply) {
    const safeFindings = findings.filter((f) => f.repair_class === "safe_auto" && f.suggested_repair);
    if (safeFindings.length > 0) {
      backup = createBackup(dbPath, generatedAt);
      for (const finding of safeFindings) {
        repairs.push(applySafeRepair(finding, actor, generatedAt, db));
      }
      const applied = repairs.filter((r) => r.applied);
      if (applied.length > 0) {
        const undoPath = options.undoRecordPath ?? join(process.cwd(), `todos-routing-doctor-undo-${generatedAt.replace(/[:.]/g, "-")}.json`);
        const undoRecord = {
          schema_version: TODOS_ROUTING_DOCTOR_SCHEMA_VERSION,
          purpose: "Undo record for routing-doctor --apply. Restore each field with the prior value below.",
          generated_at: generatedAt,
          actor,
          database_path: dbPath,
          backup: backup ?? null,
          repairs: applied.map((r) => ({
            task_id: r.task_id,
            field: r.field,
            from: r.from,
            to: r.to,
            command: r.command,
            undo_command: routingRepairUndoCommand(r),
          })),
        };
        try {
          writeFileSync(undoPath, `${JSON.stringify(undoRecord, null, 2)}\n`);
          undoRecordPath = undoPath;
        } catch {
          undoRecordPath = undefined;
        }
      }
    }
  }

  // Post-repair residual scan so summary/ok reflect reality after --apply.
  const residualFindings = apply && repairs.some((r) => r.applied)
    ? runRoutingDoctor({
        ...options,
        apply: false,
        db,
        dbPath,
        now: () => generatedAt,
      }).findings
    : findings;

  const byCategory: Record<string, number> = {};
  const byRepairClass: Record<string, number> = {};
  for (const f of residualFindings) {
    bump(byCategory, f.category);
    bump(byRepairClass, f.repair_class);
  }
  const safeAuto = residualFindings.filter((f) => f.repair_class === "safe_auto").length;
  const unsupported = residualFindings.filter((f) => f.repair_class === "unsupported").length;
  const blockers = residualFindings.filter((f) => f.repair_class.startsWith("blocker_")).length;
  const repaired = repairs.filter((r) => r.applied).length;
  const repairFailed = repairs.filter((r) => !r.applied).length;

  const summary: RoutingDoctorSummary = {
    inspected: tasks.length,
    eligible,
    findings_total: residualFindings.length,
    by_category: byCategory,
    by_repair_class: byRepairClass,
    safe_auto: safeAuto,
    blockers,
    unsupported,
    repaired,
    repair_failed: repairFailed,
  };

  return {
    schema_version: TODOS_ROUTING_DOCTOR_SCHEMA_VERSION,
    generated_at: generatedAt,
    ok: residualFindings.length === 0,
    dry_run: !apply,
    database_path: dbPath,
    scope: {
      statuses,
      project_id: options.projectId ?? null,
      tag: options.tag ?? null,
      shard: shardTotal > 1 ? { index: shardIndex, total: shardTotal } : null,
      include_archived: options.includeArchived === true,
      verify_project_root: verifyProjectRoot,
      limit: options.limit && options.limit > 0 ? options.limit : null,
    },
    summary,
    findings: apply ? residualFindings : findings,
    repairs,
    backup,
    undo_record_path: undoRecordPath,
  };
}
