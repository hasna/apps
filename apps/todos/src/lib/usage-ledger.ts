import type { Database, SQLQueryBindings } from "bun:sqlite";
import { getDatabase } from "../db/database.js";

export const LOCAL_USAGE_LEDGER_SCHEMA_VERSION = 1;

export interface UsageLedgerQuotaInput {
  max_tasks?: number;
  max_projects?: number;
  max_runs?: number;
  max_commands?: number;
  max_tokens?: number;
  max_cost_usd?: number;
  max_storage_bytes?: number;
}

export interface UsageLedgerOptions {
  project_id?: string;
  agent_id?: string;
  since?: string;
  until?: string;
  generated_at?: string;
  quotas?: UsageLedgerQuotaInput;
}

export interface UsageLedgerQuotaResult {
  name: keyof UsageLedgerQuotaInput;
  limit: number;
  used: number;
  remaining: number;
  exceeded: boolean;
}

export interface UsageLedgerReport {
  schema_version: number;
  local_only: true;
  no_network: true;
  generated_at: string;
  scope: {
    project_id: string | null;
    agent_id: string | null;
    since: string | null;
    until: string | null;
  };
  counts: {
    tasks: number;
    projects: number;
    runs: number;
    commands: number;
    artifacts: number;
    traces: number;
    metadata_records: number;
  };
  durations: {
    completed_run_ms: number;
    open_run_ms: number;
    trace_ms: number;
    total_observed_ms: number;
  };
  usage: {
    task_tokens: number;
    trace_tokens: number;
    metadata_tokens: number;
    total_tokens: number;
    task_cost_usd: number;
    trace_cost_usd: number;
    metadata_cost_usd: number;
    total_cost_usd: number;
  };
  storage: {
    artifact_bytes: number;
    evidence_bytes: number;
  };
  quota: {
    simulated: boolean;
    limits: UsageLedgerQuotaResult[];
    exceeded: string[];
    allowed: boolean;
  };
  redaction: {
    raw_commands_included: false;
    raw_artifact_paths_included: false;
    aggregate_only: true;
  };
  sources: string[];
}

interface NumericUsage {
  tokens: number;
  cost_usd: number;
  duration_ms: number;
  records: number;
}

