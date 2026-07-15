import type { Database } from "bun:sqlite";
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { getDatabase } from "../db/database.js";
import {
  addProjectSource,
  ensureProject,
  listProjectSources,
  renameProject,
  setMachineLocalPath,
  slugify,
} from "../db/projects.js";
import { ensureTaskList, updateTaskList } from "../db/task-lists.js";
import type { Project, ProjectSource, TaskList } from "../types/index.js";

export interface ProjectBootstrapOptions {
  path?: string;
  name?: string;
  taskListSlug?: string;
  dryRun?: boolean;
  routeEnabled?: boolean;
}

export interface ProjectWorkspaceDiscovery {
  inputPath: string;
  projectPath: string;
  projectName: string;
  gitRoot: string | null;
  packageRoot: string | null;
  packageName: string | null;
  workspaceRoot: string | null;
  workspaceKind: string | null;
  monorepo: boolean;
  markers: string[];
}

export interface ProjectBootstrapResult {
  dryRun: boolean;
  discovery: ProjectWorkspaceDiscovery;
  project: Project | null;
  taskList: TaskList | null;
  sources: ProjectSource[];
  created: {
    project: boolean;
    taskList: boolean;
    sources: string[];
  };
}

interface PackageMetadata {
  name?: string;
  workspaces?: unknown;
}

function safeStat(path: string): ReturnType<typeof statSync> | null {
  try {
    return statSync(path);
  } catch {
    return null;
  }
}

function canonicalPath(input: string): string {
  const resolved = resolve(input);
  const stats = safeStat(resolved);
  if (stats?.isFile()) return dirname(resolved);
  return resolved;
}

