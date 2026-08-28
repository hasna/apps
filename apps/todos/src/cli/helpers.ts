import chalk from "chalk";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { cloudResolveTaskRef, getTodosCloudClient, isCloudRouting } from "./cloud-router.js";
import type { HasnaStorageClient } from "@hasna/contracts/client/storage";
import { getDatabase, resolvePartialId } from "../db/database.js";
import { ensureProject, getProject, getProjectByPath, slugify } from "../db/projects.js";
import { lockDisplayState } from "../lib/lock-display.js";
import {
  collapseEnumValues,
  resolveEnumVocabulary,
  type EnumVocabularySpec,
} from "../lib/enum-vocabulary.js";
import { getPackageVersion } from "../lib/package-version.js";
import { getTodosGlobalDir } from "../lib/sync-utils.js";
import { TASK_PRIORITIES, TASK_STATUSES } from "../types/index.js";
import type { Project, Task, TaskPriority, TaskStatus } from "../types/index.js";

export { getPackageVersion };

const stdoutRetryBuffer = new SharedArrayBuffer(4);
const stdoutRetrySignal = new Int32Array(stdoutRetryBuffer);

/**
 * Detect whether the invocation requested JSON output, from raw argv.
 *
 * `handleError` runs from catch blocks that don't carry the parsed command
 * options (and errors can be thrown before/around parse), so argv is the only
 * reliable signal here. Matches the global/local `--json` long flag, a bare
 * `-j` short flag, and combined short-flag clusters that include `j`
 * (e.g. `-aj`) — mirroring how commander expands the `-j, --json` option.
 */
export function jsonModeRequested(argv: readonly string[] = process.argv): boolean {
  return argv.some(
    (arg) =>
      arg === "--json" ||
      (/^-[a-z]+$/i.test(arg) && arg.includes("j")),
  );
}

/**
 * Extract the server-provided reason from a `HasnaHttpError`-shaped error, if
 * one is present, so it can be appended to the generic transport message.
 *
 * `@hasna/contracts`'s `HasnaHttpError` carries the parsed response body on
 * `.body` (typed `unknown` — it is whatever JSON the authority returned). The
 * `/v1` server's own error contract is `{"error": "<reason>"}` on 4xx
 * responses, e.g. `validateTemplateCreate()` replying
 * `{"error": "tasks must be valid template task objects"}` for a malformed
 * template-import payload. Before this, `handleError` printed only
 * `e.message` — for a `HasnaHttpError` that is the generic
 * "Hasna cloud request failed: POST /templates -> 400", which discards the
 * one piece of information that explains WHY the request was rejected and
 * makes a legitimate validation error indistinguishable from an outage.
 *
 * Deliberately duck-typed rather than `instanceof HasnaHttpError`: this file
 * does not import `@hasna/contracts/client/transport` for the class itself
 * (only its type), and errors that cross a network/worker boundary can lose
 * their prototype chain. Checking the shape is also safe on any OTHER object
 * that happens to carry a string `.body.error` — the worst case is printing
 * one extra correct detail line, never a wrong one.
 */
function remoteErrorDetail(e: unknown): string | null {
  const seen = new Set<object>();
  let current = e;

  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const body = (current as { body?: unknown }).body;
    if (body && typeof body === "object" && !Array.isArray(body)) {
      const detail = (body as { error?: unknown }).error;
      if (typeof detail === "string" && detail.trim()) return detail.trim();
    }
    // Remote classification wraps transport errors to name the configured
    // authority and failure class. Preserve the server's body reason through
    // that wrapper instead of turning a precise refusal into a generic 5xx
    // line. The seen-set also prevents a malformed cyclic cause chain from
    // recursing forever while the CLI is already handling an error.
    current = (current as { cause?: unknown }).cause;
  }

  return null;
}

/**
 * Terminate the CLI with a failure, exit code 1.
 *
 * The human-readable, red message is always written to stderr (the human/log
 * channel). In JSON mode the CLI ALSO emits the documented machine-readable
 * error contract — `{"error":"message"}` — on stdout, so a caller parsing stdout
 * gets a valid JSON envelope instead of empty output. Previously `--json` errors
 * left stdout empty, violating the contract documented by `todos manual`.
 *
 * Keeping stderr populated in JSON mode preserves the CLI's long-standing
 * human-facing diagnostics (and every test that asserts them) while adding the
 * stdout envelope machine callers rely on.
 *
 * When the error is a remote HTTP failure whose body carries the authority's
 * own `{"error": "<reason>"}`, that reason is appended to the message (both on
 * stderr and in the --json envelope) rather than silently dropped — see
 * `remoteErrorDetail` above.
 */
