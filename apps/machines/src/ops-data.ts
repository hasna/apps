import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { getPackageVersion } from "./version.js";
import { MACHINES_CONSUMER_CONTRACT_VERSION, MACHINES_PACKAGE_NAME } from "./topology.js";

export type MachineDataSeverity = "critical" | "warning" | "notice";
export type MachineDataTaskPriority = "critical" | "high" | "medium" | "low";
export type MachineDataTaskActionStatus = "created" | "existing" | "failed" | "skipped";

export interface MachineDataTaskSuggestion {
  fingerprint: string;
  dedupe_key: string;
  title: string;
  description: string;
  priority: MachineDataTaskPriority;
  tags: string[];
}

export interface MachineDataTaskAction {
  action: MachineDataTaskActionStatus;
  dedupe_key: string;
  title: string;
  task_id?: string;
  error?: string;
  reason?: string;
}

export interface MachineDataTaskUpsertOptions {
  project?: string;
  taskList?: string;
  todosBin?: string;
  maxActions?: number;
  commandTimeoutMs?: number;
  runner?: MachineDataTodosCommandRunner;
}

export interface MachineDataTodosCommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: unknown;
}

export type MachineDataTodosCommandRunner = (args: string[]) => MachineDataTodosCommandResult;

export interface CriticalDbIntegrityFinding {
  path: string;
  size_bytes: number;
  status: "ok" | "failed" | "skipped_large" | "skipped_max_dbs";
  check_tool: "sqlite3" | "none";
  message: string | null;
  fingerprint: string;
}

export interface CriticalDbIntegrityReport {
  schema_version: typeof MACHINES_CONSUMER_CONTRACT_VERSION;
  package: { name: typeof MACHINES_PACKAGE_NAME; version: string };
  generated_at: string;
  kind: "machine_data_db_integrity";
  ok: boolean;
  roots: string[];
  summary: {
    discovered: number;
    checked: number;
    failed: number;
    skipped: number;
    skipped_large: number;
    truncated: boolean;
  };
  findings: CriticalDbIntegrityFinding[];
  task_suggestions: MachineDataTaskSuggestion[];
  task_actions?: MachineDataTaskAction[];
  artifacts: Array<{ kind: string; ref: string; format: "json"; private: boolean }>;
  bounds: {
    max_dbs: number;
    max_size_bytes: number;
    max_depth: number;
    quick_check_timeout_ms: number;
  };
}

export interface DbIntegrityOptions {
  roots?: string[];
  maxDbs?: number;
  maxSizeBytes?: number;
  maxDepth?: number;
  quickCheckTimeoutMs?: number;
  reportDir?: string;
  sqliteBin?: string;
}

export interface OpsStateSnapshotItem {
  path: string;
  size_bytes: number;
  status: "planned" | "sqlite_backup" | "copy" | "backup_failed" | "copy_failed" | "skipped_large" | "skipped_max_dbs";
  method: "sqlite_backup" | "copy" | "none";
  snapshot_path: string | null;
  message: string | null;
  fingerprint: string;
}

export interface OpsStateSnapshotReport {
  schema_version: typeof MACHINES_CONSUMER_CONTRACT_VERSION;
  package: { name: typeof MACHINES_PACKAGE_NAME; version: string };
  generated_at: string;
  kind: "machine_data_ops_state_snapshot";
  ok: boolean;
  apply: boolean;
  roots: string[];
  snapshot_root: string;
  snapshot_dir: string | null;
  summary: {
    discovered: number;
    planned: number;
    copied: number;
    failed: number;
    skipped: number;
    removed_old_snapshots: number;
    truncated: boolean;
  };
  items: OpsStateSnapshotItem[];
  task_suggestions: MachineDataTaskSuggestion[];
  task_actions?: MachineDataTaskAction[];
  artifacts: Array<{ kind: string; ref: string; format: "json"; private: boolean }>;
  bounds: {
    max_dbs: number;
    max_size_bytes: number;
    max_depth: number;
    keep_days: number;
  };
}

