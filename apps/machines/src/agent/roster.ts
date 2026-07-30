import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { resolve } from "node:path";
import type { Database } from "bun:sqlite";
import { z } from "zod";
import { getDb } from "../db.js";
import {
  ensureParentDir,
  getRosterConfigPath,
  getRosterHeartbeatPath,
  getRosterRecordsPath,
} from "../paths.js";

export const ROSTER_RECORD_SCHEMA_ID = "hasna.roster_record.v1";
export const ROSTER_CONFIG_SCHEMA_ID = "hasna.station_roster.v1";
export const ROSTER_RECONCILE_OPERATION = "roster_reconcile_apply";

const byteLimit = z.string().regex(/^\d+(?:\.\d+)?[KMGT]$/, "must be a systemd byte limit such as 4G");

export const rosterConfigSchema = z.object({
  $schema: z.literal(ROSTER_CONFIG_SCHEMA_ID),
  machineId: z.string().min(1).optional(),
  applyMode: z.enum(["manual", "auto"]),
  tickSeconds: z.number().int().positive(),
  settleSeconds: z.number().nonnegative(),
  batchSize: z.number().int().positive(),
  maxActiveAgents: z.number().int().positive(),
  leaseSeconds: z.number().int().positive(),
  backoff: z.object({
    maxAttempts: z.number().int().positive(),
    windowMinutes: z.number().positive(),
  }),
  gate: z.object({
    minMemAvailableGb: z.number().nonnegative(),
    maxSwapUsedGb: z.number().nonnegative(),
    maxPsiFullAvg60: z.number().nonnegative(),
    maxSwapGrowthGbPerBatch: z.number().nonnegative(),
  }),
  conversations: z.object({
    channel: z.string().min(1),
    bin: z.string().min(1).default("conversations"),
  }),
  todos: z.object({
    project: z.string().min(1),
    taskList: z.string().min(1).optional(),
    bin: z.string().min(1).default("todos"),
  }),
  functionalChecks: z.array(z.enum(["todos", "conversations"])).default(["todos", "conversations"]),
  entries: z.array(z.object({
    id: z.string().min(1),
    target: z.string().regex(/^[^:\s]+:\d+\.\d+$/, "must be a tmux target like agents:0.1"),
    profile: z.string().min(1),
    heartbeatPath: z.string().min(1).optional(),
    heartbeatFreshSeconds: z.number().positive().optional(),
    memoryHigh: byteLimit,
    memoryMax: byteLimit,
    memorySwapMax: byteLimit,
  })).min(1),
  recordsPath: z.string().min(1).optional(),
  heartbeatPath: z.string().min(1).optional(),
}).superRefine((config, context) => {
  if (config.leaseSeconds <= config.settleSeconds) {
    context.addIssue({
      code: "custom",
      path: ["leaseSeconds"],
      message: "must exceed settleSeconds so a batch cannot outlive its SQLite lease",
    });
  }
  const ids = new Set<string>();
  const targets = new Set<string>();
  for (const [index, entry] of config.entries.entries()) {
    if (ids.has(entry.id)) {
      context.addIssue({ code: "custom", path: ["entries", index, "id"], message: "entry ids must be unique" });
    }
    if (targets.has(entry.target)) {
      context.addIssue({ code: "custom", path: ["entries", index, "target"], message: "tmux targets must be unique" });
    }
    ids.add(entry.id);
    targets.add(entry.target);
  }
});

export type RosterConfig = z.infer<typeof rosterConfigSchema>;
export type RosterEntry = RosterConfig["entries"][number];
export type RosterClassification = "steady" | "recovery" | "boot";
export type RosterRunStatus = "succeeded" | "planned" | "blocked" | "failed" | "lease-held";

export interface CommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: string;
}

export type RosterCommandRunner = (command: string, args: string[], timeoutMs?: number) => CommandResult;

export interface HostResourceSample {
  memAvailableGb: number;
  swapUsedGb: number;
  psiFullAvg60: number;
}

export interface RosterGateDecision extends HostResourceSample {
  allowed: boolean;
  swapGrowthGb: number;
  reasons: string[];
  sampledAt: string;
}

export interface TmuxPane {
  target: string;
  session: string;
  dead: boolean;
  currentCommand: string;
  pid: number | null;
  startCommand: string;
}

export interface RosterEntryObservation {
  id: string;
  target: string;
  classification: RosterClassification;
  active: boolean;
  safeToRespawn: boolean;
  pane: TmuxPane | null;
  heartbeatFresh: boolean | null;
  heartbeatAgeMs: number | null;
  hasLaunchRecord: boolean;
  state: "ready" | "missing" | "unsafe" | "crashlooping";
  failedAttempts: number;
  firstMissingAt: number | null;
}

export interface RosterPlanEntry {
  id: string;
  target: string;
  classification: RosterClassification;
  action: "none" | "launch" | "blocked";
  reason: string;
}

