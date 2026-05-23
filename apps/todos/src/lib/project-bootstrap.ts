/**
 * Local project bootstrap and workspace discovery — git roots, monorepos, first-run setup.
 */

import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, basename, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import type { Database } from "bun:sqlite";
import { getDatabase, now } from "../db/database.js";
import { ensureProject, getProjectByPath, type Project } from "../db/projects.js";
import { ensureTaskList } from "../db/task-lists.js";
import { exportTodosMd } from "./todos-md.js";

export const BOOTSTRAP_SCHEMA = "todos.bootstrap.v1";

export interface WorkspaceDiscovery {
  cwd: string;
  git_root: string | null;
  project_name: string;
  todos_dir: string;
  todos_db: string;
  package_name: string | null;
  is_monorepo: boolean;
  workspace_roots: string[];
}

export interface BootstrapResult {
  schema_version: typeof BOOTSTRAP_SCHEMA;
  project: Project;
  task_list_id: string | null;
  todos_md_created: boolean;
  manifest_path: string;
  first_run: boolean;
  message: string;
}

function findGitRoot(startDir: string): string | null {
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: startDir, encoding: "utf8" });
  if (result.status !== 0) return null;
  return result.stdout.trim() || null;
}

function readPackageName(dir: string): string | null {
  const pkgPath = join(dir, "package.json");
  if (!existsSync(pkgPath)) return null;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { name?: string; workspaces?: unknown[] };
    return pkg.name ?? null;
  } catch {
    return null;
  }
}

function detectMonorepoRoots(gitRoot: string): string[] {
  const pkgPath = join(gitRoot, "package.json");
  if (!existsSync(pkgPath)) return [gitRoot];
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { workspaces?: string[] | { packages?: string[] } };
    const ws = pkg.workspaces;
    if (!ws) return [gitRoot];
    const patterns = Array.isArray(ws) ? ws : ws.packages ?? [];
    if (!patterns.length) return [gitRoot];
    return [gitRoot, ...patterns.map((p) => join(gitRoot, p.replace("*", "")))];
  } catch {
    return [gitRoot];
  }
}

export function discoverWorkspace(cwd?: string): WorkspaceDiscovery {
  const dir = resolve(cwd || process.cwd());
  const gitRoot = findGitRoot(dir);
  const root = gitRoot ?? dir;
  const packageName = readPackageName(root) ?? readPackageName(dir);
  const projectName = packageName?.split("/").pop() ?? basename(root);
  const todosDir = join(root, ".todos");
  const todosDb = join(todosDir, "todos.db");

  return {
    cwd: dir,
    git_root: gitRoot,
    project_name: projectName,
    todos_dir: todosDir,
    todos_db: todosDb,
    package_name: packageName,
    is_monorepo: detectMonorepoRoots(root).length > 1,
    workspace_roots: detectMonorepoRoots(root),
  };
}

export function getBootstrapStatus(cwd?: string, db?: Database): {
  bootstrapped: boolean;
  discovery: WorkspaceDiscovery;
  project: Project | null;
  manifest: Record<string, unknown> | null;
} {
  const discovery = discoverWorkspace(cwd);
  const manifestPath = join(discovery.todos_dir, "bootstrap.json");
  let manifest: Record<string, unknown> | null = null;
  if (existsSync(manifestPath)) {
    try {
      manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
    } catch {
      manifest = null;
    }
  }

  const projectPath = discovery.git_root ?? discovery.cwd;
  const project = getProjectByPath(projectPath, db) ?? null;

  return {
    bootstrapped: !!manifest && !!project,
    discovery,
    project,
    manifest,
  };
}

export function bootstrapWorkspace(
  options: { cwd?: string; project_name?: string; init_todos_md?: boolean; task_list_slug?: string } = {},
  db?: Database,
): BootstrapResult {
  const d = db || getDatabase();
  const discovery = discoverWorkspace(options.cwd);
  const projectPath = discovery.git_root ?? discovery.cwd;
  const name = options.project_name ?? discovery.project_name;

  mkdirSync(discovery.todos_dir, { recursive: true });

  const existing = getProjectByPath(projectPath, d);
  const firstRun = !existing;
  const project = ensureProject(name, projectPath, d);

  let taskListId: string | null = null;
  const slug = options.task_list_slug ?? "default";
  const list = ensureTaskList("Default", slug, project.id, d);
  taskListId = list.id;

  const todosMdPath = join(projectPath, "todos.md");
  let todosMdCreated = false;
  if (options.init_todos_md !== false && !existsSync(todosMdPath)) {
    exportTodosMd({ path: todosMdPath, project_id: project.id }, d);
    todosMdCreated = true;
  }

  const manifestPath = join(discovery.todos_dir, "bootstrap.json");
  const manifest = {
    schema_version: BOOTSTRAP_SCHEMA,
    project_id: project.id,
    project_path: projectPath,
    task_list_id: taskListId,
    bootstrapped_at: now(),
    git_root: discovery.git_root,
    is_monorepo: discovery.is_monorepo,
  };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  return {
    schema_version: BOOTSTRAP_SCHEMA,
    project,
    task_list_id: taskListId,
    todos_md_created: todosMdCreated,
    manifest_path: manifestPath,
    first_run: firstRun,
    message: firstRun
      ? `Bootstrapped project '${project.name}' at ${projectPath}`
      : `Workspace already registered as '${project.name}'`,
  };
}

export function formatBootstrapReport(result: BootstrapResult, discovery: WorkspaceDiscovery): string {
  return [
    result.message,
    `Project ID: ${result.project.id}`,
    `Path: ${result.project.path}`,
    `Prefix: ${result.project.task_prefix ?? "(auto)"}`,
    `Task list: ${result.task_list_id ?? "none"}`,
    `Git root: ${discovery.git_root ?? "none"}`,
    `Monorepo: ${discovery.is_monorepo ? "yes" : "no"}`,
    `todos.md: ${result.todos_md_created ? "created" : "existing"}`,
    `Manifest: ${result.manifest_path}`,
  ].join("\n");
}