export interface OpsStateSnapshotOptions {
  roots?: string[];
  snapshotRoot?: string;
  reportDir?: string;
  maxDbs?: number;
  maxSizeBytes?: number;
  maxDepth?: number;
  keepDays?: number;
  apply?: boolean;
  sqliteBin?: string;
}

const DEFAULT_ROOTS = [join(homedir(), ".hasna"), join(homedir(), ".codewith")];
const DEFAULT_DB_MAX_SIZE_BYTES = 2 * 1024 * 1024 * 1024;
const DEFAULT_SNAPSHOT_MAX_SIZE_BYTES = 768 * 1024 * 1024;
const DEFAULT_DB_MAX_DBS = 500;
const DEFAULT_SNAPSHOT_MAX_DBS = 200;
const DEFAULT_DB_MAX_DEPTH = 12;
const DEFAULT_SNAPSHOT_MAX_DEPTH = 4;
const DEFAULT_QUICK_CHECK_TIMEOUT_MS = 45_000;
const DEFAULT_KEEP_DAYS = 14;
const MAX_TRUNCATED_ENTRIES = 20;
const SNAPSHOT_DIR_NAME_RE = /^\d{8}T\d{6}Z$/;
const BASE_SKIP_DIRS = new Set([".git", "node_modules", "target", "dist", "cache", "reports", "quarantine", "snapshots"]);
const DB_INTEGRITY_SKIP_DIRS = BASE_SKIP_DIRS;
const SNAPSHOT_SKIP_DIRS = new Set([...BASE_SKIP_DIRS, "backups", "accounts"]);
const TERMINAL_TASK_STATUSES = new Set(["done", "completed", "cancelled", "canceled", "deleted", "archived"]);

export function getCriticalDbIntegrityReport(options: DbIntegrityOptions = {}): CriticalDbIntegrityReport {
  const roots = normalizeRoots(options.roots);
  const maxDbs = normalizePositiveInteger(options.maxDbs, DEFAULT_DB_MAX_DBS);
  const maxSizeBytes = normalizePositiveInteger(options.maxSizeBytes, DEFAULT_DB_MAX_SIZE_BYTES);
  const maxDepth = normalizePositiveInteger(options.maxDepth, DEFAULT_DB_MAX_DEPTH);
  const quickCheckTimeoutMs = normalizePositiveInteger(options.quickCheckTimeoutMs, DEFAULT_QUICK_CHECK_TIMEOUT_MS);
  const files = discoverDbFiles(roots, { maxDbs, maxDepth, skipDirs: DB_INTEGRITY_SKIP_DIRS });
  const findings: CriticalDbIntegrityFinding[] = [];

  for (const entry of files.entries) {
    if (entry.truncated) {
      findings.push(dbFinding(entry.path, 0, "skipped_max_dbs", "none", "max db limit reached"));
      continue;
    }
    const size = fileSize(entry.path);
    if (size > maxSizeBytes) {
      findings.push(dbFinding(entry.path, size, "skipped_large", "none", `size ${size} exceeds max ${maxSizeBytes}`));
      continue;
    }
    const check = quickCheckSqlite(entry.path, {
      sqliteBin: options.sqliteBin,
      timeoutMs: quickCheckTimeoutMs,
    });
    findings.push(dbFinding(
      entry.path,
      size,
      check.ok ? "ok" : "failed",
      check.tool,
      check.ok ? null : check.message,
    ));
  }

  const failed = findings.filter((finding) => finding.status === "failed");
  const skippedLarge = findings.filter((finding) => finding.status === "skipped_large").length;
  const skipped = findings.filter((finding) => finding.status.startsWith("skipped")).length;
  const report: CriticalDbIntegrityReport = {
    schema_version: MACHINES_CONSUMER_CONTRACT_VERSION,
    package: packageInfo(),
    generated_at: new Date().toISOString(),
    kind: "machine_data_db_integrity",
    ok: failed.length === 0,
    roots,
    summary: {
      discovered: files.discovered,
      checked: findings.filter((finding) => finding.status === "ok" || finding.status === "failed").length,
      failed: failed.length,
      skipped,
      skipped_large: skippedLarge,
      truncated: files.truncated,
    },
    findings,
    task_suggestions: failed.map(dbIntegrityTaskSuggestion),
    artifacts: [],
    bounds: {
      max_dbs: maxDbs,
      max_size_bytes: maxSizeBytes,
      max_depth: maxDepth,
      quick_check_timeout_ms: quickCheckTimeoutMs,
    },
  };
  writeReportIfRequested(report, options.reportDir, "critical-db-integrity");
  return report;
}

