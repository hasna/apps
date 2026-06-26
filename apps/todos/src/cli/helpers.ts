import chalk from "chalk";
import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { getDatabase, resolvePartialId } from "../db/database.js";
import { ensureProject, getProject, getProjectByPath, slugify } from "../db/projects.js";
import { getPackageVersion } from "../lib/package-version.js";
import type { Project, Task } from "../types/index.js";

export { getPackageVersion };

export function handleError(e: unknown): never {
  console.error(chalk.red(e instanceof Error ? e.message : String(e)));
  process.exit(1);
}

export function resolveTaskId(partialId: string): string {
  const db = getDatabase();
  const id = resolvePartialId(db, "tasks", partialId);
  if (!id) {
    const similar = db.query("SELECT id FROM tasks WHERE id LIKE ? LIMIT 3").all(`%${partialId}%`) as { id: string }[];
    if (similar.length > 0) {
      console.error(chalk.red(`Could not resolve task ID: ${partialId}`));
      console.error(chalk.dim(`Did you mean: ${similar.map(s => s.id.slice(0, 8)).join(", ")}?`));
    } else {
      console.error(chalk.red(`Could not resolve task ID: ${partialId}`));
    }
    process.exit(1);
  }
  return id;
}

export function detectGitRoot(): string | null {
  try {
    return execSync("git rev-parse --show-toplevel", { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch {
    return null;
  }
}

/**
 * Resolve an explicitly provided project reference by registered path, exact or
 * partial ID, task list ID, slug, or name. An unresolvable reference is a hard
 * error — it must never silently degrade into "no project filter".
 */
export function resolveExplicitProject(input: string): Project {
  const db = getDatabase();

  const byPath = getProjectByPath(resolve(input), db);
  if (byPath) return byPath;

  const id = resolvePartialId(db, "projects", input);
  if (id) {
    const byId = getProject(id, db);
    if (byId) return byId;
  }

  const exact = db.query(
    "SELECT * FROM projects WHERE lower(name) = lower(?) OR task_list_id = ? ORDER BY name LIMIT 1",
  ).get(input, input) as Project | null;
  if (exact) return exact;

  const inputSlug = slugify(input);
  if (inputSlug) {
    const all = db.query("SELECT * FROM projects ORDER BY name").all() as Project[];
    const bySlug = all.find((p) => slugify(p.name) === inputSlug);
    if (bySlug) return bySlug;
  }

  const bySubstring = db.query(
    "SELECT * FROM projects WHERE name LIKE ? ORDER BY name LIMIT 1",
  ).get(`%${input}%`) as Project | null;
  if (bySubstring) return bySubstring;

  console.error(chalk.red(`Project not found: ${input}`));
  console.error(chalk.dim("No registered project matches this path, ID, slug, or name. Run `todos projects` to list projects."));
  process.exit(1);
}

export function autoDetectProject(opts: { project?: string }): Project | undefined {
  if (opts.project) {
    return resolveExplicitProject(opts.project);
  }
  if (process.env["TODOS_AUTO_PROJECT"] === "false") return undefined;
  const gitRoot = detectGitRoot();
  if (gitRoot) {
    return ensureProject(basename(gitRoot), gitRoot);
  }
  return undefined;
}

function basename(p: string) {
  return p.replace(/.*[/\\]/, "");
}

export function autoProject(opts: { project?: string }): string | undefined {
  return autoDetectProject(opts)?.id;
}

/** Normalize user-friendly status aliases to canonical TaskStatus values */
export function normalizeStatus(s: string): string {
  switch (s.toLowerCase().trim()) {
    case "done":      return "completed";
    case "complete":  return "completed";
    case "active":    return "in_progress";
    case "wip":       return "in_progress";
    case "cancelled": return "cancelled";
    case "canceled":  return "cancelled";
    default:          return s;
  }
}

export function normalizeStatusList(statuses: string | string[]): string | string[] {
  if (Array.isArray(statuses)) return statuses.map(normalizeStatus);
  return normalizeStatus(statuses);
}

export function output(data: unknown, jsonMode: boolean): void {
  if (jsonMode) {
    console.log(JSON.stringify(data, null, 2));
  }
}

export const statusColors: Record<string, (s: string) => string> = {
  pending: chalk.yellow,
  in_progress: chalk.blue,
  completed: chalk.green,
  failed: chalk.red,
  cancelled: chalk.gray,
};

export const priorityColors: Record<string, (s: string) => string> = {
  critical: chalk.red.bold,
  high: chalk.red,
  medium: chalk.yellow,
  low: chalk.gray,
};

export function formatTaskLine(t: Task): string {
  const statusFn = statusColors[t.status] || chalk.white;
  const priorityFn = priorityColors[t.priority] || chalk.white;
  const lock = t.locked_by ? chalk.magenta(` [locked:${t.locked_by}]`) : "";
  const assigned = t.assigned_to ? chalk.cyan(` -> ${t.assigned_to}`) : "";
  const tags = t.tags.length > 0 ? chalk.dim(` [${t.tags.join(",")}]`) : "";
  const plan = t.plan_id ? chalk.magenta(` [plan:${t.plan_id.slice(0, 8)}]`) : "";
  return `${chalk.dim(t.id.slice(0, 8))} ${statusFn(t.status.padEnd(11))} ${priorityFn(t.priority.padEnd(8))} ${t.title}${assigned}${lock}${tags}${plan}`;
}