function findUp(start: string, marker: string): string | null {
  let current = canonicalPath(start);
  while (true) {
    if (existsSync(resolve(current, marker))) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function readPackageJson(path: string | null): PackageMetadata | null {
  if (!path) return null;
  const file = resolve(path, "package.json");
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf-8")) as PackageMetadata;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function packageDisplayName(name: string | null, fallbackPath: string): string {
  if (!name) return basename(fallbackPath);
  const withoutScope = name.startsWith("@") ? name.split("/")[1] : name;
  return withoutScope || basename(fallbackPath);
}

function workspaceMarker(root: string | null, rootPackage: PackageMetadata | null): { kind: string | null; markers: string[] } {
  if (!root) return { kind: null, markers: [] };
  const markers: string[] = [];
  if (rootPackage?.workspaces) markers.push("package.json#workspaces");
  for (const marker of ["pnpm-workspace.yaml", "turbo.json", "nx.json", "lerna.json", "rush.json", "bun.lock", "bun.lockb"]) {
    if (existsSync(resolve(root, marker))) markers.push(marker);
  }
  const kind = markers.find((marker) => marker !== "bun.lock" && marker !== "bun.lockb") ?? null;
  return { kind, markers };
}

export function discoverProjectWorkspace(inputPath = process.cwd()): ProjectWorkspaceDiscovery {
  const input = canonicalPath(inputPath);
  const gitRoot = findUp(input, ".git");
  const packageRoot = findUp(input, "package.json");
  const rootPackage = readPackageJson(gitRoot);
  const packageMeta = readPackageJson(packageRoot);
  const workspace = workspaceMarker(gitRoot, rootPackage);
  const monorepo = Boolean(gitRoot && packageRoot && packageRoot !== gitRoot && workspace.kind);
  const projectPath = monorepo ? packageRoot! : (gitRoot ?? packageRoot ?? input);
  const projectName = packageDisplayName(packageMeta?.name ?? rootPackage?.name ?? null, projectPath);

  return {
    inputPath: input,
    projectPath,
    projectName,
    gitRoot,
    packageRoot,
    packageName: packageMeta?.name ?? null,
    workspaceRoot: workspace.kind ? gitRoot : null,
    workspaceKind: workspace.kind,
    monorepo,
    markers: workspace.markers,
  };
}

function sourceExists(projectId: string, type: string, uri: string, db: Database): boolean {
  return listProjectSources(projectId, db).some((source) => source.type === type && source.uri === uri);
}

function addSourceOnce(
  projectId: string,
  type: string,
  name: string,
  uri: string | null,
  metadata: Record<string, unknown>,
  db: Database,
): ProjectSource | null {
  if (!uri || sourceExists(projectId, type, uri, db)) return null;
  return addProjectSource({ project_id: projectId, type, name, uri, metadata }, db);
}

export function bootstrapProject(options: ProjectBootstrapOptions = {}, db?: Database): ProjectBootstrapResult {
  const d = db || getDatabase();
  const discovery = discoverProjectWorkspace(options.path);
  const taskListSlug = options.taskListSlug || `todos-${slugify(options.name || discovery.projectName)}`;

  if (options.dryRun) {
    return {
      dryRun: true,
      discovery: { ...discovery, projectName: options.name || discovery.projectName },
      project: null,
      taskList: null,
      sources: [],
      created: { project: false, taskList: false, sources: [] },
    };
  }

  const beforeProject = getProjectByCanonicalPath(discovery.projectPath, d);
  let project = ensureProject(options.name || discovery.projectName, discovery.projectPath, d);
  const createdProject = !beforeProject;

  if (project.task_list_id !== taskListSlug || (options.name && project.name !== options.name)) {
    project = renameProject(project.id, {
      name: options.name ?? project.name,
      new_slug: taskListSlug,
    }, d).project;
  }
  setMachineLocalPath(project.id, discovery.projectPath, d);

  const beforeTaskList = d.query("SELECT id FROM task_lists WHERE project_id = ? AND slug = ?").get(project.id, taskListSlug);
  let taskList = ensureTaskList(`${project.name} Tasks`, taskListSlug, project.id, d);
  if (options.routeEnabled && taskList.metadata.route_enabled !== true) {
    taskList = updateTaskList(taskList.id, {
      metadata: {
        ...taskList.metadata,
        route_enabled: true,
        automation: {
          ...(taskList.metadata.automation && typeof taskList.metadata.automation === "object" && !Array.isArray(taskList.metadata.automation)
            ? taskList.metadata.automation as Record<string, unknown>
            : {}),
          no_auto: false,
        },
      },
    }, d);
  }
  const createdSources: string[] = [];

  for (const source of [
    addSourceOnce(project.id, "local", "Project root", discovery.projectPath, { role: "project-root" }, d),
    addSourceOnce(project.id, "git", "Git root", discovery.gitRoot, { role: "git-root" }, d),
    addSourceOnce(project.id, "workspace", "Workspace root", discovery.workspaceRoot, {
      role: "workspace-root",
      kind: discovery.workspaceKind,
      markers: discovery.markers,
      monorepo: discovery.monorepo,
    }, d),
  ]) {
    if (source) {
      createdSources.push(source.type);
    }
  }

  return {
    dryRun: false,
    discovery: { ...discovery, projectName: options.name || discovery.projectName },
    project,
    taskList,
    sources: listProjectSources(project.id, d),
    created: {
      project: createdProject,
      taskList: !beforeTaskList,
      sources: createdSources,
    },
  };
}

function getProjectByCanonicalPath(path: string, db: Database): Project | null {
  return getProjectByExactPath(path, db) ?? null;
}

function getProjectByExactPath(path: string, db: Database): Project | null {
  return getProjectByPathForBootstrap(path, db);
}

function getProjectByPathForBootstrap(path: string, db: Database): Project | null {
  const row = db.query("SELECT * FROM projects WHERE path = ?").get(path) as Project | null;
  if (row) return row;
  const machineRow = db.query(
    `SELECT p.* FROM projects p
     JOIN project_machine_paths pmp ON pmp.project_id = p.id
     WHERE pmp.path = ?`,
  ).get(path) as Project | null;
  return machineRow ?? null;
}