export function getOpsStateSnapshotReport(options: OpsStateSnapshotOptions = {}): OpsStateSnapshotReport {
  const roots = normalizeRoots(options.roots);
  const maxDbs = normalizePositiveInteger(options.maxDbs, DEFAULT_SNAPSHOT_MAX_DBS);
  const maxSizeBytes = normalizePositiveInteger(options.maxSizeBytes, DEFAULT_SNAPSHOT_MAX_SIZE_BYTES);
  const maxDepth = normalizePositiveInteger(options.maxDepth, DEFAULT_SNAPSHOT_MAX_DEPTH);
  const keepDays = normalizePositiveInteger(options.keepDays, DEFAULT_KEEP_DAYS);
  const apply = Boolean(options.apply);
  const snapshotRoot = resolve(options.snapshotRoot ?? join(homedir(), ".hasna", "loops", "snapshots", "ops-state"));
  const snapshotDir = apply ? join(snapshotRoot, timestamp()) : null;
  const files = discoverDbFiles(roots, { maxDbs, maxDepth, skipDirs: SNAPSHOT_SKIP_DIRS });
  const items: OpsStateSnapshotItem[] = [];

  if (apply && snapshotDir) {
    mkdirPrivate(snapshotRoot);
    mkdirPrivate(snapshotDir);
  }

  for (const entry of files.entries) {
    if (entry.truncated) {
      items.push(snapshotItem(entry.path, 0, "skipped_max_dbs", "none", null, "max db limit reached"));
      continue;
    }
    const size = fileSize(entry.path);
    if (size > maxSizeBytes) {
      items.push(snapshotItem(entry.path, size, "skipped_large", "none", null, `size ${size} exceeds max ${maxSizeBytes}`));
      continue;
    }

    const out = snapshotDir ? join(snapshotDir, snapshotFileName(entry.path)) : join(snapshotRoot, timestamp(), snapshotFileName(entry.path));
    if (!apply) {
      items.push(snapshotItem(entry.path, size, "planned", "none", out, null));
      continue;
    }

    const copied = snapshotDb(entry.path, out, { sqliteBin: options.sqliteBin });
    items.push(snapshotItem(
      entry.path,
      size,
      copied.ok ? copied.method : copied.method === "sqlite_backup" ? "backup_failed" : "copy_failed",
      copied.method,
      copied.ok ? out : null,
      copied.ok ? null : copied.message,
    ));
  }

  const removed = apply ? removeOldSnapshots(snapshotRoot, keepDays) : 0;
  const failed = items.filter((item) => item.status === "backup_failed" || item.status === "copy_failed");
  const copied = items.filter((item) => item.status === "sqlite_backup" || item.status === "copy");
  const skipped = items.filter((item) => item.status.startsWith("skipped")).length;
  const report: OpsStateSnapshotReport = {
    schema_version: MACHINES_CONSUMER_CONTRACT_VERSION,
    package: packageInfo(),
    generated_at: new Date().toISOString(),
    kind: "machine_data_ops_state_snapshot",
    ok: failed.length === 0,
    apply,
    roots,
    snapshot_root: snapshotRoot,
    snapshot_dir: snapshotDir,
    summary: {
      discovered: files.discovered,
      planned: apply ? 0 : items.filter((item) => item.status === "planned").length,
      copied: copied.length,
      failed: failed.length,
      skipped,
      removed_old_snapshots: removed,
      truncated: files.truncated,
    },
    items,
    task_suggestions: failed.map(snapshotFailureTaskSuggestion),
    artifacts: [],
    bounds: {
      max_dbs: maxDbs,
      max_size_bytes: maxSizeBytes,
      max_depth: maxDepth,
      keep_days: keepDays,
    },
  };
  writeReportIfRequested(report, options.reportDir, "ops-state-snapshot");
  return report;
}

