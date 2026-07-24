import type { Database } from "bun:sqlite";
import { listTaskFiles } from "../db/task-files.js";
import { getTask, listTasks } from "../db/tasks.js";
import type { Task } from "../types/index.js";
import { getDatabase } from "../db/database.js";

export interface CreateBranchWorkPlanInput {
  task_id?: string;
  plan_id?: string;
  branch: string;
  base_branch?: string;
  paths?: string[];
  root?: string;
  agent_id?: string;
  include_git_status?: boolean;
}

export interface BranchWorkPlanConflict {
  path: string;
  conflicting_task_id: string;
  conflicting_task_short_id: string | null;
  conflicting_task_title: string;
  conflicting_task_status: string;
  conflicting_agent_id: string | null;
  locked_by: string | null;
  level: "hard" | "advisory";
}

export interface BranchWorkPlanGitStatus {
  has_git: boolean;
  current_branch: string | null;
  branch_exists: boolean;
  dirty_files: string[];
}

export interface BranchWorkPlan {
  schema_version: 1;
  local_only: true;
  generated_at: string;
  branch: string;
  base_branch: string;
  root: string;
  task_id: string | null;
  plan_id: string | null;
  task_ids: string[];
  files: string[];
  conflicts: BranchWorkPlanConflict[];
  git_status: BranchWorkPlanGitStatus;
  safe_to_start: boolean;
  reasons: string[];
  commands: string[];
}

function normalizeBranch(value: string): string {
  const branch = value.trim();
  if (!branch) throw new Error("branch is required");
  if (branch.startsWith("-") || branch.includes("..") || /[\s~^:?*[\\]/.test(branch) || branch.endsWith("/") || branch.endsWith(".lock")) {
    throw new Error(`unsafe branch name: ${branch}`);
  }
  return branch;
}

function normalizePath(value: string): string | null {
  const path = value.trim().replace(/\\/g, "/");
  if (!path || path.startsWith("/") || path.includes("\0")) return null;
  const parts = path.split("/").filter(Boolean);
  if (parts.includes("..")) return null;
  return parts.join("/");
}

function uniqueSorted(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value)))).sort();
}

function runGit(root: string, args: string[]): string | null {
  try {
    const result = Bun.spawnSync(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
    if (result.exitCode !== 0) return null;
    return new TextDecoder().decode(result.stdout).trim();
  } catch {
    return null;
  }
}

function getGitStatus(root: string, branch: string, includeGitStatus: boolean): BranchWorkPlanGitStatus {
  if (!includeGitStatus) return { has_git: false, current_branch: null, branch_exists: false, dirty_files: [] };
  const topLevel = runGit(root, ["rev-parse", "--show-toplevel"]);
  if (!topLevel) return { has_git: false, current_branch: null, branch_exists: false, dirty_files: [] };
  const currentBranch = runGit(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const branchExists = runGit(root, ["show-ref", "--verify", `refs/heads/${branch}`]) !== null;
  const status = runGit(root, ["status", "--short"]) || "";
  const dirtyFiles = status
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => normalizePath(line.replace(/^.. /, "").replace(/^.* -> /, "")))
    .filter((path): path is string => Boolean(path));
  return { has_git: true, current_branch: currentBranch || null, branch_exists: branchExists, dirty_files: dirtyFiles };
}

function resolveScope(input: CreateBranchWorkPlanInput, db: Database): Task[] {
  if (input.task_id) {
    const task = getTask(input.task_id, db);
    if (!task) throw new Error(`task not found: ${input.task_id}`);
    return [task];
  }
  if (input.plan_id) return listTasks({ plan_id: input.plan_id, limit: 1000 }, db);
  throw new Error("task_id or plan_id is required");
}

function collectPlannedFiles(tasks: Task[], explicitPaths: string[] | undefined, db: Database): string[] {
  const fromTasks = tasks.flatMap((task) => listTaskFiles(task.id, db).map((file) => normalizePath(file.path)));
  const fromInput = (explicitPaths || []).map(normalizePath);
  return uniqueSorted([...fromTasks, ...fromInput]);
}

function detectBranchPlanConflicts(taskIds: string[], files: string[], db: Database): BranchWorkPlanConflict[] {
  if (files.length === 0) return [];
  const filePlaceholders = files.map(() => "?").join(", ");
  const taskPlaceholders = taskIds.length > 0 ? taskIds.map(() => "?").join(", ") : "''";
  const rows = db.query(`
    SELECT
      tf.path,
      tf.agent_id AS conflicting_agent_id,
      t.id AS conflicting_task_id,
      t.short_id AS conflicting_task_short_id,
      t.title AS conflicting_task_title,
      t.status AS conflicting_task_status,
      t.locked_by
    FROM task_files tf
    JOIN tasks t ON tf.task_id = t.id
    WHERE tf.path IN (${filePlaceholders})
      AND t.id NOT IN (${taskPlaceholders})
      AND tf.status != 'removed'
      AND t.status IN ('pending', 'in_progress', 'blocked')
    ORDER BY tf.updated_at DESC
  `).all(...files, ...taskIds) as Array<Omit<BranchWorkPlanConflict, "level">>;

  return rows.map((row) => ({
    ...row,
    level: row.conflicting_task_status === "in_progress" || Boolean(row.locked_by) ? "hard" : "advisory",
  }));
}

function buildCommands(plan: Omit<BranchWorkPlan, "commands">): string[] {
  const commands = [
    `git switch ${plan.base_branch}`,
    `git switch -c ${plan.branch} ${plan.base_branch}`,
  ];
  for (const taskId of plan.task_ids) {
    commands.push(`todos link-ref ${taskId.slice(0, 8)} ${plan.branch} --type branch --provider git`);
  }
  return commands;
}

export function createBranchWorkPlan(input: CreateBranchWorkPlanInput, db?: Database): BranchWorkPlan {
  const d = getDatabase(db);
  const branch = normalizeBranch(input.branch);
  const baseBranch = normalizeBranch(input.base_branch || "main");
  const root = input.root || process.cwd();
  const tasks = resolveScope(input, d);
  const taskIds = tasks.map((task) => task.id);
  const files = collectPlannedFiles(tasks, input.paths, d);
  const conflicts = detectBranchPlanConflicts(taskIds, files, d);
  const includeGitStatus = input.include_git_status !== false;
  const gitStatus = getGitStatus(root, branch, includeGitStatus);
  const hardConflicts = conflicts.filter((conflict) => conflict.level === "hard");
  const reasons: string[] = [];

  if (tasks.length === 0) reasons.push("no tasks found for scope");
  if (files.length === 0) reasons.push("no planned files recorded");
  if (hardConflicts.length > 0) reasons.push("active file conflicts must be resolved before starting");
  if (gitStatus.branch_exists) reasons.push("branch already exists locally");
  if (gitStatus.dirty_files.length > 0) reasons.push("working tree has uncommitted local changes");
  if (includeGitStatus && !gitStatus.has_git) reasons.push("git status unavailable for root");

  const partial: Omit<BranchWorkPlan, "commands"> = {
    schema_version: 1,
    local_only: true,
    generated_at: new Date().toISOString(),
    branch,
    base_branch: baseBranch,
    root,
    task_id: input.task_id || null,
    plan_id: input.plan_id || tasks[0]?.plan_id || null,
    task_ids: taskIds,
    files,
    conflicts,
    git_status: gitStatus,
    safe_to_start: reasons.length === 0,
    reasons,
  };

  return { ...partial, commands: buildCommands(partial) };
}
