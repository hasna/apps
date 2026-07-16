import chalk from "chalk";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { isCloudRouting } from "./cloud-router.js";
import { getDatabase, resolvePartialId } from "../db/database.js";
import { ensureProject, getProject, getProjectByPath, slugify } from "../db/projects.js";
import { getPackageVersion } from "../lib/package-version.js";
import type { Project, Task } from "../types/index.js";

export { getPackageVersion };

const stdoutRetryBuffer = new SharedArrayBuffer(4);
const stdoutRetrySignal = new Int32Array(stdoutRetryBuffer);

export function handleError(e: unknown): never {
  console.error(chalk.red(e instanceof Error ? e.message : String(e)));
  process.exit(1);
}

/** Canonical task UUID (v4-shaped, but tolerant of any version/variant nibble). */
const TASK_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolve a user-supplied task reference (full UUID, id prefix, or short_id) to a
 * canonical task id, CONSISTENTLY across every `todos` subcommand.
 *
 * Two rules make this safe whether the machine is `local` or flipped to the shared
 * `self_hosted` cloud store:
 *
 *  1. A full task UUID is authoritative on its own — it is returned verbatim and is
 *     NEVER required to exist in this box's local SQLite mirror. On a flipped
 *     machine the task lives in the cloud and may have never synced down; the
 *     downstream read/write (cloud `GET/PATCH/POST /v1/tasks/:id` or a local query)
 *     is the single source of truth for existence and reports a precise not-found.
 *     This is what previously broke: resolver-based commands (comment, inspect,
 *     lock, deps, …) demanded the row be present locally, so they failed on
 *     cloud-only tasks even with a valid full UUID, while raw-id commands (show,
 *     update, start, done) worked — the reported inconsistency.
 *
 *  2. A short prefix / short_id is expanded against the local mirror, the only
 *     prefix index available client-side (the `/v1` API has no prefix lookup).
 *     Cloud creates immediately seed that mirror with the created task's id and
 *     short_id so the prefix printed by `todos add` resolves in later commands
 *     from the same machine/session. Ambiguous or unknown prefixes fail loudly
 *     with actionable guidance.
 */
export function resolveTaskId(partialId: string): string {
  const raw = (partialId ?? "").trim();

  if (!raw) {
    console.error(chalk.red("Could not resolve task ID: (empty)"));
    process.exit(1);
  }

  // Rule 1: full UUID → trust it as-is (works for local AND cloud-only tasks).
  // Canonicalize to lower-case: ids are generated/stored lower-case, and the
  // cloud API matches them case-sensitively, so an upper-case UUID must be
  // normalized or it would 404 a task that actually exists.
  if (TASK_UUID_RE.test(raw)) return raw.toLowerCase();

  // Rule 2: prefix / short_id → expand against the local mirror.
  const cloud = isCloudRouting();
  let similar: { id: string }[] = [];
  try {
    const db = getDatabase();
    const id = resolvePartialId(db, "tasks", raw);
    if (id) return id;
    similar = db.query("SELECT id FROM tasks WHERE id LIKE ? LIMIT 3").all(`%${raw}%`) as { id: string }[];
  } catch (error) {
    if (!cloud) throw error;
  }

  const cached = cloud ? resolveCachedCloudTaskId(raw) : null;
  if (cached && "id" in cached) return cached.id;

  console.error(chalk.red(`Could not resolve task ID: ${raw}`));
  if (similar.length > 0) {
    console.error(chalk.dim(`Did you mean: ${similar.map(s => s.id.slice(0, 8)).join(", ")}?`));
  } else if (cached && "ambiguous" in cached) {
    console.error(chalk.dim(`Cloud mode: cached task id prefix is ambiguous. Matches: ${cached.ambiguous.map((match: string) => match.slice(0, 8)).join(", ")}`));
  } else if (cloud) {
    console.error(chalk.dim(
      "Cloud mode: short id prefixes resolve only for tasks present in this machine's local mirror. "
      + "Freshly-created cloud ids are cached on this machine; otherwise pass the full task UUID "
      + "(copy it from `todos show <id>` or `todos list --json`).",
    ));
  }
  process.exit(1);
}

type CloudTaskResolutionCacheInput = Pick<Task, "id"> & Partial<Task>;
interface CloudTaskIdCacheEntry {
  id: string;
  short_id: string | null;
  cached_at: string;
}
interface CloudTaskIdCacheFile {
  version: 1;
  tasks: CloudTaskIdCacheEntry[];
}