export interface RosterRecord {
  schema: typeof ROSTER_RECORD_SCHEMA_ID;
  id: string;
  createdAt: string;
  machine: string;
  classification: RosterClassification;
  result: RosterRunStatus;
  mode: "manual" | "apply" | "auto";
  drillLevel?: string;
  gate: RosterGateDecision;
  plan: RosterPlanEntry[];
  entries: Array<{
    id: string;
    state: RosterEntryObservation["state"];
    classification: RosterClassification;
    attempts: number;
    error?: string;
    mttrMs?: number;
  }>;
  launched: string[];
  crashlooping: string[];
  functionalChecks: Record<string, "ok" | "failed">;
  conversationPosted: boolean;
  mttrMs?: number;
}

export interface RosterRunResult {
  runId: string;
  status: RosterRunStatus;
  mode: "manual" | "apply" | "auto";
  classification: RosterClassification;
  gate: RosterGateDecision | null;
  plan: RosterPlanEntry[];
  observations: RosterEntryObservation[];
  launched: string[];
  crashlooping: string[];
  functionalChecks: Record<string, "ok" | "failed">;
  conversationPosted: boolean;
  heartbeatWritten: boolean;
  record: RosterRecord | null;
  warnings: string[];
}

export interface RosterRunOptions {
  apply?: boolean;
  drillLevel?: string;
  db?: Database;
  runner?: RosterCommandRunner;
  now?: () => Date;
  sleep?: (milliseconds: number) => Promise<void>;
  resourceProbe?: () => HostResourceSample;
  heartbeatStat?: (path: string) => { mtimeMs: number } | null;
  owner?: string;
}

interface StoredEntryState {
  status: string;
  attempts: number[];
  firstMissingAt: number | null;
  lastError: string | null;
}

const IDLE_COMMANDS = new Set(["bash", "dash", "fish", "sh", "zsh"]);
const TMUX_FORMAT = [
  "#{session_name}",
  "#{window_index}",
  "#{pane_index}",
  "#{pane_dead}",
  "#{pane_current_command}",
  "#{pane_pid}",
  "#{pane_start_command}",
].join("\t");

export function readRosterConfig(path = getRosterConfigPath()): RosterConfig {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Unable to read roster config ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const parsed = rosterConfigSchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`Invalid roster config ${path}: ${issue?.path.join(".") || "root"}: ${issue?.message || "unknown error"}`);
  }
  return parsed.data;
}

export function defaultRosterCommandRunner(command: string, args: string[], timeoutMs = 30_000): CommandResult {
  const child = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    timeout: timeoutMs,
  });
  return {
    status: child.status,
    stdout: child.stdout ?? "",
    stderr: child.stderr ?? "",
    error: child.error?.message,
  };
}

export function parseTmuxPanes(output: string): TmuxPane[] {
  const panes: TmuxPane[] = [];
  for (const raw of output.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const [session, window, pane, dead, currentCommand, pid, ...startParts] = raw.split("\t");
    if (!session || window === undefined || pane === undefined) continue;
    panes.push({
      target: `${session}:${window}.${pane}`,
      session,
      dead: dead === "1",
      currentCommand: currentCommand ?? "",
      pid: /^\d+$/.test(pid ?? "") ? Number(pid) : null,
      startCommand: startParts.join("\t"),
    });
  }
  return panes;
}

function readProcNumber(line: string | undefined): number {
  const match = line?.match(/:\s*(\d+)\s+kB/i);
  return match ? Number(match[1]) : 0;
}

/** Read only live kernel counters; the controller never gates from a saved snapshot. */
export function probeHostResources(
  readText: (path: string) => string = (path) => readFileSync(path, "utf8"),
): HostResourceSample {
  const memory = readText("/proc/meminfo").split(/\r?\n/);
  const byName = new Map(memory.map((line) => [line.split(":", 1)[0], line]));
  const availableKb = readProcNumber(byName.get("MemAvailable"));
  const swapTotalKb = readProcNumber(byName.get("SwapTotal"));
  const swapFreeKb = readProcNumber(byName.get("SwapFree"));
  const pressure = readText("/proc/pressure/memory");
  const fullLine = pressure.split(/\r?\n/).find((line) => line.startsWith("full "));
  const psiMatch = fullLine?.match(/\bavg60=([0-9.]+)/);
  return {
    memAvailableGb: availableKb / 1024 / 1024,
    swapUsedGb: Math.max(0, swapTotalKb - swapFreeKb) / 1024 / 1024,
    psiFullAvg60: psiMatch ? Number(psiMatch[1]) : 0,
  };
}

