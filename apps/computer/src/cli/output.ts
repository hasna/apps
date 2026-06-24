import type { ActionLog, DriverAction, Session } from "../types/index.js";

export const DEFAULT_ROW_LIMIT = 10;
export const DEFAULT_DETAIL_LOG_LIMIT = 10;
export const MAX_ROW_LIMIT = 50;
export const MAX_TEXT_LENGTH = 120;

export interface PageOptions {
  limit: number;
  cursor: number;
  hasMore?: boolean;
  nextCursor?: number;
}

export function parseLimit(value: string | number | undefined, fallback = DEFAULT_ROW_LIMIT, max = MAX_ROW_LIMIT): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.trunc(parsed), max);
}

export function parseCursor(value: string | number | undefined): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.trunc(parsed);
}

export function pageSlice<T>(items: T[], limit: number, cursor = 0): { page: T[]; hasMore: boolean; nextCursor: number } {
  const page = items.slice(0, limit);
  return {
    page,
    hasMore: items.length > limit,
    nextCursor: cursor + page.length,
  };
}

export function truncateText(value: unknown, max = MAX_TEXT_LENGTH): string {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  if (max <= 3) return text.slice(0, max);
  return `${text.slice(0, max - 3)}...`;
}

export function formatCount(value: number | undefined): string {
  const count = value ?? 0;
  if (Math.abs(count) >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}m`;
  if (Math.abs(count) >= 1_000) return `${(count / 1_000).toFixed(1)}k`;
  return String(count);
}

export function formatDuration(ms: number | undefined): string {
  const value = ms ?? 0;
  if (value < 1_000) return `${value}ms`;
  if (value < 60_000) return `${(value / 1_000).toFixed(1)}s`;
  return `${Math.round(value / 60_000)}m`;
}

export function summarizeAction(action: DriverAction | undefined): string {
  if (!action) return "unknown";
  switch (action.type) {
    case "click":
      return `click ${action.point.x},${action.point.y}`;
    case "type":
      return `type ${String(action.text.length)} chars`;
    case "key":
      return `key ${action.keys}`;
    case "scroll":
      return `scroll ${action.deltaY >= 0 ? "down" : "up"}`;
    case "mouse_move":
      return `move ${action.point.x},${action.point.y}`;
    case "drag":
      return `drag ${action.from.x},${action.from.y}->${action.to.x},${action.to.y}`;
    case "wait":
      return `wait ${action.ms}ms`;
    case "open_url":
      return `open_url ${truncateText(action.url, 42)}`;
    case "open_app":
      return `open_app ${truncateText(action.name, 32)}`;
    case "screenshot":
      return "screenshot";
  }
}

export function compactSession(session: Session) {
  return {
    id: session.id,
    short_id: session.id.slice(0, 8),
    status: session.status,
    provider: session.provider,
    model: session.model,
    steps: session.steps,
    tokens: session.total_tokens_in + session.total_tokens_out,
    duration_ms: session.total_duration_ms,
    tags: session.tags ?? [],
    created_at: session.created_at,
    completed_at: session.completed_at ?? null,
    task: truncateText(session.task),
    error: session.error ? truncateText(session.error) : null,
  };
}

export function compactActionLog(log: ActionLog) {
  return {
    step: log.step,
    ok: log.success,
    action: summarizeAction(log.action),
    duration_ms: log.duration_ms,
    tokens: (log.tokens_in ?? 0) + (log.tokens_out ?? 0),
    reasoning: truncateText(log.reasoning, 140),
    error: log.error ? truncateText(log.error, 140) : null,
    screenshot_path: log.screenshot_path ? truncateText(log.screenshot_path, 80) : null,
  };
}

export function renderSessionList(
  sessions: Session[],
  options: PageOptions & {
    title?: string;
    detailHint?: string;
    jsonHint?: string;
  },
): string {
  const lines: string[] = [];
  lines.push(options.title ?? "Sessions");
  if (sessions.length === 0) {
    lines.push("No sessions found.");
    return lines.join("\n");
  }

  lines.push("id       status               provider    steps tokens duration created              task");
  for (const session of sessions) {
    const tokens = formatCount(session.total_tokens_in + session.total_tokens_out).padStart(6);
    const duration = formatDuration(session.total_duration_ms).padStart(8);
    lines.push(
      [
        session.id.slice(0, 8).padEnd(8),
        session.status.padEnd(20),
        session.provider.padEnd(11),
        String(session.steps).padStart(5),
        tokens,
        duration,
        session.created_at.slice(0, 19).padEnd(19),
        truncateText(session.task, 96),
      ].join(" "),
    );
  }

  lines.push(renderPageHint(options));
  lines.push(options.detailHint ?? "Details: use `computer session <id> --verbose` for logs or `--json` for full data.");
  if (options.jsonHint) lines.push(options.jsonHint);
  return lines.join("\n");
}

export function renderSessionDetail(
  session: Session,
  logs: ActionLog[],
  options: {
    verbose?: boolean;
    limit?: number;
    cursor?: number;
    hasMore?: boolean;
    nextCursor?: number;
  } = {},
): string {
  const limit = options.verbose ? logs.length : options.limit ?? DEFAULT_DETAIL_LOG_LIMIT;
  const cursor = options.cursor ?? 0;
  const visible = options.verbose ? logs : logs.slice(cursor, cursor + limit);
  const nextCursor = options.nextCursor ?? cursor + visible.length;
  const hasMore = options.verbose ? false : options.hasMore ?? logs.length > nextCursor;
  const lines: string[] = [];

  lines.push(`Session ${session.id}`);
  lines.push(`Task: ${options.verbose ? session.task : truncateText(session.task, 180)}`);
  lines.push(`Status: ${session.status} | Provider: ${session.provider}/${session.model} | Steps: ${session.steps}`);
  lines.push(`Tokens: ${formatCount(session.total_tokens_in + session.total_tokens_out)} | Duration: ${formatDuration(session.total_duration_ms)} | Created: ${session.created_at}`);
  if (session.tags?.length) lines.push(`Tags: ${session.tags.join(", ")}`);
  if (session.error) lines.push(`Error: ${options.verbose ? session.error : truncateText(session.error, 180)}`);
  if (session.completed_at) lines.push(`Completed: ${session.completed_at}`);
  lines.push("");
  lines.push(`Action log (${visible.length}/${logs.length}${options.verbose ? ", verbose" : ""})`);
  if (visible.length === 0) {
    lines.push("No action logs found.");
  }
  for (const log of visible) {
    const status = log.success ? "OK" : "FAIL";
    const tokens = (log.tokens_in ?? 0) + (log.tokens_out ?? 0);
    lines.push(
      `[${String(log.step + 1).padStart(3)}] ${status.padEnd(4)} ${summarizeAction(log.action).padEnd(24)} ${formatDuration(log.duration_ms).padStart(8)} ${formatCount(tokens).padStart(6)} tokens`,
    );
    if (log.reasoning) {
      lines.push(`      ${options.verbose ? log.reasoning.replace(/\s+/g, " ").trim() : truncateText(log.reasoning, 180)}`);
    }
    if (log.error) lines.push(`      Error: ${options.verbose ? log.error : truncateText(log.error, 180)}`);
  }
  if (hasMore) lines.push(`More logs available: use --cursor ${nextCursor}, --limit ${limit}, or --verbose for all logs.`);
  if (!options.verbose) lines.push("Full machine-readable detail: use `computer session <id> --json`.");
  return lines.join("\n");
}

export function renderSearchResults(
  input: {
    sessions?: Session[];
    actionLogs?: ActionLog[];
  },
  options: PageOptions & { query: string },
): string {
  const sessions = input.sessions ?? [];
  const logs = input.actionLogs ?? [];
  const lines: string[] = [`Search: "${truncateText(options.query, 80)}"`];

  if (sessions.length > 0) {
    lines.push("");
    lines.push("Sessions");
    lines.push("id       status               provider    steps created              task");
    for (const session of sessions) {
      lines.push(
        [
          session.id.slice(0, 8).padEnd(8),
          session.status.padEnd(20),
          session.provider.padEnd(11),
          String(session.steps).padStart(5),
          session.created_at.slice(0, 19).padEnd(19),
          truncateText(session.task, 96),
        ].join(" "),
      );
    }
  }

  if (logs.length > 0) {
    lines.push("");
    lines.push("Action logs");
    lines.push("session  step status action                   reasoning");
    for (const log of logs) {
      lines.push(
        [
          log.session_id.slice(0, 8).padEnd(8),
          String(log.step + 1).padStart(4),
          (log.success ? "OK" : "FAIL").padEnd(6),
          summarizeAction(log.action).padEnd(24),
          truncateText(log.reasoning, 100),
        ].join(" "),
      );
    }
  }

  if (sessions.length === 0 && logs.length === 0) lines.push("No matches found.");
  lines.push(renderPageHint(options));
  lines.push("Details: use `computer session <id> --verbose`; use `--json` for full search results.");
  return lines.join("\n");
}

export function renderStatsSummary(stats: {
  total_sessions: number;
  completed: number;
  failed: number;
  total_steps: number;
  total_tokens: number;
  model_usage: {
    total_tokens: number;
    total_cost_usd: number;
    by_phase: Record<string, { total_tokens: number; cost_usd: number }>;
  };
}): string {
  const lines = [
    "Computer Use Stats",
    `Sessions: ${stats.total_sessions} (${stats.completed} completed, ${stats.failed} failed)`,
    `Steps: ${stats.total_steps}`,
    `Tokens: ${formatCount(stats.total_tokens)}`,
  ];
  if (stats.model_usage.total_tokens > 0) {
    lines.push(`Model usage: ${formatCount(stats.model_usage.total_tokens)} tokens ($${stats.model_usage.total_cost_usd.toFixed(4)})`);
    for (const [phase, usage] of Object.entries(stats.model_usage.by_phase).sort(([a], [b]) => a.localeCompare(b))) {
      lines.push(`  ${phase}: ${formatCount(usage.total_tokens)} tokens ($${usage.cost_usd.toFixed(4)})`);
    }
  }
  return lines.join("\n");
}

function renderPageHint(options: PageOptions): string {
  const base = `Showing ${options.limit} max from cursor ${options.cursor}.`;
  if (!options.hasMore) return base;
  return `${base} More available: use --cursor ${options.nextCursor ?? options.cursor + options.limit}.`;
}
