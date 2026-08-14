import type { Database } from "bun:sqlite";
import { getDatabase, getDatabasePath } from "../db/database.js";
import { listTasks } from "../db/tasks.js";
import { searchTasks } from "./search.js";

export interface ScaleBenchmark {
  name: string;
  rows: number;
  elapsed_ms: number;
  threshold_ms: number;
  ok: boolean;
}

export interface ScalePerformanceReport {
  schema_version: 1;
  local_only: true;
  no_network: true;
  generated_at: string;
  database_path: string;
  counts: {
    tasks: number;
    archived_tasks: number;
    projects: number;
    agents: number;
    plans: number;
    runs: number;
    run_events: number;
    comments: number;
    dependencies: number;
  };
  benchmarks: ScaleBenchmark[];
  archive: {
    terminal_unarchived_tasks: number;
    older_than_days: number;
    older_terminal_unarchived_tasks: number;
    archived_tasks_visible_with_include_archived: boolean;
  };
  compaction: {
    page_count: number;
    freelist_count: number;
    freelist_ratio: number;
    recommended: boolean;
    commands: string[];
  };
  integrity: {
    quick_check: string;
    foreign_key_violations: number;
    missing_indexes: string[];
    ok: boolean;
  };
  warnings: string[];
}

export interface ScaleCompactionResult {
  schema_version: 1;
  local_only: true;
  no_network: true;
  dry_run: boolean;
  database_path: string;
  before: {
    page_count: number;
    freelist_count: number;
  };
  after: {
    page_count: number;
    freelist_count: number;
  };
  actions: string[];
}

export interface CreateScalePerformanceReportOptions {
  older_than_days?: number;
  generated_at?: string;
}

export interface CompactScaleStorageOptions {
  apply?: boolean;
}

const REQUIRED_INDEXES = [
  "idx_tasks_project",
  "idx_tasks_status",
  "idx_tasks_archived_at",
  "idx_tasks_updated_at",
  "idx_task_runs_task",
  "idx_task_run_events_run",
  "idx_comments_task",
  "idx_task_dependencies_task",
  "idx_task_dependencies_depends_on",
];

function count(db: Database, sql: string): number {
  const row = db.query(sql).get() as { count: number } | undefined;
  return row?.count ?? 0;
}

function pragmaNumber(db: Database, name: string): number {
  const row = db.query(`PRAGMA ${name}`).get() as Record<string, number> | undefined;
  const value = row ? Object.values(row)[0] : 0;
  return typeof value === "number" ? value : 0;
}