function cloudTaskIdCachePath(): string | null {
  const home = process.env["HOME"] || process.env["USERPROFILE"];
  return home ? join(home, ".hasna", "todos", "cloud-task-id-cache.json") : null;
}

function readCloudTaskIdCache(): CloudTaskIdCacheFile {
  const path = cloudTaskIdCachePath();
  if (!path || !existsSync(path)) return { version: 1, tasks: [] };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<CloudTaskIdCacheFile>;
    if (parsed.version !== 1 || !Array.isArray(parsed.tasks)) return { version: 1, tasks: [] };
    return {
      version: 1,
      tasks: parsed.tasks.filter((entry): entry is CloudTaskIdCacheEntry =>
        entry != null &&
        typeof entry === "object" &&
        typeof entry.id === "string" &&
        TASK_UUID_RE.test(entry.id) &&
        (entry.short_id === null || typeof entry.short_id === "string") &&
        typeof entry.cached_at === "string",
      ),
    };
  } catch {
    return { version: 1, tasks: [] };
  }
}

function writeCloudTaskIdCache(cache: CloudTaskIdCacheFile): boolean {
  const path = cloudTaskIdCachePath();
  if (!path) return false;
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(cache, null, 2)}\n`, { mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}

function resolveCachedCloudTaskId(raw: string): { id: string } | { ambiguous: string[] } | null {
  const ref = raw.trim().toLowerCase();
  if (!ref) return null;
  const matches = new Map<string, CloudTaskIdCacheEntry>();
  for (const entry of readCloudTaskIdCache().tasks) {
    const id = entry.id.toLowerCase();
    const shortId = entry.short_id?.toLowerCase();
    if (id.startsWith(ref) || shortId === ref) matches.set(id, entry);
  }
  if (matches.size === 1) return { id: [...matches.values()][0]!.id };
  if (matches.size > 1) return { ambiguous: [...matches.values()].map((entry) => entry.id) };
  return null;
}

/**
 * Seed a machine-wide id-prefix cache after a cloud create. This intentionally
 * avoids the local tasks table: id-based mutations still go to the cloud client
 * when cloud routing is active, and disabling cloud mode must not expose stale
 * remote rows to local queues.
 */
export function cacheCloudTaskForIdResolution(task: CloudTaskResolutionCacheInput): boolean {
  if (!TASK_UUID_RE.test(task.id)) return false;
  const timestamp = new Date().toISOString();
  const id = task.id.toLowerCase();
  const shortId = typeof task.short_id === "string" && task.short_id.trim() ? task.short_id.trim() : null;
  const existing = readCloudTaskIdCache().tasks.filter((entry) => entry.id.toLowerCase() !== id);
  return writeCloudTaskIdCache({
    version: 1,
    tasks: [{ id, short_id: shortId, cached_at: timestamp }, ...existing].slice(0, 1000),
  });
}

export function detectGitRoot(): string | null {
  try {
    return execSync("git rev-parse --show-toplevel", { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch {
    return null;
  }
}

function isPathWithin(child: string, parent: string): boolean {
  const normalizedChild = resolve(child);
  const normalizedParent = resolve(parent);
  return normalizedChild === normalizedParent || normalizedChild.startsWith(`${normalizedParent}${sep}`);
}

export function shouldSkipAutoProjectForGitRoot(gitRoot: string): boolean {
  const normalized = resolve(gitRoot);
  if (process.platform !== "win32" && (normalized === "/tmp" || normalized.startsWith("/tmp/"))) {
    return true;
  }
  return isPathWithin(normalized, tmpdir());
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
    if (shouldSkipAutoProjectForGitRoot(gitRoot)) return undefined;
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

function writeStdoutSync(text: string): void {
  const buffer = Buffer.from(text);
  let offset = 0;
  while (offset < buffer.length) {
    try {
      const written = writeSync(1, buffer, offset, buffer.length - offset);
      if (written <= 0) throw new Error("Unable to write complete stdout payload");
      offset += written;
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error
        ? error.code
        : undefined;
      if (code === "EPIPE") {
        return;
      }
      if (code === "EAGAIN" || code === "EWOULDBLOCK" || code === "EINTR") {
        Atomics.wait(stdoutRetrySignal, 0, 0, 1);
        continue;
      }
      throw error;
    }
  }
}

export function printJson(data: unknown): void {
  writeStdoutSync(`${JSON.stringify(data, null, 2)}\n`);
}

export function output(data: unknown, jsonMode: boolean): void {
  if (jsonMode) {
    printJson(data);
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