export function handleError(e: unknown): never {
  const baseMessage = e instanceof Error ? e.message : String(e);
  const detail = remoteErrorDetail(e);
  const message = detail && !baseMessage.includes(detail) ? `${baseMessage}: ${detail}` : baseMessage;
  console.error(chalk.red(message));
  if (jsonModeRequested()) {
    console.log(JSON.stringify({ error: message }));
  }
  process.exit(1);
}

/** Canonical task UUID (v4-shaped, but tolerant of any version/variant nibble). */
const TASK_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolve a user-supplied task reference (full UUID, id prefix, or short_id) to a
 * canonical task id, CONSISTENTLY across every `todos` subcommand.
 *
 * Two rules make this safe whether the machine reads its local SQLite file or is
 * flipped to the shared hosted /v1 store:
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
    handleError(new Error("Could not resolve task ID: (empty)"));
  }

  // Rule 1: full UUID → trust it as-is (works for local AND cloud-only tasks).
  // Canonicalize to lower-case: ids are generated/stored lower-case, and the
  // cloud API matches them case-sensitively, so an upper-case UUID must be
  // normalized or it would 404 a task that actually exists.
  if (TASK_UUID_RE.test(raw)) return raw.toLowerCase();

  if (isCloudRouting()) {
    throw new Error(
      `REMOTE_SHORT_REF_REQUIRES_HTTP_RESOLUTION: ${raw} must be resolved through /v1 before local helpers; ` +
        "local SQLite fallback is disabled",
    );
  }

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

  const message = `Could not resolve task ID: ${raw}`;
  console.error(chalk.red(message));
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
  // JSON callers still get the documented {"error":...} envelope on stdout.
  if (jsonModeRequested()) console.log(JSON.stringify({ error: message }));
  process.exit(1);
}