function quickCheck(db: Database): string {
  try {
    const row = db.query("PRAGMA quick_check").get() as { quick_check: string } | undefined;
    return row?.quick_check ?? "unknown";
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function foreignKeyViolations(db: Database): number {
  try {
    return db.query("PRAGMA foreign_key_check").all().length;
  } catch {
    return 0;
  }
}

function missingIndexes(db: Database): string[] {
  const rows = db.query("SELECT name FROM sqlite_master WHERE type='index'").all() as { name: string }[];
  const existing = new Set(rows.map(row => row.name));
  return REQUIRED_INDEXES.filter(index => !existing.has(index));
}

function benchmark(name: string, thresholdMs: number, fn: () => number): ScaleBenchmark {
  const start = performance.now();
  const rows = fn();
  const elapsed = Math.max(0, performance.now() - start);
  const elapsed_ms = Math.round(elapsed * 1000) / 1000;
  return {
    name,
    rows,
    elapsed_ms,
    threshold_ms: thresholdMs,
    ok: elapsed_ms <= thresholdMs,
  };
}

function cutoffDate(days: number): string {
  return new Date(Date.now() - days * 86400000).toISOString();
}

function normalizedPositiveDays(value: number | undefined): number {
  if (value === undefined) return 30;
  if (!Number.isFinite(value)) return 30;
  return Math.max(1, Math.trunc(value));
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatMs(value: number): string {
  return `${value.toFixed(value >= 10 ? 1 : 3)}ms`;
}

export function createScalePerformanceReport(options: CreateScalePerformanceReportOptions = {}, db?: Database): ScalePerformanceReport {
  const d = db || getDatabase();
  const olderThanDays = normalizedPositiveDays(options.older_than_days);
  const pageCount = pragmaNumber(d, "page_count");
  const freelistCount = pragmaNumber(d, "freelist_count");
  const freelistRatio = pageCount > 0 ? Math.round((freelistCount / pageCount) * 1000) / 1000 : 0;
  const quick = quickCheck(d);
  const fkViolations = foreignKeyViolations(d);
  const missing = missingIndexes(d);
  const oldCutoff = cutoffDate(olderThanDays);
  const terminalUnarchived = count(d, "SELECT COUNT(*) AS count FROM tasks WHERE archived_at IS NULL AND status IN ('completed', 'failed', 'cancelled')");
  const oldTerminalUnarchived = count(d, `SELECT COUNT(*) AS count FROM tasks WHERE archived_at IS NULL AND status IN ('completed', 'failed', 'cancelled') AND updated_at < '${oldCutoff}'`);
  const archivedCount = count(d, "SELECT COUNT(*) AS count FROM tasks WHERE archived_at IS NOT NULL");

  const benchmarks = [
    benchmark("open_task_list", 50, () => listTasks({ status: ["pending", "in_progress"], limit: 100 }, d).length),
    benchmark("search_recent_tasks", 75, () => searchTasks({ query: "*", status: ["pending", "in_progress"] }, undefined, undefined, d).length),
    benchmark("archived_task_scan", 75, () => listTasks({ include_archived: true, limit: 100 }, d).length),
    benchmark("run_ledger_recent", 75, () => count(d, "SELECT COUNT(*) AS count FROM (SELECT id FROM task_runs ORDER BY started_at DESC LIMIT 100)")),
    benchmark("dependency_blockers", 75, () => count(d, "SELECT COUNT(*) AS count FROM task_dependencies td JOIN tasks dep ON dep.id = td.depends_on WHERE dep.status != 'completed'")),
  ];

  const warnings: string[] = [];
  if (freelistRatio >= 0.2 && freelistCount >= 100) warnings.push("database has enough free pages to consider VACUUM during a maintenance window");
  if (oldTerminalUnarchived > 0) warnings.push(`${oldTerminalUnarchived} old terminal tasks can be archived without deleting evidence`);
  if (missing.length > 0) warnings.push(`missing expected index(es): ${missing.join(", ")}`);
  if (fkViolations > 0) warnings.push(`${fkViolations} foreign key violation(s) detected`);
  for (const item of benchmarks) {
    if (!item.ok) warnings.push(`${item.name} exceeded ${item.threshold_ms}ms threshold`);
  }

  return {
    schema_version: 1,
    local_only: true,
    no_network: true,
    generated_at: options.generated_at ?? new Date().toISOString(),
    database_path: getDatabasePath(),
    counts: {
      tasks: count(d, "SELECT COUNT(*) AS count FROM tasks"),
      archived_tasks: archivedCount,
      projects: count(d, "SELECT COUNT(*) AS count FROM projects"),
      agents: count(d, "SELECT COUNT(*) AS count FROM agents"),
      plans: count(d, "SELECT COUNT(*) AS count FROM plans"),
      runs: count(d, "SELECT COUNT(*) AS count FROM task_runs"),
      run_events: count(d, "SELECT COUNT(*) AS count FROM task_run_events"),
      comments: count(d, "SELECT COUNT(*) AS count FROM task_comments"),
      dependencies: count(d, "SELECT COUNT(*) AS count FROM task_dependencies"),
    },
    benchmarks,
    archive: {
      terminal_unarchived_tasks: terminalUnarchived,
      older_than_days: olderThanDays,
      older_terminal_unarchived_tasks: oldTerminalUnarchived,
      archived_tasks_visible_with_include_archived: archivedCount === 0 || listTasks({ include_archived: true, limit: 5000 }, d).some(task => Boolean((task as { archived_at?: string | null }).archived_at)),
    },
    compaction: {
      page_count: pageCount,
      freelist_count: freelistCount,
      freelist_ratio: freelistRatio,
      recommended: freelistRatio >= 0.2 && freelistCount >= 100,
      commands: ["PRAGMA optimize", "VACUUM"],
    },
    integrity: {
      quick_check: quick,
      foreign_key_violations: fkViolations,
      missing_indexes: missing,
      ok: quick === "ok" && fkViolations === 0 && missing.length === 0,
    },
    warnings,
  };
}

export function compactScaleStorage(options: CompactScaleStorageOptions = {}, db?: Database): ScaleCompactionResult {
  const d = db || getDatabase();
  const before = {
    page_count: pragmaNumber(d, "page_count"),
    freelist_count: pragmaNumber(d, "freelist_count"),
  };
  const actions = ["PRAGMA optimize", "VACUUM"];
  if (options.apply) {
    d.run("PRAGMA optimize");
    d.run("VACUUM");
  }
  const after = {
    page_count: pragmaNumber(d, "page_count"),
    freelist_count: pragmaNumber(d, "freelist_count"),
  };
  return {
    schema_version: 1,
    local_only: true,
    no_network: true,
    dry_run: !options.apply,
    database_path: getDatabasePath(),
    before,
    after,
    actions,
  };
}

export function renderScalePerformanceReportMarkdown(report: ScalePerformanceReport): string {
  const lines = [
    "# todos scale hardening report",
    "",
    `Generated: ${report.generated_at}`,
    `Database: ${report.database_path}`,
    `Local only: ${report.local_only ? "yes" : "no"}`,
    "",
    "## Counts",
    "",
    `- Tasks: ${formatNumber(report.counts.tasks)} (${formatNumber(report.counts.archived_tasks)} archived)`,
    `- Projects: ${formatNumber(report.counts.projects)}`,
    `- Agents: ${formatNumber(report.counts.agents)}`,
    `- Plans: ${formatNumber(report.counts.plans)}`,
    `- Runs: ${formatNumber(report.counts.runs)} with ${formatNumber(report.counts.run_events)} events`,
    `- Comments: ${formatNumber(report.counts.comments)}`,
    `- Dependencies: ${formatNumber(report.counts.dependencies)}`,
    "",
    "## Benchmarks",
    "",
    "| Query | Rows | Time | Threshold | Status |",
    "| --- | ---: | ---: | ---: | --- |",
    ...report.benchmarks.map(item => `| ${item.name} | ${formatNumber(item.rows)} | ${formatMs(item.elapsed_ms)} | ${formatMs(item.threshold_ms)} | ${item.ok ? "ok" : "slow"} |`),
    "",
    "## Archive Readiness",
    "",
    `- Terminal unarchived tasks: ${formatNumber(report.archive.terminal_unarchived_tasks)}`,
    `- Older than ${report.archive.older_than_days} days: ${formatNumber(report.archive.older_terminal_unarchived_tasks)}`,
    `- Include-archived listing exposes archived tasks: ${report.archive.archived_tasks_visible_with_include_archived ? "yes" : "no"}`,
    "",
    "## Compaction",
    "",
    `- Pages: ${formatNumber(report.compaction.page_count)}`,
    `- Free pages: ${formatNumber(report.compaction.freelist_count)} (${Math.round(report.compaction.freelist_ratio * 100)}%)`,
    `- Maintenance recommended: ${report.compaction.recommended ? "yes" : "no"}`,
    `- Commands: ${report.compaction.commands.map(command => `\`${command}\``).join(", ")}`,
    "",
    "## Integrity",
    "",
    `- Quick check: ${report.integrity.quick_check}`,
    `- Foreign key violations: ${formatNumber(report.integrity.foreign_key_violations)}`,
    `- Missing indexes: ${report.integrity.missing_indexes.length === 0 ? "none" : report.integrity.missing_indexes.join(", ")}`,
    `- Overall: ${report.integrity.ok ? "ok" : "needs attention"}`,
  ];

  if (report.warnings.length > 0) {
    lines.push("", "## Warnings", "", ...report.warnings.map(warning => `- ${warning}`));
  }

  return `${lines.join("\n")}\n`;
}