function numberValue(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function sumDirectNumber(record: Record<string, unknown>, keys: string[]): number {
  let value = 0;
  for (const [rawKey, rawValue] of Object.entries(record)) {
    const key = rawKey.toLowerCase();
    if (keys.includes(key)) value += Math.max(0, numberValue(rawValue));
  }
  return value;
}

function maxDirectNumber(record: Record<string, unknown>, keys: string[]): number {
  let value = 0;
  for (const [rawKey, rawValue] of Object.entries(record)) {
    const key = rawKey.toLowerCase();
    if (keys.includes(key)) value = Math.max(value, numberValue(rawValue));
  }
  return Math.max(0, value);
}

function extractUsage(value: unknown): NumericUsage {
  if (!value || typeof value !== "object") return { tokens: 0, cost_usd: 0, duration_ms: 0, records: 0 };
  if (Array.isArray(value)) {
    return value.reduce<NumericUsage>((acc, item) => {
      const usage = extractUsage(item);
      acc.tokens += usage.tokens;
      acc.cost_usd += usage.cost_usd;
      acc.duration_ms += usage.duration_ms;
      acc.records += usage.records;
      return acc;
    }, { tokens: 0, cost_usd: 0, duration_ms: 0, records: 0 });
  }

  const record = value as Record<string, unknown>;
  const explicitTokens = maxDirectNumber(record, ["tokens", "total_tokens", "token_count"]);
  const splitTokens = sumDirectNumber(record, ["input_tokens", "output_tokens", "prompt_tokens", "completion_tokens"]);
  const cost = maxDirectNumber(record, ["cost_usd", "usd", "price_usd", "amount_usd", "cost"]);
  const duration = maxDirectNumber(record, ["duration_ms", "elapsed_ms", "latency_ms"]);
  const own: NumericUsage = {
    tokens: explicitTokens || splitTokens,
    cost_usd: cost,
    duration_ms: duration,
    records: explicitTokens || splitTokens || cost || duration ? 1 : 0,
  };

  for (const [key, child] of Object.entries(record)) {
    if (["tokens", "total_tokens", "token_count", "input_tokens", "output_tokens", "prompt_tokens", "completion_tokens", "cost_usd", "usd", "price_usd", "amount_usd", "cost", "duration_ms", "elapsed_ms", "latency_ms"].includes(key.toLowerCase())) {
      continue;
    }
    const nested = extractUsage(child);
    own.tokens += nested.tokens;
    own.cost_usd += nested.cost_usd;
    own.duration_ms += nested.duration_ms;
    own.records += nested.records;
  }
  return own;
}

function parseJsonObject(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function millisBetween(start: string | null, end: string | null): number {
  if (!start || !end) return 0;
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return 0;
  return endMs - startMs;
}

function addTaskScope(where: string[], params: SQLQueryBindings[], options: UsageLedgerOptions, alias = "t"): void {
  if (options.project_id) {
    where.push(`${alias}.project_id = ?`);
    params.push(options.project_id);
  }
  if (options.agent_id) {
    where.push(`(${alias}.agent_id = ? OR ${alias}.assigned_to = ?)`);
    params.push(options.agent_id, options.agent_id);
  }
  if (options.since) {
    where.push(`${alias}.created_at >= ?`);
    params.push(options.since);
  }
  if (options.until) {
    where.push(`${alias}.created_at <= ?`);
    params.push(options.until);
  }
}

function addRunScope(where: string[], params: SQLQueryBindings[], options: UsageLedgerOptions, runAlias = "r", taskAlias = "t"): void {
  if (options.project_id) {
    where.push(`${taskAlias}.project_id = ?`);
    params.push(options.project_id);
  }
  if (options.agent_id) {
    where.push(`(${runAlias}.agent_id = ? OR ${taskAlias}.agent_id = ? OR ${taskAlias}.assigned_to = ?)`);
    params.push(options.agent_id, options.agent_id, options.agent_id);
  }
  if (options.since) {
    where.push(`${runAlias}.started_at >= ?`);
    params.push(options.since);
  }
  if (options.until) {
    where.push(`${runAlias}.started_at <= ?`);
    params.push(options.until);
  }
}

function addTraceScope(where: string[], params: SQLQueryBindings[], options: UsageLedgerOptions, traceAlias = "tr", taskAlias = "t"): void {
  if (options.project_id) {
    where.push(`${taskAlias}.project_id = ?`);
    params.push(options.project_id);
  }
  if (options.agent_id) {
    where.push(`(${traceAlias}.agent_id = ? OR ${taskAlias}.agent_id = ? OR ${taskAlias}.assigned_to = ?)`);
    params.push(options.agent_id, options.agent_id, options.agent_id);
  }
  if (options.since) {
    where.push(`${traceAlias}.created_at >= ?`);
    params.push(options.since);
  }
  if (options.until) {
    where.push(`${traceAlias}.created_at <= ?`);
    params.push(options.until);
  }
}

function queryOne<T>(db: Database, sql: string, params: SQLQueryBindings[]): T {
  return db.query(sql).get(...params) as T;
}

function queryAll<T>(db: Database, sql: string, params: SQLQueryBindings[]): T[] {
  return db.query(sql).all(...params) as T[];
}

function rounded(value: number, places = 6): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function quotaLimit(
  name: keyof UsageLedgerQuotaInput,
  limit: number | undefined,
  used: number,
): UsageLedgerQuotaResult | null {
  if (limit === undefined || !Number.isFinite(limit) || limit < 0) return null;
  const normalized = name === "max_cost_usd" ? rounded(limit) : Math.floor(limit);
  const roundedUsed = name === "max_cost_usd" ? rounded(used) : Math.floor(used);
  return {
    name,
    limit: normalized,
    used: roundedUsed,
    remaining: rounded(normalized - roundedUsed),
    exceeded: roundedUsed > normalized,
  };
}

function buildQuota(options: UsageLedgerOptions, report: Omit<UsageLedgerReport, "quota">): UsageLedgerReport["quota"] {
  const quotas = options.quotas || {};
  const limits = [
    quotaLimit("max_tasks", quotas.max_tasks, report.counts.tasks),
    quotaLimit("max_projects", quotas.max_projects, report.counts.projects),
    quotaLimit("max_runs", quotas.max_runs, report.counts.runs),
    quotaLimit("max_commands", quotas.max_commands, report.counts.commands),
    quotaLimit("max_tokens", quotas.max_tokens, report.usage.total_tokens),
    quotaLimit("max_cost_usd", quotas.max_cost_usd, report.usage.total_cost_usd),
    quotaLimit("max_storage_bytes", quotas.max_storage_bytes, report.storage.evidence_bytes),
  ].filter((item): item is UsageLedgerQuotaResult => Boolean(item));
  const exceeded = limits.filter((item) => item.exceeded).map((item) => item.name);
  return {
    simulated: limits.length > 0,
    limits,
    exceeded,
    allowed: exceeded.length === 0,
  };
}

export function createLocalUsageLedger(options: UsageLedgerOptions = {}, db?: Database): UsageLedgerReport {
  const d = getDatabase(db);
  const generatedAt = options.generated_at || new Date().toISOString();

  const taskWhere: string[] = [];
  const taskParams: SQLQueryBindings[] = [];
  addTaskScope(taskWhere, taskParams, options);
  const taskClause = taskWhere.length ? `WHERE ${taskWhere.join(" AND ")}` : "";

  const taskTotals = queryOne<{ tasks: number; task_tokens: number | null; task_cost_usd: number | null }>(
    d,
    `SELECT COUNT(*) as tasks, COALESCE(SUM(cost_tokens), 0) as task_tokens, COALESCE(SUM(cost_usd), 0) as task_cost_usd FROM tasks t ${taskClause}`,
    taskParams,
  );

  let projectCount = 0;
  if (options.project_id) {
    projectCount = queryOne<{ count: number }>(d, "SELECT COUNT(*) as count FROM projects WHERE id = ?", [options.project_id]).count;
  } else if (options.agent_id) {
    const projectWhere: string[] = ["t.project_id IS NOT NULL"];
    const projectParams: SQLQueryBindings[] = [];
    addTaskScope(projectWhere, projectParams, options);
    projectCount = queryOne<{ count: number }>(
      d,
      `SELECT COUNT(DISTINCT t.project_id) as count FROM tasks t WHERE ${projectWhere.join(" AND ")}`,
      projectParams,
    ).count;
  } else {
    projectCount = queryOne<{ count: number }>(d, "SELECT COUNT(*) as count FROM projects", []).count;
  }

  const runWhere: string[] = [];
  const runParams: SQLQueryBindings[] = [];
  addRunScope(runWhere, runParams, options);
  const runClause = runWhere.length ? `WHERE ${runWhere.join(" AND ")}` : "";
  const runs = queryAll<{ id: string; started_at: string; completed_at: string | null; metadata: string | null }>(
    d,
    `SELECT r.id, r.started_at, r.completed_at, r.metadata
       FROM task_runs r JOIN tasks t ON t.id = r.task_id
       ${runClause}`,
    runParams,
  );

  const commandTotals = queryOne<{ commands: number }>(
    d,
    `SELECT COUNT(*) as commands
       FROM task_run_commands c
       JOIN task_runs r ON r.id = c.run_id
       JOIN tasks t ON t.id = c.task_id
       ${runClause}`,
    runParams,
  );

  const artifactTotals = queryOne<{ artifacts: number; bytes: number | null }>(
    d,
    `SELECT COUNT(*) as artifacts, COALESCE(SUM(a.size_bytes), 0) as bytes
       FROM task_run_artifacts a
       JOIN task_runs r ON r.id = a.run_id
       JOIN tasks t ON t.id = a.task_id
       ${runClause}`,
    runParams,
  );

  const traceWhere: string[] = [];
  const traceParams: SQLQueryBindings[] = [];
  addTraceScope(traceWhere, traceParams, options);
  const traceClause = traceWhere.length ? `WHERE ${traceWhere.join(" AND ")}` : "";
  const traceTotals = queryOne<{ traces: number; tokens: number | null; cost_usd: number | null; duration_ms: number | null }>(
    d,
    `SELECT COUNT(*) as traces,
            COALESCE(SUM(tr.tokens), 0) as tokens,
            COALESCE(SUM(tr.cost_usd), 0) as cost_usd,
            COALESCE(SUM(tr.duration_ms), 0) as duration_ms
       FROM task_traces tr
       JOIN tasks t ON t.id = tr.task_id
       ${traceClause}`,
    traceParams,
  );

  let completedRunMs = 0;
  let openRunMs = 0;
  let metadataUsage: NumericUsage = { tokens: 0, cost_usd: 0, duration_ms: 0, records: 0 };
  for (const run of runs) {
    if (run.completed_at) completedRunMs += millisBetween(run.started_at, run.completed_at);
    else openRunMs += millisBetween(run.started_at, generatedAt);
    const usage = extractUsage(parseJsonObject(run.metadata));
    metadataUsage.tokens += usage.tokens;
    metadataUsage.cost_usd += usage.cost_usd;
    metadataUsage.duration_ms += usage.duration_ms;
    metadataUsage.records += usage.records;
  }

  const eventRows = queryAll<{ data: string | null }>(
    d,
    `SELECT e.data
       FROM task_run_events e
       JOIN task_runs r ON r.id = e.run_id
       JOIN tasks t ON t.id = e.task_id
       ${runClause}`,
    runParams,
  );
  for (const event of eventRows) {
    const usage = extractUsage(parseJsonObject(event.data));
    metadataUsage.tokens += usage.tokens;
    metadataUsage.cost_usd += usage.cost_usd;
    metadataUsage.duration_ms += usage.duration_ms;
    metadataUsage.records += usage.records;
  }

  const taskTokens = Number(taskTotals.task_tokens || 0);
  const traceTokens = Number(traceTotals.tokens || 0);
  const metadataTokens = metadataUsage.tokens;
  const taskCost = Number(taskTotals.task_cost_usd || 0);
  const traceCost = Number(traceTotals.cost_usd || 0);
  const metadataCost = metadataUsage.cost_usd;
  const traceMs = Number(traceTotals.duration_ms || 0);

  const baseReport = {
    schema_version: LOCAL_USAGE_LEDGER_SCHEMA_VERSION,
    local_only: true as const,
    no_network: true as const,
    generated_at: generatedAt,
    scope: {
      project_id: options.project_id || null,
      agent_id: options.agent_id || null,
      since: options.since || null,
      until: options.until || null,
    },
    counts: {
      tasks: Number(taskTotals.tasks || 0),
      projects: Number(projectCount || 0),
      runs: runs.length,
      commands: Number(commandTotals.commands || 0),
      artifacts: Number(artifactTotals.artifacts || 0),
      traces: Number(traceTotals.traces || 0),
      metadata_records: metadataUsage.records,
    },
    durations: {
      completed_run_ms: completedRunMs,
      open_run_ms: openRunMs,
      trace_ms: traceMs,
      total_observed_ms: completedRunMs + openRunMs + traceMs + metadataUsage.duration_ms,
    },
    usage: {
      task_tokens: taskTokens,
      trace_tokens: traceTokens,
      metadata_tokens: metadataTokens,
      total_tokens: taskTokens + traceTokens + metadataTokens,
      task_cost_usd: rounded(taskCost),
      trace_cost_usd: rounded(traceCost),
      metadata_cost_usd: rounded(metadataCost),
      total_cost_usd: rounded(taskCost + traceCost + metadataCost),
    },
    storage: {
      artifact_bytes: Number(artifactTotals.bytes || 0),
      evidence_bytes: Number(artifactTotals.bytes || 0),
    },
    redaction: {
      raw_commands_included: false as const,
      raw_artifact_paths_included: false as const,
      aggregate_only: true as const,
    },
    sources: ["tasks", "projects", "task_runs", "task_run_commands", "task_run_artifacts", "task_run_events", "task_traces"],
  };

  return {
    ...baseReport,
    quota: buildQuota(options, baseReport),
  };
}

export function renderLocalUsageLedgerMarkdown(report: UsageLedgerReport): string {
  const minutes = (report.durations.total_observed_ms / 60_000).toFixed(1);
  const lines = [
    "# Local Usage Ledger",
    "",
    `Generated: ${report.generated_at}`,
    `Scope: project=${report.scope.project_id || "all"} agent=${report.scope.agent_id || "all"}`,
    "",
    "## Counts",
    `- Tasks: ${report.counts.tasks}`,
    `- Projects: ${report.counts.projects}`,
    `- Runs: ${report.counts.runs}`,
    `- Commands: ${report.counts.commands}`,
    `- Artifacts: ${report.counts.artifacts}`,
    `- Traces: ${report.counts.traces}`,
    "",
    "## Usage",
    `- Tokens: ${report.usage.total_tokens}`,
    `- Cost USD: ${report.usage.total_cost_usd}`,
    `- Observed duration minutes: ${minutes}`,
    `- Evidence bytes: ${report.storage.evidence_bytes}`,
    "",
    "## Quota",
  ];
  if (!report.quota.simulated) {
    lines.push("- No local quota limits supplied.");
  } else {
    for (const limit of report.quota.limits) {
      lines.push(`- ${limit.name}: ${limit.used}/${limit.limit}${limit.exceeded ? " exceeded" : ""}`);
    }
    lines.push(`- Allowed: ${report.quota.allowed ? "yes" : "no"}`);
  }
  lines.push("", "Raw commands and artifact paths are not included in this aggregate report.");
  return lines.join("\n");
}