export function evaluateRosterGate(
  sample: HostResourceSample,
  thresholds: RosterConfig["gate"],
  previousSwapUsedGb: number | null,
  sampledAt = new Date().toISOString(),
): RosterGateDecision {
  const swapGrowthGb = previousSwapUsedGb === null ? 0 : Math.max(0, sample.swapUsedGb - previousSwapUsedGb);
  const reasons: string[] = [];
  if (sample.memAvailableGb < thresholds.minMemAvailableGb) {
    reasons.push(`mem_available_gb ${sample.memAvailableGb.toFixed(3)} < ${thresholds.minMemAvailableGb}`);
  }
  if (sample.swapUsedGb > thresholds.maxSwapUsedGb) {
    reasons.push(`swap_used_gb ${sample.swapUsedGb.toFixed(3)} > ${thresholds.maxSwapUsedGb}`);
  }
  if (sample.psiFullAvg60 > thresholds.maxPsiFullAvg60) {
    reasons.push(`psi_full_avg60 ${sample.psiFullAvg60.toFixed(3)} > ${thresholds.maxPsiFullAvg60}`);
  }
  if (swapGrowthGb > thresholds.maxSwapGrowthGbPerBatch) {
    reasons.push(`swap_growth_gb ${swapGrowthGb.toFixed(3)} > ${thresholds.maxSwapGrowthGbPerBatch}`);
  }
  return { ...sample, swapGrowthGb, reasons, allowed: reasons.length === 0, sampledAt };
}

export function buildRosterLaunchCommand(entry: RosterEntry): string[] {
  return [
    "systemd-run",
    "--user",
    "--scope",
    "--slice=hasna-agents.slice",
    "-p",
    `MemoryHigh=${entry.memoryHigh}`,
    "-p",
    `MemoryMax=${entry.memoryMax}`,
    "-p",
    `MemorySwapMax=${entry.memorySwapMax}`,
    "accounts",
    "launch",
    entry.profile,
  ];
}

function shellQuote(value: string): string {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;
}

export function buildTmuxRespawnArgs(entry: RosterEntry): string[] {
  const command = buildRosterLaunchCommand(entry).map(shellQuote).join(" ");
  return ["respawn-pane", "-k", "-t", entry.target, command];
}

function leaseAcquire(db: Database, name: string, owner: string, now: number, ttlMs: number): boolean {
  const result = db.query(`
    INSERT INTO roster_leases (name, owner, acquired_at, expires_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET
      owner = excluded.owner,
      acquired_at = excluded.acquired_at,
      expires_at = excluded.expires_at
    WHERE roster_leases.expires_at <= excluded.acquired_at OR roster_leases.owner = excluded.owner
  `).run(name, owner, now, now + ttlMs) as { changes: number };
  return result.changes === 1;
}

function leaseRelease(db: Database, name: string, owner: string): void {
  db.query("DELETE FROM roster_leases WHERE name = ? AND owner = ?").run(name, owner);
}

function leaseRenew(db: Database, name: string, owner: string, now: number, ttlMs: number): boolean {
  const result = db.query(`
    UPDATE roster_leases SET expires_at = ?
    WHERE name = ? AND owner = ?
  `).run(now + ttlMs, name, owner) as { changes: number };
  return result.changes === 1;
}

function storedState(db: Database, entryId: string, now: number, windowMs: number): StoredEntryState {
  const row = db.query(`
    SELECT status, failed_attempts_json, first_missing_at, last_error
    FROM roster_entry_state WHERE entry_id = ?
  `).get(entryId) as {
    status?: string;
    failed_attempts_json?: string;
    first_missing_at?: number | null;
    last_error?: string | null;
  } | null;
  let attempts: number[] = [];
  try {
    const parsed = JSON.parse(row?.failed_attempts_json ?? "[]") as unknown;
    if (Array.isArray(parsed)) attempts = parsed.filter((value): value is number => typeof value === "number" && value >= now - windowMs);
  } catch {
    attempts = [];
  }
  return {
    status: row?.status ?? "unknown",
    attempts,
    firstMissingAt: row?.first_missing_at ?? null,
    lastError: row?.last_error ?? null,
  };
}

function saveState(db: Database, entryId: string, state: StoredEntryState, now: number): void {
  db.query(`
    INSERT INTO roster_entry_state (
      entry_id, status, failed_attempts_json, first_missing_at, last_attempt_at, last_error, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(entry_id) DO UPDATE SET
      status = excluded.status,
      failed_attempts_json = excluded.failed_attempts_json,
      first_missing_at = excluded.first_missing_at,
      last_attempt_at = excluded.last_attempt_at,
      last_error = excluded.last_error,
      updated_at = excluded.updated_at
  `).run(
    entryId,
    state.status,
    JSON.stringify(state.attempts),
    state.firstMissingAt,
    state.attempts.at(-1) ?? null,
    state.lastError,
    now,
  );
}

function latestLaunchExists(db: Database, entryId: string): boolean {
  return Boolean(db.query("SELECT 1 AS found FROM roster_launch_records WHERE entry_id = ? LIMIT 1").get(entryId));
}

