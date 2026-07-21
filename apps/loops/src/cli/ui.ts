import type { Loop, LoopRun, LoopTarget, ScheduleSpec } from "../types.js";
import { Store } from "../lib/store.js";

const CLEAR_SCREEN = "\x1b[2J\x1b[H";
const ENTER_ALT_SCREEN = "\x1b[?1049h";
const EXIT_ALT_SCREEN = "\x1b[?1049l";
const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const MAGENTA = "\x1b[35m";

const DEFAULT_REFRESH_MS = 2_000;
const MIN_REFRESH_MS = 500;
const MAX_ACTIVE_LOOPS = 10_000;
const MAX_RUNNING_RUNS = 100_000;

export interface LoopUiRow {
  id: string;
  name: string;
  status: Loop["status"];
  cadence: string;
  nextRun: string;
  lastRunOutcome: string;
  provider: string;
  activeRuns: number;
}

export interface LoopUiStats {
  activeLoops: number;
  pausedLoops: number;
  stoppedLoops: number;
  runningRuns: number;
  failedRuns: number;
  updatedAt: string;
}

export interface LoopUiSnapshot {
  rows: LoopUiRow[];
  stats: LoopUiStats;
}

export interface BuildLoopUiSnapshotOptions {
  now?: Date;
  limit?: number;
}

export interface RenderLoopUiFrameOptions {
  columns?: number;
  rows?: number;
  now?: Date;
  refreshMs?: number;
  color?: boolean;
}

export interface RunLoopsUiAppOptions {
  refreshMs?: number;
  input?: NodeJS.ReadStream;
  output?: NodeJS.WriteStream;
  storeFactory?: () => Store;
}

export function buildLoopUiSnapshot(store: Store, opts: BuildLoopUiSnapshotOptions = {}): LoopUiSnapshot {
  const now = opts.now ?? new Date();
  const activeLoops = store.listLoops({ status: "active", limit: opts.limit ?? MAX_ACTIVE_LOOPS });
  const runningRuns = store.listRuns({ status: "running", limit: MAX_RUNNING_RUNS });
  const runningByLoop = new Map<string, number>();
  for (const run of runningRuns) {
    runningByLoop.set(run.loopId, (runningByLoop.get(run.loopId) ?? 0) + 1);
  }

  return {
    rows: activeLoops.map((loop) => {
      const latest = store.listRuns({ loopId: loop.id, limit: 1 })[0];
      return {
        id: loop.id,
        name: loop.name,
        status: loop.status,
        cadence: scheduleLabel(loop.schedule),
        nextRun: nextRunLabel(loop.nextRunAt, now),
        lastRunOutcome: runOutcomeLabel(latest),
        provider: providerLabel(loop.target),
        activeRuns: runningByLoop.get(loop.id) ?? 0,
      };
    }),
    stats: {
      activeLoops: store.countLoops("active"),
      pausedLoops: store.countLoops("paused"),
      stoppedLoops: store.countLoops("stopped"),
      runningRuns: store.countRuns("running"),
      failedRuns: store.countRuns("failed"),
      updatedAt: now.toISOString(),
    },
  };
}

export function renderLoopUiFrame(snapshot: LoopUiSnapshot, opts: RenderLoopUiFrameOptions = {}): string {
  const columns = Math.max(40, opts.columns ?? 100);
  const rows = opts.rows ?? snapshot.rows.length + 8;
  const refreshMs = opts.refreshMs ?? DEFAULT_REFRESH_MS;
  const color = opts.color ?? false;
  const compact = columns < 88;
  const widths = tableWidths(columns, compact);
  const maxBodyRows = Math.max(0, rows - 7);
  const shownRows = snapshot.rows.slice(0, maxBodyRows);
  const hidden = snapshot.rows.length - shownRows.length;
  const updated = timeOnly(snapshot.stats.updatedAt);
  const statLine = [
    `active loops ${snapshot.stats.activeLoops}`,
    `running runs ${snapshot.stats.runningRuns}`,
    `failed runs ${snapshot.stats.failedRuns}`,
    `paused ${snapshot.stats.pausedLoops}`,
    `refresh ${durationLabel(refreshMs) || `${refreshMs}ms`}`,
    `updated ${updated}`,
  ].join(" | ");

  const lines = [
    paint(`Loops`, `${BOLD}${CYAN}`, color) + paint(" live loops", DIM, color),
    paint(fitLine(statLine, columns), DIM, color),
    "",
    paint(tableHeader(widths, compact), `${BOLD}${CYAN}`, color),
    paint("-".repeat(Math.min(columns, tableWidth(widths))), DIM, color),
  ];

  for (const row of shownRows) {
    lines.push(tableRow(row, widths, color));
  }

  if (snapshot.rows.length === 0) {
    lines.push(paint("No active loops.", DIM, color));
  } else if (hidden > 0) {
    lines.push(paint(`showing ${shownRows.length} of ${snapshot.rows.length} active loops`, DIM, color));
  }

  lines.push("");
  lines.push(paint("q quit | Ctrl-C exit", DIM, color));
  return `${lines.map((line) => fitLine(line, columns, color)).join("\n")}\n`;
}