export function upsertMachineDataTasks(
  result: { generated_at: string; kind: string; ok: boolean; task_suggestions: MachineDataTaskSuggestion[]; task_actions?: MachineDataTaskAction[] },
  options: MachineDataTaskUpsertOptions,
): MachineDataTaskAction[] {
  const suggestions = result.task_suggestions;
  if (!suggestions.length) {
    result.task_actions = [];
    return [];
  }
  if (!options.project) {
    const actions = suggestions.map((suggestion) => ({
      action: "failed" as const,
      dedupe_key: suggestion.dedupe_key,
      title: suggestion.title,
      error: "--todos-project is required when --upsert-tasks is used",
    }));
    result.task_actions = actions;
    return actions;
  }

  const maxCreations = normalizePositiveInteger(options.maxActions, suggestions.length);
  const run = options.runner ?? defaultTodosRunner(options.todosBin ?? "todos", options.commandTimeoutMs);
  const actions: MachineDataTaskAction[] = [];
  let created = 0;

  for (const suggestion of suggestions) {
    const tag = dedupeTag(suggestion);
    const tags = [...new Set([...suggestion.tags.map(safeTag), tag])];
    const search = run([...todosBaseArgs(options.project), "search", tag, "--tag", tag, "--limit", "10"]);
    if (search.error || search.status !== 0) {
      actions.push({
        action: "failed",
        dedupe_key: suggestion.dedupe_key,
        title: suggestion.title,
        error: boundedText(String(search.error ?? (search.stderr.trim() || `todos search exited ${search.status}`))),
      });
      continue;
    }

    let existing: { id?: string; status?: string } | undefined;
    try {
      existing = parseTaskList(search.stdout).find((task) => task.id && !TERMINAL_TASK_STATUSES.has(task.status ?? ""));
    } catch (error) {
      actions.push({
        action: "failed",
        dedupe_key: suggestion.dedupe_key,
        title: suggestion.title,
        error: `unable to parse todos search JSON: ${error instanceof Error ? error.message : String(error)}`,
      });
      continue;
    }
    if (existing?.id) {
      actions.push({ action: "existing", dedupe_key: suggestion.dedupe_key, title: suggestion.title, task_id: existing.id });
      continue;
    }

    if (created >= maxCreations) {
      actions.push({ action: "skipped", dedupe_key: suggestion.dedupe_key, title: suggestion.title, reason: `max task creations ${maxCreations} reached` });
      continue;
    }

    const createdTask = run([
      ...todosBaseArgs(options.project),
      "add",
      suggestion.title,
      "-d",
      taskUpsertDescription(result, suggestion),
      "-p",
      suggestion.priority,
      "--tags",
      tags.join(","),
      ...(options.taskList ? ["--task-list", options.taskList] : []),
    ]);
    if (createdTask.error || createdTask.status !== 0) {
      actions.push({
        action: "failed",
        dedupe_key: suggestion.dedupe_key,
        title: suggestion.title,
        error: boundedText(String(createdTask.error ?? (createdTask.stderr.trim() || `todos add exited ${createdTask.status}`))),
      });
      continue;
    }
    created += 1;
    try {
      const task = parseTask(createdTask.stdout);
      actions.push({ action: "created", dedupe_key: suggestion.dedupe_key, title: suggestion.title, task_id: task?.id });
    } catch (error) {
      actions.push({
        action: "failed",
        dedupe_key: suggestion.dedupe_key,
        title: suggestion.title,
        error: `unable to parse todos add JSON: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  result.task_actions = actions;
  return actions;
}

function discoverDbFiles(roots: string[], options: { maxDbs: number; maxDepth: number; skipDirs: Set<string> }): {
  entries: Array<{ path: string; truncated: boolean }>;
  discovered: number;
  truncated: boolean;
} {
  const entries: Array<{ path: string; truncated: boolean }> = [];
  let discovered = 0;
  let truncated = false;
  let truncatedEntries = 0;
  let stop = false;
  const seen = new Set<string>();

  const visit = (dir: string, depth: number): void => {
    if (stop) return;
    if (depth > options.maxDepth) return;
    let stat;
    try {
      stat = statSync(dir);
    } catch {
      return;
    }
    if (!stat.isDirectory()) return;

    let children;
    try {
      children = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    children.sort((a, b) => a.name.localeCompare(b.name));
    for (const child of children) {
      if (stop) break;
      const path = join(dir, child.name);
      if (child.isDirectory()) {
        if (options.skipDirs.has(child.name)) continue;
        visit(path, depth + 1);
        continue;
      }
      if (!child.isFile() || !isDbFile(child.name)) continue;
      discovered += 1;
      if (seen.has(path)) continue;
      seen.add(path);
      if (entries.filter((entry) => !entry.truncated).length >= options.maxDbs) {
        truncated = true;
        if (truncatedEntries < MAX_TRUNCATED_ENTRIES) {
          entries.push({ path, truncated: true });
          truncatedEntries += 1;
        }
        if (truncatedEntries >= MAX_TRUNCATED_ENTRIES) stop = true;
        continue;
      }
      entries.push({ path, truncated: false });
    }
  };

  for (const root of roots) visit(root, 0);
  return { entries, discovered, truncated };
}

function quickCheckSqlite(path: string, options: { sqliteBin?: string; timeoutMs: number }): { ok: boolean; tool: "sqlite3" | "none"; message: string } {
  const bin = options.sqliteBin ?? "sqlite3";
  const result = spawnSync(bin, [path, "PRAGMA quick_check;"], {
    encoding: "utf8",
    timeout: options.timeoutMs,
    maxBuffer: 512 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error && (result.error as NodeJS.ErrnoException).code === "ENOENT") {
    return { ok: false, tool: "none", message: `${bin} unavailable` };
  }
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  return { ok: result.status === 0 && output === "ok", tool: "sqlite3", message: compactMessage(output || result.error?.message || `sqlite3 exited ${result.status}`) };
}

function snapshotDb(path: string, out: string, options: { sqliteBin?: string }): { ok: boolean; method: "sqlite_backup" | "copy"; message: string } {
  mkdirPrivate(dirname(out));
  const check = quickCheckSqlite(path, { sqliteBin: options.sqliteBin, timeoutMs: DEFAULT_QUICK_CHECK_TIMEOUT_MS });
  if (!check.ok) {
    return {
      ok: false,
      method: "sqlite_backup",
      message: compactMessage(`quick_check failed before backup: ${check.message}; refusing unsafe file copy snapshot`),
    };
  }
  const result = spawnSync(options.sqliteBin ?? "sqlite3", [path, `.backup ${quoteSqliteShellPath(out)}`], {
    encoding: "utf8",
    timeout: DEFAULT_QUICK_CHECK_TIMEOUT_MS,
    maxBuffer: 512 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0 || result.error) {
    return { ok: false, method: "sqlite_backup", message: compactMessage(result.error?.message ?? result.stderr ?? `sqlite3 backup exited ${result.status}`) };
  }
  chmodIfExists(out, 0o600);
  const verify = quickCheckSqlite(out, { sqliteBin: options.sqliteBin, timeoutMs: DEFAULT_QUICK_CHECK_TIMEOUT_MS });
  if (!verify.ok) {
    rmSync(out, { force: true });
    return { ok: false, method: "sqlite_backup", message: compactMessage(`snapshot verification failed: ${verify.message}`) };
  }
  return { ok: true, method: "sqlite_backup", message: "" };
}

function dbIntegrityTaskSuggestion(finding: CriticalDbIntegrityFinding): MachineDataTaskSuggestion {
  return {
    fingerprint: finding.fingerprint,
    dedupe_key: `machines:data:db-integrity:${finding.fingerprint}`,
    title: `[machines:data] Fix DB integrity failure in ${basename(finding.path)}`,
    description: [
      "source: @hasna/machines ops db-integrity",
      `fingerprint: ${finding.fingerprint}`,
      `path: ${finding.path}`,
      `size_bytes: ${finding.size_bytes}`,
      `check_tool: ${finding.check_tool}`,
      `message: ${finding.message ?? ""}`,
      "",
      "Investigate the database safely. Do not delete or overwrite live data without an explicit backup and approval.",
    ].join("\n"),
    priority: "critical",
    tags: ["machines", "ops-data", "db-integrity"],
  };
}

function snapshotFailureTaskSuggestion(item: OpsStateSnapshotItem): MachineDataTaskSuggestion {
  return {
    fingerprint: item.fingerprint,
    dedupe_key: `machines:data:state-snapshot:${item.fingerprint}`,
    title: `[machines:data] Fix state snapshot failure for ${basename(item.path)}`,
    description: [
      "source: @hasna/machines ops state-snapshot",
      `fingerprint: ${item.fingerprint}`,
      `path: ${item.path}`,
      `size_bytes: ${item.size_bytes}`,
      `method: ${item.method}`,
      `message: ${item.message ?? ""}`,
      "",
      "Fix snapshot reliability without deleting live state. Preserve report and snapshot evidence.",
    ].join("\n"),
    priority: "high",
    tags: ["machines", "ops-data", "state-snapshot"],
  };
}

function dbFinding(
  path: string,
  size: number,
  status: CriticalDbIntegrityFinding["status"],
  tool: CriticalDbIntegrityFinding["check_tool"],
  message: string | null,
): CriticalDbIntegrityFinding {
  return {
    path,
    size_bytes: size,
    status,
    check_tool: tool,
    message: message ? compactMessage(message) : null,
    fingerprint: fingerprint(["db-integrity", path, status]),
  };
}

function snapshotItem(
  path: string,
  size: number,
  status: OpsStateSnapshotItem["status"],
  method: OpsStateSnapshotItem["method"],
  snapshotPath: string | null,
  message: string | null,
): OpsStateSnapshotItem {
  return {
    path,
    size_bytes: size,
    status,
    method,
    snapshot_path: snapshotPath,
    message: message ? compactMessage(message) : null,
    fingerprint: fingerprint(["state-snapshot", path, status]),
  };
}

function writeReportIfRequested(report: { artifacts: Array<{ kind: string; ref: string; format: "json"; private: boolean }> }, reportDir: string | undefined, prefix: string): void {
  if (!reportDir) return;
  mkdirPrivate(reportDir);
  const path = join(reportDir, `${prefix}-${timestamp()}.json`);
  report.artifacts.push({ kind: "report", ref: path, format: "json", private: true });
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  chmodIfExists(path, 0o600);
}

function removeOldSnapshots(snapshotRoot: string, keepDays: number): number {
  if (!existsSync(snapshotRoot)) return 0;
  const cutoff = Date.now() - keepDays * 86_400_000;
  let removed = 0;
  for (const entry of readdirSync(snapshotRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (!SNAPSHOT_DIR_NAME_RE.test(entry.name)) continue;
    const path = join(snapshotRoot, entry.name);
    try {
      if (statSync(path).mtimeMs <= cutoff && !containsForeignFilesystem(path)) {
        rmSync(path, { recursive: true, force: true });
        removed += 1;
      }
    } catch {
      // Ignore retention races; the next run can retry.
    }
  }
  return removed;
}

function containsForeignFilesystem(path: string): boolean {
  let rootDev: number;
  try {
    rootDev = statSync(path).dev;
  } catch {
    return true;
  }
  const stack = [path];
  let visited = 0;
  while (stack.length) {
    const dir = stack.pop()!;
    if (visited > 10_000) return true;
    visited += 1;
    let children;
    try {
      children = readdirSync(dir, { withFileTypes: true });
    } catch {
      return true;
    }
    for (const child of children) {
      if (!child.isDirectory()) continue;
      const childPath = join(dir, child.name);
      try {
        if (statSync(childPath).dev !== rootDev) return true;
      } catch {
        return true;
      }
      stack.push(childPath);
    }
  }
  return false;
}

function taskUpsertDescription(
  result: { generated_at: string; kind: string; ok: boolean },
  suggestion: MachineDataTaskSuggestion,
): string {
  return [
    `dedupe_key: ${suggestion.dedupe_key}`,
    "source: @hasna/machines ops data",
    `kind: ${result.kind}`,
    `checked_at: ${result.generated_at}`,
    `ok: ${result.ok}`,
    "",
    suggestion.description,
  ].join("\n");
}

function defaultTodosRunner(todosBin: string, timeoutMs = 30_000): MachineDataTodosCommandRunner {
  return (args) => {
    const child = spawnSync(todosBin, args, {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      timeout: timeoutMs,
    });
    return {
      status: child.status,
      stdout: child.stdout ?? "",
      stderr: child.stderr ?? "",
      error: child.error,
    };
  };
}

function parseTaskList(stdout: string): Array<{ id?: string; status?: string }> {
  const raw = stdout.trim();
  if (!raw) return [];
  const value = JSON.parse(raw) as unknown;
  if (Array.isArray(value)) return value as Array<{ id?: string; status?: string }>;
  if (value && typeof value === "object" && "tasks" in value && Array.isArray((value as { tasks?: unknown }).tasks)) {
    return (value as { tasks: Array<{ id?: string; status?: string }> }).tasks;
  }
  return [];
}

function parseTask(stdout: string): { id?: string; status?: string } | null {
  const raw = stdout.trim();
  if (!raw) return null;
  const value = JSON.parse(raw) as unknown;
  return value && typeof value === "object" ? value as { id?: string; status?: string } : null;
}

function todosBaseArgs(project: string): string[] {
  return ["--project", project, "-j"];
}

function dedupeTag(suggestion: MachineDataTaskSuggestion): string {
  return `dedupe-${fingerprint(suggestion.dedupe_key)}`;
}

function safeTag(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "unknown";
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
}

function packageInfo(): { name: typeof MACHINES_PACKAGE_NAME; version: string } {
  return { name: MACHINES_PACKAGE_NAME, version: getPackageVersion() };
}

function normalizeRoots(roots: string[] | undefined): string[] {
  return [...new Set((roots?.length ? roots : DEFAULT_ROOTS).map((root) => resolve(root)))];
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  if (value == null || !Number.isFinite(value) || value < 1) return fallback;
  return Math.floor(value);
}

function isDbFile(name: string): boolean {
  if (name.endsWith("-wal") || name.endsWith("-shm")) return false;
  return name.endsWith(".db") || name.endsWith(".sqlite") || name.endsWith(".sqlite3");
}

function fileSize(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

function snapshotFileName(path: string): string {
  const rel = relative(homedir(), path);
  const normalized = rel && !rel.startsWith("..") ? rel : path.replace(/^\/+/, "");
  return normalized.split(sep).filter(Boolean).join("__");
}

function quoteSqliteShellPath(path: string): string {
  return `'${path.replace(/'/g, "''")}'`;
}

function timestamp(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function mkdirPrivate(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  chmodIfExists(path, 0o700);
}

function chmodIfExists(path: string, mode: number): void {
  try {
    chmodSync(path, mode);
  } catch {
    // Best effort. Report files are created with private modes even if chmod fails.
  }
}

function compactMessage(value: string): string {
  const text = value.replace(/\s+/g, " ").trim();
  return boundedText(text, 500);
}

function boundedText(value: string, maxLength = 1_000): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...[truncated ${value.length - maxLength} chars]` : value;
}