function latestSwapSample(db: Database): number | null {
  const row = db.query("SELECT swap_used_gb FROM roster_gate_samples ORDER BY id DESC LIMIT 1").get() as { swap_used_gb?: number } | null;
  return typeof row?.swap_used_gb === "number" ? row.swap_used_gb : null;
}

function saveGateSample(db: Database, runId: string, now: number, gate: RosterGateDecision, phase: string): void {
  db.query("INSERT INTO roster_gate_samples (run_id, sampled_at, swap_used_gb, phase) VALUES (?, ?, ?, ?)")
    .run(runId, now, gate.swapUsedGb, phase);
}

function heartbeatInfo(
  entry: RosterEntry,
  now: number,
  heartbeatStat: NonNullable<RosterRunOptions["heartbeatStat"]>,
): { fresh: boolean | null; ageMs: number | null } {
  if (!entry.heartbeatPath) return { fresh: null, ageMs: null };
  const stat = heartbeatStat(entry.heartbeatPath);
  if (!stat) return { fresh: false, ageMs: null };
  const ageMs = Math.max(0, now - stat.mtimeMs);
  return { fresh: ageMs <= (entry.heartbeatFreshSeconds ?? 120) * 1000, ageMs };
}

function observeRoster(
  config: RosterConfig,
  db: Database,
  runner: RosterCommandRunner,
  now: number,
  heartbeatStat: NonNullable<RosterRunOptions["heartbeatStat"]>,
): { entries: RosterEntryObservation[]; panes: TmuxPane[]; activeAgents: number } {
  const listed = runner("tmux", ["list-panes", "-a", "-F", TMUX_FORMAT]);
  if (listed.status !== 0) {
    throw new Error(`tmux list-panes failed: ${(listed.stderr || listed.error || `exit ${listed.status}`).trim()}`);
  }
  const panes = parseTmuxPanes(listed.stdout);
  const byTarget = new Map(panes.map((pane) => [pane.target, pane]));
  const windowMs = config.backoff.windowMinutes * 60_000;
  const entries = config.entries.map((entry): RosterEntryObservation => {
    const pane = byTarget.get(entry.target) ?? null;
    const heartbeat = heartbeatInfo(entry, now, heartbeatStat);
    const paneRunning = Boolean(pane && !pane.dead && !IDLE_COMMANDS.has(pane.currentCommand));
    const active = paneRunning && heartbeat.fresh !== false;
    const hasLaunchRecord = latestLaunchExists(db, entry.id);
    const state = storedState(db, entry.id, now, windowMs);
    const crashlooping = state.status === "crashlooping";
    let safeToRespawn = Boolean(pane?.dead);
    if (pane && !pane.dead && IDLE_COMMANDS.has(pane.currentCommand) && pane.pid !== null) {
      // tmux reports the shell as current even when it owns background jobs.
      // pgrep exit 1 means no child; every other result fails closed.
      safeToRespawn = runner("pgrep", ["-P", String(pane.pid)], 5_000).status === 1;
    }
    const classification: RosterClassification = active ? "steady" : hasLaunchRecord ? "recovery" : "boot";
    return {
      id: entry.id,
      target: entry.target,
      classification,
      active,
      safeToRespawn,
      pane,
      heartbeatFresh: heartbeat.fresh,
      heartbeatAgeMs: heartbeat.ageMs,
      hasLaunchRecord,
      state: active ? "ready" : crashlooping ? "crashlooping" : safeToRespawn ? "missing" : "unsafe",
      failedAttempts: state.attempts.length,
      firstMissingAt: state.firstMissingAt,
    };
  });
  const rosterTargets = new Set(config.entries.map((entry) => entry.target));
  const activeAgents = panes.filter((pane) => {
    if (pane.dead || IDLE_COMMANDS.has(pane.currentCommand)) return false;
    if (rosterTargets.has(pane.target)) return true;
    return /(?:systemd-run|accounts\s+launch)/.test(`${pane.currentCommand} ${pane.startCommand}`);
  }).length;
  return { entries, panes, activeAgents };
}

function aggregateClassification(entries: RosterEntryObservation[]): RosterClassification {
  if (entries.every((entry) => entry.classification === "steady")) return "steady";
  if (entries.some((entry) => entry.classification === "recovery")) return "recovery";
  return "boot";
}

function planRoster(entries: RosterEntryObservation[], capacity: number): RosterPlanEntry[] {
  let remaining = Math.max(0, capacity);
  return entries.map((entry): RosterPlanEntry => {
    if (entry.active) return { id: entry.id, target: entry.target, classification: entry.classification, action: "none", reason: "steady" };
    if (entry.state === "crashlooping") {
      return { id: entry.id, target: entry.target, classification: entry.classification, action: "blocked", reason: "crashlooping" };
    }
    if (!entry.safeToRespawn) {
      return { id: entry.id, target: entry.target, classification: entry.classification, action: "blocked", reason: "pane is neither dead nor an idle shell" };
    }
    if (remaining <= 0) {
      return { id: entry.id, target: entry.target, classification: entry.classification, action: "blocked", reason: "active-agent ceiling" };
    }
    remaining -= 1;
    return { id: entry.id, target: entry.target, classification: entry.classification, action: "launch", reason: entry.classification };
  });
}