/** Resolve task references through the selected authority before any DB helper. */
export async function resolveTaskIdForCommand(
  input: string,
  cloud: HasnaStorageClient | null = getTodosCloudClient(),
): Promise<string> {
  return cloud ? cloudResolveTaskRef(cloud, input) : resolveTaskId(input);
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
  // No env $HOME means no cache, preserving the pre-resolver behavior: a
  // daemon without a home must not scatter cache files into the cwd.
  const home = process.env["HOME"] || process.env["USERPROFILE"];
  if (!home) return null;
  return join(getTodosGlobalDir(), "cloud-task-id-cache.json");
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

/**
 * Normalize user-friendly status aliases to canonical TaskStatus values.
 *
 * Case and surrounding whitespace are folded away for EVERY input, not just the
 * aliases below. Previously the alias switch lower-cased its subject but the
 * default branch returned the caller's string verbatim, so `--status Pending`
 * survived as `Pending`, missed the vocabulary, matched no rows, and printed
 * "No tasks found." with exit 0. Every canonical status in `TASK_STATUSES` is
 * lower-case, so folding is lossless: it cannot collide two distinct members.
 */
export function normalizeStatus(s: string): string {
  const folded = s.toLowerCase().trim();
  switch (folded) {
    case "done":      return "completed";
    case "complete":  return "completed";
    case "active":    return "in_progress";
    case "wip":       return "in_progress";
    case "cancelled": return "cancelled";
    case "canceled":  return "cancelled";
    default:          return folded;
  }
}

/**
 * Fold case/whitespace on a priority value. `TASK_PRIORITIES` is all lower-case
 * and carries no aliases, so folding is the whole canonicalization.
 */
export function normalizePriority(p: string): string {
  return p.toLowerCase().trim();
}

export function normalizeStatusList(statuses: string | string[]): string | string[] {
  if (Array.isArray(statuses)) return statuses.map(normalizeStatus);
  return normalizeStatus(statuses);
}

/**
 * Remediation hints for status inputs operators plausibly type that are NOT
 * statuses. These are never accepted as values — `resolveEnumVocabulary` still
 * rejects them non-zero — they only make the rejection actionable.
 *
 * `all` earns a hint because it is the most dangerous near-miss in the set: it
 * reads as "everything" and used to return the empty set with exit 0. The flag
 * that actually widens the status filter is `-a`/`--all`.
 */
export const TASK_STATUS_FLAG_HINTS: Readonly<Record<string, string>> = {
  all: "To include every status, use -a/--all instead of a --status value.",
  any: "To include every status, use -a/--all instead of a --status value.",
  open: "Unstarted and running work is pending and in_progress (the default when no --status is given).",
};

/**
 * Validate a closed-vocabulary flag value and exit non-zero when it is not in the
 * vocabulary, instead of letting it reach storage and return an empty result set.
 *
 * Uses `handleError`, so the failure shape matches what `todos list` already does
 * for `--sort`, `--format` and `--project-name`: red message on stderr, exit 1,
 * plus the `{"error":...}` stdout envelope under `--json`.
 *
 * Returns a bare string for a single value and an array for a comma-separated
 * list, matching the `TaskFilter` field types and keeping the generated query
 * identical to the pre-validation behaviour for single-value callers.
 */
export function parseEnumFlag<T extends string>(
  raw: string | undefined,
  spec: EnumVocabularySpec<T>,
): T | T[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  const result = resolveEnumVocabulary(String(raw), spec);
  if (!result.ok) handleError(new Error(result.message));
  return collapseEnumValues(result.values);
}

/** Same as `parseEnumFlag` but always an array, for callers whose filter field is a list. */
export function parseEnumFlagList<T extends string>(
  raw: string | undefined,
  spec: EnumVocabularySpec<T>,
): T[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  const result = resolveEnumVocabulary(String(raw), spec);
  if (!result.ok) handleError(new Error(result.message));
  return result.values;
}

/** Vocabulary spec for any `--status` flag over the canonical task statuses. */
export const TASK_STATUS_FLAG: EnumVocabularySpec<TaskStatus> = {
  name: "--status",
  vocabulary: TASK_STATUSES,
  normalize: normalizeStatus,
  hints: TASK_STATUS_FLAG_HINTS,
};

/** Vocabulary spec for any `--priority` flag over the canonical task priorities. */
export const TASK_PRIORITY_FLAG: EnumVocabularySpec<TaskPriority> = {
  name: "--priority",
  vocabulary: TASK_PRIORITIES,
  normalize: normalizePriority,
};

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

/**
 * Render one entity for a human: `key: value` lines, nested values as JSON.
 *
 * Field order follows the object's own key order so it tracks the row shape
 * instead of a hand-maintained list of column names.
 */
function formatRecordLines(data: unknown): string[] {
  if (data === null || data === undefined) return [];
  if (typeof data !== "object") return [String(data)];
  if (Array.isArray(data)) {
    return data.flatMap((entry, index) => [
      chalk.dim(`[${index}]`),
      ...formatRecordLines(entry).map((line) => `  ${line}`),
    ]);
  }
  const lines: string[] = [];
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (value === undefined) continue;
    const rendered = value === null
      ? chalk.dim("—")
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
    lines.push(`  ${chalk.dim(`${key}:`)} ${rendered}`);
  }
  return lines;
}

/**
 * Emit one entity on stdout in BOTH modes.
 *
 * `output()` prints only under `--json`, so call sites that used it as their only
 * emitter exited 0 with completely empty stdout in human mode — including two
 * mutations (`projects --update`, `lists --update`) that gave no sign the write
 * had landed. Those call sites use this instead. JSON mode is unchanged: it goes
 * through the same `printJson`, byte for byte.
 *
 * Call sites that already print their own human rendering after `output()` must
 * keep using `output()`, otherwise they would print twice.
 */
export function outputRecord(data: unknown, jsonMode: boolean, heading?: string): void {
  if (jsonMode) {
    printJson(data);
    return;
  }
  if (heading) console.log(chalk.bold(heading));
  const lines = formatRecordLines(data);
  if (lines.length === 0) {
    console.log(chalk.dim("(empty)"));
    return;
  }
  for (const line of lines) console.log(line);
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
  const lockState = lockDisplayState(t.locked_by, t.locked_at);
  const lock = lockState.held ? chalk.magenta(` [locked:${lockState.holder}]`) : "";
  const assigned = t.assigned_to ? chalk.cyan(` -> ${t.assigned_to}`) : "";
  const tags = t.tags.length > 0 ? chalk.dim(` [${t.tags.join(",")}]`) : "";
  const plan = t.plan_id ? chalk.magenta(` [plan:${t.plan_id.slice(0, 8)}]`) : "";
  return `${chalk.dim(t.id.slice(0, 8))} ${statusFn(t.status.padEnd(11))} ${priorityFn(t.priority.padEnd(8))} ${t.title}${assigned}${lock}${tags}${plan}`;
}