export async function runLoopsUiApp(opts: RunLoopsUiAppOptions = {}): Promise<void> {
  const refreshMs = Math.max(MIN_REFRESH_MS, opts.refreshMs ?? DEFAULT_REFRESH_MS);
  const input = opts.input ?? process.stdin;
  const output = opts.output ?? process.stdout;
  const storeFactory = opts.storeFactory ?? (() => new Store());
  const rawInput = input as NodeJS.ReadStream & { setRawMode?: (mode: boolean) => void };
  const signalExitCodes: Partial<Record<NodeJS.Signals, number>> = { SIGINT: 130, SIGTERM: 143 };
  const signalHandlers: Array<[NodeJS.Signals, () => void]> = [];
  let interval: ReturnType<typeof setInterval> | undefined;
  let closed = false;
  let cleaned = false;
  let rawModeEnabled = false;
  let terminalEntered = false;
  let store: Store | undefined;
  let stopApp: (() => void) | undefined;
  let renderHandler: (() => void) | undefined;

  const render = () => {
    if (closed || !store) return;
    const snapshot = buildLoopUiSnapshot(store);
    output.write(`${CLEAR_SCREEN}${renderLoopUiFrame(snapshot, {
      columns: output.columns,
      rows: output.rows,
      refreshMs,
      color: true,
    })}`);
  };

  const onData = (chunk: Buffer) => {
    const value = chunk.toString("utf8");
    if (value.toLowerCase().includes("q") || value.includes("\u0003") || value.includes("\u001b")) stopApp?.();
  };

  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    if (interval) clearInterval(interval);
    input.off("data", onData);
    if (renderHandler) output.off("resize", renderHandler);
    for (const [signal, handler] of signalHandlers) process.removeListener(signal, handler);
    if (rawModeEnabled) rawInput.setRawMode?.(false);
    if (terminalEntered) {
      try {
        output.write(`${SHOW_CURSOR}${CLEAR_SCREEN}${EXIT_ALT_SCREEN}`);
      } catch {
        /* terminal restore is best-effort after write failures */
      }
    }
    try {
      store?.close();
    } catch {
      /* closing an already-failed store should not hide the original error */
    }
  };

  try {
    store = storeFactory();
    output.write(`${ENTER_ALT_SCREEN}${HIDE_CURSOR}${CLEAR_SCREEN}`);
    terminalEntered = true;
    await new Promise<void>((resolve, reject) => {
      const fail = (error: unknown) => {
        if (closed) return;
        closed = true;
        cleanup();
        reject(error);
      };
      const stop = () => {
        if (closed) return;
        closed = true;
        cleanup();
        resolve();
      };
      const safeRender = () => {
        try {
          render();
        } catch (error) {
          fail(error);
        }
      };
      stopApp = stop;
      renderHandler = safeRender;
      for (const signal of ["SIGINT", "SIGTERM"] as const) {
        const handler = () => {
          process.exitCode = signalExitCodes[signal] ?? 1;
          stop();
        };
        signalHandlers.push([signal, handler]);
        process.once(signal, handler);
      }
      if (typeof rawInput.setRawMode === "function") {
        rawInput.setRawMode(true);
        rawModeEnabled = true;
      }
      input.resume();
      input.on("data", onData);
      output.on("resize", safeRender);
      safeRender();
      if (!closed) interval = setInterval(safeRender, refreshMs);
    });
  } finally {
    cleanup();
  }
}

function tableWidths(columns: number, compact: boolean): Record<keyof Omit<LoopUiRow, "id">, number> {
  const widths = {
    name: 20,
    status: compact ? 6 : 7,
    cadence: compact ? 10 : 14,
    nextRun: compact ? 8 : 10,
    lastRunOutcome: compact ? 8 : 11,
    provider: compact ? 7 : 10,
    activeRuns: compact ? 3 : 11,
  };
  const fixed = widths.status + widths.cadence + widths.nextRun + widths.lastRunOutcome + widths.provider + widths.activeRuns + 12;
  widths.name = Math.max(6, columns - fixed);
  return widths;
}

function tableWidth(widths: Record<keyof Omit<LoopUiRow, "id">, number>): number {
  return widths.name + widths.status + widths.cadence + widths.nextRun + widths.lastRunOutcome + widths.provider + widths.activeRuns + 12;
}

