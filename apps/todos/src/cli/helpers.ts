import chalk from "chalk";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { getDatabase, resolvePartialId } from "../db/database.js";
import { ensureProject, getProjectByPath } from "../db/projects.js";
import type { Project, Task } from "../types/index.js";

export function getPackageVersion(): string {
  try {
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "package.json");
    return JSON.parse(readFileSync(pkgPath, "utf-8")).version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export function handleError(e: unknown): never {
  // Try to read program options — may not be available during early init
  let jsonMode = false;
  try {
    jsonMode = (programForOptions?.opts?.() as any)?.json ?? false;
  } catch {
    // ignore
  }
  if (jsonMode) {
    console.log(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
  } else {
    console.error(chalk.red(e instanceof Error ? e.message : String(e)));
  }
  process.exit(1);
}

// Late-binding reference to the program for handleError
let programForOptions: Command | null = null;
export function setProgramRef(p: Command) { programForOptions = p; }

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

export function autoDetectProject(opts: { project?: string }): Project | undefined {
  if (opts.project) {
    return getProjectByPath(resolve(opts.project)) ?? undefined;
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