function boundedError(result: CommandResult): string {
  const value = (result.stderr || result.error || result.stdout || `exit ${result.status}`).trim();
  return value.length > 500 ? `${value.slice(0, 500)}...` : value;
}

function recordLaunch(
  db: Database,
  runId: string,
  entry: RosterEntry,
  at: Date,
  outcome: "succeeded" | "failed",
  error?: string,
): string {
  const id = randomUUID();
  db.query(`
    INSERT INTO roster_launch_records (id, run_id, entry_id, target, attempted_at, outcome, error)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, runId, entry.id, entry.target, at.toISOString(), outcome, error ?? null);
  return id;
}

function failLaunchRecord(db: Database, id: string, error: string): void {
  db.query("UPDATE roster_launch_records SET outcome = 'failed', error = ? WHERE id = ?").run(error, id);
}

function runFunctionalChecks(config: RosterConfig, runner: RosterCommandRunner): Record<string, "ok" | "failed"> {
  const results: Record<string, "ok" | "failed"> = {};
  for (const check of config.functionalChecks) {
    const command = check === "todos" ? config.todos.bin : config.conversations.bin;
    const result = runner(command, ["storage", "status", "--json"], 30_000);
    results[check] = result.status === 0 ? "ok" : "failed";
  }
  return results;
}

function postConversation(
  config: RosterConfig,
  runner: RosterCommandRunner,
  message: string,
  urgent: boolean,
): boolean {
  const args = [
    "post",
    "--channel",
    config.conversations.channel,
    "--message",
    message,
    "--severity",
    urgent ? "urgent" : "info",
    "--json",
  ];
  return runner(config.conversations.bin, args, 30_000).status === 0;
}

function parseTasks(stdout: string): Array<{ id?: string; status?: string }> {
  if (!stdout.trim()) return [];
  const parsed = JSON.parse(stdout) as unknown;
  if (Array.isArray(parsed)) return parsed as Array<{ id?: string; status?: string }>;
  if (parsed && typeof parsed === "object" && Array.isArray((parsed as { tasks?: unknown }).tasks)) {
    return (parsed as { tasks: Array<{ id?: string; status?: string }> }).tasks;
  }
  return [];
}

function fileCrashloopTask(config: RosterConfig, runner: RosterCommandRunner, entry: RosterEntry, error: string): boolean {
  const tag = `machines-roster-${entry.id.replace(/[^A-Za-z0-9_-]/g, "-")}`;
  const base = ["--project", config.todos.project, "-j"];
  const search = runner(config.todos.bin, [...base, "search", tag, "--tag", tag, "--limit", "10"], 30_000);
  if (search.status !== 0) return false;
  try {
    const active = parseTasks(search.stdout).some((task) => task.id && !["done", "completed", "cancelled", "deleted"].includes(task.status ?? ""));
    if (active) return true;
  } catch {
    return false;
  }
  const args = [
    ...base,
    "add",
    `[machines roster] ${entry.id} is crashlooping`,
    "-d",
    [
      `Seat ${entry.id} at ${entry.target} reached the configured launch-attempt ceiling.`,
      `profile: ${entry.profile}`,
      `last_error: ${error}`,
      "The reconciler will not make another attempt until an operator resets this entry.",
      "This task creates no work dispatch or tmux prompt.",
    ].join("\n"),
    "-p",
    "urgent",
    "--tags",
    `machines,roster,crashlooping,${tag}`,
  ];
  if (config.todos.taskList) args.push("--task-list", config.todos.taskList);
  return runner(config.todos.bin, args, 30_000).status === 0;
}

function writeRosterHeartbeat(path: string, record: RosterRecord): void {
  ensureParentDir(path);
  const tmp = `${path}.${process.pid}.${record.id}.tmp`;
  writeFileSync(tmp, `${JSON.stringify({
    schema: "hasna.roster_heartbeat.v1",
    runId: record.id,
    machine: record.machine,
    status: "succeeded",
    updatedAt: record.createdAt,
  })}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(tmp, path);
}

function appendRosterRecord(path: string, record: RosterRecord): void {
  ensureParentDir(path);
  appendFileSync(path, `${JSON.stringify(record)}\n`, "utf8");
}

function saveRun(db: Database, record: RosterRecord, startedAt: string): void {
  db.query(`
    INSERT INTO roster_runs (
      id, machine_id, classification, status, mode, started_at, finished_at,
      gate_json, plan_json, result_json, mttr_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    record.id,
    record.machine,
    record.classification,
    record.result,
    record.mode,
    startedAt,
    record.createdAt,
    JSON.stringify(record.gate),
    JSON.stringify(record.plan),
    JSON.stringify(record.entries),
    record.mttrMs ?? null,
  );
}

function resultForLease(runId: string): RosterRunResult {
  return {
    runId,
    status: "lease-held",
    mode: "manual",
    classification: "steady",
    gate: null,
    plan: [],
    observations: [],
    launched: [],
    crashlooping: [],
    functionalChecks: {},
    conversationPosted: false,
    heartbeatWritten: false,
    record: null,
    warnings: ["another roster reconcile owns the SQLite lease"],
  };
}

export async function runRosterReconcile(config: RosterConfig, options: RosterRunOptions = {}): Promise<RosterRunResult> {
  const validated = rosterConfigSchema.parse(config);
  const db = options.db ?? getDb();
  const runner = options.runner ?? defaultRosterCommandRunner;
  const now = options.now ?? (() => new Date());
  const sleep = options.sleep ?? ((milliseconds) => Bun.sleep(milliseconds));
  const resourceProbe = options.resourceProbe ?? probeHostResources;
  const heartbeatStat = options.heartbeatStat ?? ((path: string) => {
    try {
      return statSync(path);
    } catch {
      return null;
    }
  });
  const runId = randomUUID();
  const owner = options.owner ?? `${hostname()}:${process.pid}:${runId}`;
  const started = now();
  const leaseName = `roster:${validated.machineId ?? hostname()}`;
  if (!leaseAcquire(db, leaseName, owner, started.getTime(), validated.leaseSeconds * 1000)) {
    return resultForLease(runId);
  }

  let summaryAttempted = false;
  let jsonlRecorded = false;
  let sqliteRunRecorded = false;
  try {
    const mode: RosterRunResult["mode"] = validated.applyMode === "auto" ? "auto" : options.apply ? "apply" : "manual";
    const shouldApply = options.apply === true || validated.applyMode === "auto";
    let observed = observeRoster(validated, db, runner, started.getTime(), heartbeatStat);
    const classification = aggregateClassification(observed.entries);
    const windowMs = validated.backoff.windowMinutes * 60_000;
    for (const observation of observed.entries) {
      if (observation.active) continue;
      const state = storedState(db, observation.id, started.getTime(), windowMs);
      if (state.firstMissingAt === null) state.firstMissingAt = started.getTime();
      saveState(db, observation.id, state, started.getTime());
    }
    const plan = planRoster(observed.entries, validated.maxActiveAgents - observed.activeAgents);
    const firstSample = resourceProbe();
    let gate = evaluateRosterGate(firstSample, validated.gate, latestSwapSample(db), now().toISOString());
    const launched: string[] = [];
    const newCrashloops: Array<{ entry: RosterEntry; error: string }> = [];
    const attemptErrors = new Map<string, string>();
    const launchRecordIds = new Map<string, string>();
    let status: RosterRunStatus = "planned";

    if (!gate.allowed) {
      status = "blocked";
    } else if (!shouldApply && plan.some((entry) => entry.action === "launch")) {
      status = "planned";
    } else if (plan.some((entry) => entry.action === "blocked")) {
      status = "blocked";
    } else {
      const candidates = plan.filter((entry) => entry.action === "launch");
      let applyBlocked = false;
      for (let offset = 0; offset < candidates.length; offset += validated.batchSize) {
        const batch = candidates.slice(offset, offset + validated.batchSize);
        if (!leaseRenew(db, leaseName, owner, now().getTime(), validated.leaseSeconds * 1000)) {
          applyBlocked = true;
          attemptErrors.set("lease", "SQLite lease was lost before a batch");
          break;
        }
        if (offset > 0) {
          gate = evaluateRosterGate(resourceProbe(), validated.gate, latestSwapSample(db), now().toISOString());
          if (!gate.allowed) {
            applyBlocked = true;
            break;
          }
        }
        for (const item of batch) {
          const entry = validated.entries.find((candidate) => candidate.id === item.id)!;
          const before = observed.entries.find((candidate) => candidate.id === item.id)!;
          // Re-check the predicate immediately before -k; no stale plan may kill
          // a pane that became busy after OBSERVE.
          const current = observeRoster(validated, db, runner, now().getTime(), heartbeatStat);
          const currentEntry = current.entries.find((candidate) => candidate.id === item.id)!;
          if (!before.safeToRespawn || !currentEntry.safeToRespawn) {
            attemptErrors.set(entry.id, "pane became busy before respawn");
            applyBlocked = true;
            continue;
          }
          const session = entry.target.split(":", 1)[0]!;
          const remain = runner("tmux", ["set-option", "-t", session, "remain-on-exit", "on"]);
          const result = remain.status === 0
            ? runner("tmux", buildTmuxRespawnArgs(entry), 30_000)
            : remain;
          if (result.status !== 0) {
            const error = boundedError(result);
            attemptErrors.set(entry.id, error);
            launchRecordIds.set(entry.id, recordLaunch(db, runId, entry, now(), "failed", error));
          } else {
            launched.push(entry.id);
            launchRecordIds.set(entry.id, recordLaunch(db, runId, entry, now(), "succeeded"));
          }
        }
        if (validated.settleSeconds > 0) await sleep(validated.settleSeconds * 1000);
        const after = observeRoster(validated, db, runner, now().getTime(), heartbeatStat);
        for (const item of batch) {
          const entry = validated.entries.find((candidate) => candidate.id === item.id)!;
          const outcome = after.entries.find((candidate) => candidate.id === item.id)!;
          const state = storedState(db, entry.id, now().getTime(), windowMs);
          if (outcome.active) {
            state.status = "steady";
            state.attempts = [];
            state.lastError = null;
            saveState(db, entry.id, state, now().getTime());
            continue;
          }
          const error = attemptErrors.get(entry.id) ?? "seat did not become healthy during settle window";
          if (!attemptErrors.has(entry.id)) {
            // A successful tmux invocation whose process immediately died is a
            // failed launch attempt too; update the latest launch record's evidence.
            attemptErrors.set(entry.id, error);
          }
          const launchRecordId = launchRecordIds.get(entry.id);
          if (launchRecordId) failLaunchRecord(db, launchRecordId, error);
          state.attempts.push(now().getTime());
          state.lastError = error;
          if (state.attempts.length >= validated.backoff.maxAttempts) {
            state.status = "crashlooping";
            newCrashloops.push({ entry, error });
          } else {
            state.status = "backoff";
          }
          saveState(db, entry.id, state, now().getTime());
        }
        observed = after;
        saveGateSample(db, runId, now().getTime(), gate, `batch:${Math.floor(offset / validated.batchSize) + 1}`);
      }
      if (applyBlocked) status = "blocked";
    }

    observed = observeRoster(validated, db, runner, now().getTime(), heartbeatStat);
    const allSteady = observed.entries.every((entry) => entry.active);
    const functionalChecks = allSteady ? runFunctionalChecks(validated, runner) : {};
    const checksPass = Object.values(functionalChecks).every((value) => value === "ok");
    if (allSteady && checksPass && gate.allowed) {
      status = "succeeded";
      saveGateSample(db, runId, now().getTime(), gate, "full-pass");
    } else if (allSteady && !checksPass) {
      status = "failed";
    } else if (shouldApply && status === "planned") {
      status = "failed";
    }

    const crashlooping = observed.entries.filter((entry) => entry.state === "crashlooping").map((entry) => entry.id);
    for (const crash of newCrashloops) {
      fileCrashloopTask(validated, runner, crash.entry, crash.error);
    }

    const summary = [
      `[machines roster] ${validated.machineId ?? hostname()} reconcile ${status}`,
      `classification=${classification}`,
      `mode=${mode}`,
      `launched=${launched.length ? launched.join(",") : "none"}`,
      `crashlooping=${crashlooping.length ? crashlooping.join(",") : "none"}`,
      `crash_errors=${newCrashloops.length ? newCrashloops.map((item) => `${item.entry.id}:${item.error}`).join(";") : "none"}`,
      `gate=${gate.allowed ? "open" : gate.reasons.join("; ")}`,
    ].join(" ");
    summaryAttempted = true;
    const conversationPosted = postConversation(validated, runner, summary, status === "blocked" || status === "failed");
    if (!conversationPosted && status === "succeeded") status = "failed";

    const finished = now();
    const recordEntries = observed.entries.map((entry) => {
      const state = storedState(db, entry.id, finished.getTime(), windowMs);
      const mttrMs = entry.active && state.firstMissingAt !== null ? Math.max(0, finished.getTime() - state.firstMissingAt) : undefined;
      if (entry.active) {
        state.status = "steady";
        state.firstMissingAt = null;
        state.attempts = [];
        state.lastError = null;
        saveState(db, entry.id, state, finished.getTime());
      }
      return {
        id: entry.id,
        state: entry.state,
        classification: entry.classification,
        attempts: state.attempts.length,
        error: attemptErrors.get(entry.id),
        mttrMs,
      };
    });
    const mttrValues = recordEntries.flatMap((entry) => entry.mttrMs === undefined ? [] : [entry.mttrMs]);
    const record: RosterRecord = {
      schema: ROSTER_RECORD_SCHEMA_ID,
      id: runId,
      createdAt: finished.toISOString(),
      machine: validated.machineId ?? hostname(),
      classification,
      result: status,
      mode,
      drillLevel: options.drillLevel,
      gate,
      plan,
      entries: recordEntries,
      launched,
      crashlooping,
      functionalChecks,
      conversationPosted,
      mttrMs: mttrValues.length > 0 ? Math.max(...mttrValues) : undefined,
    };

    const recordsPath = resolve(validated.recordsPath ?? getRosterRecordsPath());
    try {
      appendRosterRecord(recordsPath, record);
      jsonlRecorded = true;
    } catch (error) {
      status = "failed";
      record.result = "failed";
      const message = error instanceof Error ? error.message : String(error);
      attemptErrors.set("record", message);
    }
    saveRun(db, record, started.toISOString());
    sqliteRunRecorded = true;

    let heartbeatWritten = false;
    if (status === "succeeded") {
      writeRosterHeartbeat(resolve(validated.heartbeatPath ?? getRosterHeartbeatPath()), record);
      heartbeatWritten = true;
    }

    return {
      runId,
      status,
      mode,
      classification,
      gate,
      plan,
      observations: observed.entries,
      launched,
      crashlooping,
      functionalChecks,
      conversationPosted,
      heartbeatWritten,
      record,
      warnings: attemptErrors.has("record") ? [`roster record append failed: ${attemptErrors.get("record")}`] : [],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    let conversationPosted = false;
    if (!summaryAttempted) {
      summaryAttempted = true;
      try {
        conversationPosted = postConversation(
          validated,
          runner,
          `[machines roster] ${validated.machineId ?? hostname()} reconcile failed controller_error=${message}`,
          true,
        );
      } catch {
        conversationPosted = false;
      }
    }
    const finished = now();
    const gate: RosterGateDecision = {
      allowed: false,
      memAvailableGb: 0,
      swapUsedGb: 0,
      psiFullAvg60: 0,
      swapGrowthGb: 0,
      reasons: [`controller_error: ${message}`],
      sampledAt: finished.toISOString(),
    };
    const record: RosterRecord = {
      schema: ROSTER_RECORD_SCHEMA_ID,
      id: runId,
      createdAt: finished.toISOString(),
      machine: validated.machineId ?? hostname(),
      classification: "recovery",
      result: "failed",
      mode: validated.applyMode === "auto" ? "auto" : options.apply ? "apply" : "manual",
      drillLevel: options.drillLevel,
      gate,
      plan: [],
      entries: [],
      launched: [],
      crashlooping: [],
      functionalChecks: {},
      conversationPosted,
    };
    const warnings = [`roster controller error: ${message}`];
    if (!jsonlRecorded) {
      try {
        appendRosterRecord(resolve(validated.recordsPath ?? getRosterRecordsPath()), record);
      } catch (recordError) {
        warnings.push(`roster record append failed: ${recordError instanceof Error ? recordError.message : String(recordError)}`);
      }
    }
    if (!sqliteRunRecorded) {
      try {
        saveRun(db, record, started.toISOString());
      } catch (recordError) {
        warnings.push(`roster_runs write failed: ${recordError instanceof Error ? recordError.message : String(recordError)}`);
      }
    } else {
      try {
        db.query("UPDATE roster_runs SET status = 'failed' WHERE id = ?").run(runId);
      } catch (recordError) {
        warnings.push(`roster_runs correction failed: ${recordError instanceof Error ? recordError.message : String(recordError)}`);
      }
    }
    return {
      runId,
      status: "failed",
      mode: record.mode,
      classification: "recovery",
      gate,
      plan: [],
      observations: [],
      launched: [],
      crashlooping: [],
      functionalChecks: {},
      conversationPosted,
      heartbeatWritten: false,
      record,
      warnings,
    };
  } finally {
    leaseRelease(db, leaseName, owner);
  }
}

export function resetRosterCrashloop(config: RosterConfig, entryId: string, db: Database = getDb()): boolean {
  if (!config.entries.some((entry) => entry.id === entryId)) throw new Error(`Unknown roster entry: ${entryId}`);
  const result = db.query(`
    UPDATE roster_entry_state
    SET status = 'unknown', failed_attempts_json = '[]', last_attempt_at = NULL,
        last_error = NULL, updated_at = ?
    WHERE entry_id = ?
  `).run(Date.now(), entryId) as { changes: number };
  return result.changes === 1;
}

export async function runRosterDaemon(
  configPath = getRosterConfigPath(),
  options: Omit<RosterRunOptions, "apply"> & {
    once?: boolean;
    onResult?: (result: RosterRunResult) => void;
    authorizeApply?: (config: RosterConfig) => void;
  } = {},
): Promise<void> {
  let stopped = false;
  const stop = () => { stopped = true; };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    do {
      const config = readRosterConfig(configPath);
      if (config.applyMode === "auto") options.authorizeApply?.(config);
      const result = await runRosterReconcile(config, { ...options, apply: config.applyMode === "auto" });
      options.onResult?.(result);
      if (options.once || stopped) break;
      await (options.sleep ?? ((milliseconds) => Bun.sleep(milliseconds)))(config.tickSeconds * 1000);
    } while (!stopped);
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
}

export function rosterConfigResourceId(configPath: string): string {
  return `roster:${resolve(configPath)}`;
}

export function rosterConfigApprovalArgs(configPath: string, entryId?: string): Record<string, unknown> {
  return { config_path: resolve(configPath), entry_id: entryId ?? null };
}