function tableHeader(widths: Record<keyof Omit<LoopUiRow, "id">, number>, compact: boolean): string {
  return [
    cell("NAME", widths.name),
    cell("STATUS", widths.status),
    cell("CADENCE", widths.cadence),
    cell("NEXT-RUN", widths.nextRun),
    cell("LAST-RUN", widths.lastRunOutcome),
    cell("PROVIDER", widths.provider),
    cell(compact ? "RUN" : "ACTIVE-RUNS", widths.activeRuns, "right"),
  ].join("  ");
}

function tableRow(row: LoopUiRow, widths: Record<keyof Omit<LoopUiRow, "id">, number>, color: boolean): string {
  return [
    cell(row.name, widths.name),
    paint(cell(row.status, widths.status), statusColor(row.status), color),
    cell(row.cadence, widths.cadence),
    cell(row.nextRun, widths.nextRun),
    paint(cell(row.lastRunOutcome, widths.lastRunOutcome), outcomeColor(row.lastRunOutcome), color),
    cell(row.provider, widths.provider),
    cell(String(row.activeRuns), widths.activeRuns, "right"),
  ].join("  ");
}

function cell(value: string, width: number, align: "left" | "right" = "left"): string {
  const clipped = clip(value, width);
  return align === "right" ? clipped.padStart(width) : clipped.padEnd(width);
}

function clip(value: string, width: number): string {
  if (width <= 0) return "";
  if (value.length <= width) return value;
  if (width === 1) return "~";
  return `${value.slice(0, width - 1)}~`;
}

function fitLine(value: string, columns: number, hasAnsi = false): string {
  if (!hasAnsi) return clip(value, columns).trimEnd();
  let visible = 0;
  let index = 0;
  let out = "";
  while (index < value.length) {
    const char = value[index];
    if (char === "\x1b" && value[index + 1] === "[") {
      let end = index + 2;
      while (end < value.length && !/[A-Za-z]/.test(value[end]!)) end += 1;
      out += value.slice(index, Math.min(end + 1, value.length));
      index = end + 1;
      continue;
    }
    if (visible < columns) {
      out += char;
      visible += 1;
    }
    index += 1;
  }
  return out;
}

function paint(value: string, code: string, enabled: boolean): string {
  return enabled ? `${code}${value}${RESET}` : value;
}

function statusColor(status: Loop["status"]): string {
  if (status === "active") return GREEN;
  if (status === "paused") return YELLOW;
  if (status === "expired") return MAGENTA;
  return DIM;
}

function outcomeColor(outcome: string): string {
  if (outcome.startsWith("succeeded")) return GREEN;
  if (outcome.startsWith("running")) return CYAN;
  if (outcome.startsWith("failed") || outcome.startsWith("timed_out") || outcome.startsWith("abandoned")) return RED;
  if (outcome.startsWith("skipped")) return YELLOW;
  return DIM;
}

function runOutcomeLabel(run: LoopRun | undefined): string {
  if (!run) return "-";
  if (run.status === "failed" && run.exitCode !== undefined) return `failed(${run.exitCode})`;
  return run.status;
}

function providerLabel(target: LoopTarget): string {
  if (target.type === "command") return "command";
  if (target.type === "agent") return target.provider;
  return "workflow";
}

function scheduleLabel(schedule: ScheduleSpec): string {
  if (schedule.type === "once") return "once";
  if (schedule.type === "interval") return `every:${durationLabel(schedule.everyMs) || `${schedule.everyMs}ms`}`;
  if (schedule.type === "cron") return `cron:${schedule.expression}`;
  return schedule.minIntervalMs ? `dynamic:${durationLabel(schedule.minIntervalMs) || `${schedule.minIntervalMs}ms`}` : "dynamic";
}

function nextRunLabel(nextRunAt: string | undefined, now: Date): string {
  if (!nextRunAt) return "-";
  const date = new Date(nextRunAt);
  if (Number.isNaN(date.getTime())) return "invalid";
  return relativeTime(date.getTime() - now.getTime());
}

function relativeTime(deltaMs: number): string {
  const past = deltaMs < 0;
  const abs = Math.abs(deltaMs);
  const value = durationLabel(abs);
  if (!value || value === "0ms") return "now";
  return past ? `${value} ago` : `in ${value}`;
}

function durationLabel(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms)) return "";
  if (ms < 1_000) return `${Math.max(0, Math.round(ms))}ms`;
  const units: Array<[number, string]> = [
    [7 * 24 * 60 * 60 * 1000, "w"],
    [24 * 60 * 60 * 1000, "d"],
    [60 * 60 * 1000, "h"],
    [60 * 1000, "m"],
    [1_000, "s"],
  ];
  for (const [unitMs, label] of units) {
    const value = ms / unitMs;
    if (value >= 1) return `${Math.round(value)}${label}`;
  }
  return `${ms}ms`;
}

function timeOnly(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString().slice(11, 19);
}
