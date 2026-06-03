import type { Database } from "bun:sqlite";
import {
  addTaskRunCommand,
  addTaskRunEvent,
  finishTaskRun,
  getTaskRun,
  listTaskRuns,
  resolveTaskRunId,
  startTaskRun,
  type TaskRun,
} from "../db/task-runs.js";
import { getDatabase, now } from "../db/database.js";
import { redactEvidenceText, redactValue } from "./redaction.js";
import { checkRunnerSandbox } from "./runner-sandbox.js";
import { loadConfig, saveConfig, type AgentRunAdapterConfig } from "./config.js";

export type AgentRunDispatchState = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface QueueAgentRunInput {
  task_id: string;
  agent_id?: string;
  adapter?: string;
  command?: string;
  sandbox?: string;
  cwd?: string;
  title?: string;
  summary?: string;
  claim?: boolean;
  metadata?: Record<string, unknown>;
}

export interface QueuedAgentRun {
  run: TaskRun;
  dispatcher: AgentRunDispatchMetadata;
}

export interface AgentRunDispatchMetadata {
  state: AgentRunDispatchState;
  adapter?: string;
  command: string;
  sandbox?: string;
  cwd?: string;
  attempt: number;
  queued_at: string;
  started_at?: string;
  completed_at?: string;
  last_error?: string;
}

export interface RunNextAgentDispatchInput {
  adapter?: string;
  dry_run?: boolean;
  limit?: number;
}

export interface RunAgentDispatchResult {
  run_id: string;
  task_id: string;
  command: string;
  dry_run: boolean;
  status: "queued" | "completed" | "failed" | "cancelled";
  exit_code: number | null;
  output_summary: string | null;
}

export interface UpsertAgentRunAdapterInput {
  name: string;
  command: string;
  sandbox?: string;
  cwd?: string;
  env?: Record<string, string>;
}

function dispatcherFromRun(run: TaskRun): AgentRunDispatchMetadata | null {
  const value = run.metadata["agent_run_dispatcher"];
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as AgentRunDispatchMetadata
    : null;
}

function updateDispatcherMetadata(runId: string, dispatcher: AgentRunDispatchMetadata, db?: Database): TaskRun {
  const d = db || getDatabase();
  const run = getTaskRun(resolveTaskRunId(runId, d), d);
  if (!run) throw new Error(`Run not found: ${runId}`);
  const metadata = redactValue({
    ...run.metadata,
    agent_run_dispatcher: dispatcher,
  });
  d.run("UPDATE task_runs SET metadata = ?, updated_at = ? WHERE id = ?", [JSON.stringify(metadata), now(), run.id]);
  return getTaskRun(run.id, d)!;
}

function resolveAdapter(adapter: string | undefined): AgentRunAdapterConfig | null {
  if (!adapter) return null;
  return loadConfig().agent_run_adapters?.[adapter] || null;
}

function renderCommand(command: string, run: TaskRun): string {
  return command
    .replaceAll("{task_id}", run.task_id)
    .replaceAll("{run_id}", run.id)
    .replaceAll("{agent_id}", run.agent_id || "");
}

function summarizeOutput(stdout: string, stderr: string): string | null {
  const combined = redactEvidenceText([stdout.trim(), stderr.trim()].filter(Boolean).join("\n"));
  if (!combined) return null;
  return combined.length > 1000 ? `${combined.slice(0, 997)}...` : combined;
}

export function upsertAgentRunAdapter(input: UpsertAgentRunAdapterInput): AgentRunAdapterConfig {
  const config = loadConfig();
  const existing = config.agent_run_adapters?.[input.name];
  const timestamp = new Date().toISOString();
  const adapter: AgentRunAdapterConfig = {
    ...existing,
    name: input.name,
    command: input.command,
    sandbox: input.sandbox ?? existing?.sandbox,
    cwd: input.cwd ?? existing?.cwd,
    env: input.env ?? existing?.env,
    created_at: existing?.created_at || timestamp,
    updated_at: timestamp,
  };
  saveConfig({
    ...config,
    agent_run_adapters: {
      ...(config.agent_run_adapters || {}),
      [adapter.name]: adapter,
    },
  });
  return adapter;
}

export function listAgentRunAdapters(): AgentRunAdapterConfig[] {
  return Object.values(loadConfig().agent_run_adapters || {}).sort((a, b) => a.name.localeCompare(b.name));
}

export function removeAgentRunAdapter(name: string): boolean {
  const config = loadConfig();
  if (!config.agent_run_adapters?.[name]) return false;
  const next = { ...config.agent_run_adapters };
  delete next[name];
  saveConfig({ ...config, agent_run_adapters: next });
  return true;
}

export function queueAgentRun(input: QueueAgentRunInput, db?: Database): QueuedAgentRun {
  const adapter = resolveAdapter(input.adapter);
  const command = input.command || adapter?.command;
  if (!command) throw new Error("agent run requires --command or a configured adapter command");
  const run = startTaskRun({
    task_id: input.task_id,
    agent_id: input.agent_id,
    title: input.title || `Agent run: ${input.adapter || "custom"}`,
    summary: input.summary,
    claim: input.claim,
    metadata: {
      ...input.metadata,
      agent_run_dispatcher: {
        state: "queued",
        adapter: input.adapter,
        command,
        sandbox: input.sandbox ?? adapter?.sandbox,
        cwd: input.cwd ?? adapter?.cwd,
        attempt: 1,
        queued_at: new Date().toISOString(),
      } satisfies AgentRunDispatchMetadata,
    },
  }, db);
  const dispatcher = dispatcherFromRun(run)!;
  addTaskRunEvent({ run_id: run.id, event_type: "progress", message: "agent run queued", data: { ...dispatcher }, agent_id: input.agent_id }, db);
  return { run, dispatcher };
}

export function listAgentRunQueue(db?: Database): QueuedAgentRun[] {
  return listTaskRuns(undefined, db)
    .map((run) => ({ run, dispatcher: dispatcherFromRun(run) }))
    .filter((item): item is QueuedAgentRun => Boolean(item.dispatcher))
    .sort((a, b) => a.dispatcher.queued_at.localeCompare(b.dispatcher.queued_at));
}

export function cancelAgentRunDispatch(runId: string, db?: Database): QueuedAgentRun {
  const d = db || getDatabase();
  const run = getTaskRun(resolveTaskRunId(runId, d), d);
  if (!run) throw new Error(`Run not found: ${runId}`);
  const dispatcher = dispatcherFromRun(run);
  if (!dispatcher) throw new Error(`Run is not an agent dispatch: ${runId}`);
  const next = { ...dispatcher, state: "cancelled" as const, completed_at: new Date().toISOString() };
  const updated = updateDispatcherMetadata(run.id, next, d);
  finishTaskRun({ run_id: run.id, status: "cancelled", summary: "agent run dispatch cancelled", agent_id: run.agent_id ?? undefined }, d);
  return { run: updated, dispatcher: next };
}

export function retryAgentRunDispatch(runId: string, db?: Database): QueuedAgentRun {
  const d = db || getDatabase();
  const run = getTaskRun(resolveTaskRunId(runId, d), d);
  if (!run) throw new Error(`Run not found: ${runId}`);
  const dispatcher = dispatcherFromRun(run);
  if (!dispatcher) throw new Error(`Run is not an agent dispatch: ${runId}`);
  return queueAgentRun({
    task_id: run.task_id,
    agent_id: run.agent_id ?? undefined,
    adapter: dispatcher.adapter,
    command: dispatcher.command,
    sandbox: dispatcher.sandbox,
    cwd: dispatcher.cwd,
    title: `Retry: ${run.title || "agent run"}`,
    metadata: { retry_of: run.id, attempt: dispatcher.attempt + 1 },
  }, d);
}

export async function runNextAgentDispatch(input: RunNextAgentDispatchInput = {}, db?: Database): Promise<RunAgentDispatchResult | null> {
  const d = db || getDatabase();
  const next = listAgentRunQueue(d).find((item) => (
    item.dispatcher.state === "queued"
    && (!input.adapter || item.dispatcher.adapter === input.adapter)
  ));
  if (!next) return null;

  const adapter = resolveAdapter(next.dispatcher.adapter);
  const command = renderCommand(next.dispatcher.command, next.run);
  const cwd = next.dispatcher.cwd || adapter?.cwd || process.cwd();
  const sandbox = next.dispatcher.sandbox || adapter?.sandbox;
  if (sandbox) {
    const check = checkRunnerSandbox({ name: sandbox, cwd, command });
    if (!check.allowed) {
      const reason = check.reasons.join("; ");
      const failed = { ...next.dispatcher, state: "failed" as const, last_error: reason, completed_at: new Date().toISOString() };
      updateDispatcherMetadata(next.run.id, failed, d);
      addTaskRunCommand({ run_id: next.run.id, command, status: "failed", exit_code: 1, output_summary: reason, agent_id: next.run.agent_id ?? undefined }, d);
      finishTaskRun({ run_id: next.run.id, status: "failed", summary: reason, agent_id: next.run.agent_id ?? undefined }, d);
      return { run_id: next.run.id, task_id: next.run.task_id, command, dry_run: false, status: "failed", exit_code: 1, output_summary: reason };
    }
  }
  if (input.dry_run) {
    return { run_id: next.run.id, task_id: next.run.task_id, command, dry_run: true, status: "queued", exit_code: null, output_summary: "dry run; command not executed" };
  }

  const running = { ...next.dispatcher, state: "running" as const, started_at: new Date().toISOString() };
  updateDispatcherMetadata(next.run.id, running, d);
  addTaskRunEvent({ run_id: next.run.id, event_type: "progress", message: "agent run dispatch started", data: { ...running }, agent_id: next.run.agent_id ?? undefined }, d);

  const proc = Bun.spawn(["bash", "-lc", command], {
    cwd,
    env: { ...process.env, ...(adapter?.env || {}) },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  const outputSummary = summarizeOutput(stdout, stderr);
  const status: "completed" | "failed" = exitCode === 0 ? "completed" : "failed";
  addTaskRunCommand({
    run_id: next.run.id,
    command,
    status: exitCode === 0 ? "passed" : "failed",
    exit_code: exitCode,
    output_summary: outputSummary ?? undefined,
    agent_id: next.run.agent_id ?? undefined,
  }, d);
  const completed = { ...running, state: status, completed_at: new Date().toISOString(), last_error: exitCode === 0 ? undefined : outputSummary || `exit ${exitCode}` };
  updateDispatcherMetadata(next.run.id, completed, d);
  finishTaskRun({
    run_id: next.run.id,
    status,
    summary: outputSummary || `agent run ${status}`,
    agent_id: next.run.agent_id ?? undefined,
  }, d);
  return { run_id: next.run.id, task_id: next.run.task_id, command, dry_run: false, status, exit_code: exitCode, output_summary: outputSummary };
}

// Compatibility wrappers for callers using the run-oriented names.
export function listAgentRuns(
  filter: { task_id?: string; status?: string; agent_id?: string; limit?: number } = {},
  db?: Database,
): QueuedAgentRun[] {
  let runs = listAgentRunQueue(db);
  if (filter.task_id) runs = runs.filter((r) => (r as { task_id?: string }).task_id === filter.task_id);
  if (filter.status) runs = runs.filter((r) => (r as { status?: string }).status === filter.status);
  if (filter.agent_id) runs = runs.filter((r) => (r as { agent_id?: string }).agent_id === filter.agent_id);
  if (filter.limit && filter.limit > 0) runs = runs.slice(0, filter.limit);
  return runs;
}

export function retryAgentRun(runId: string, db?: Database): QueuedAgentRun {
  return retryAgentRunDispatch(runId, db);
}

// ---------------------------------------------------------------------------
// Agent-run lifecycle API (claim model) layered over the task_runs queue.
// Consumers: mcp/tools/agent-runs, agent-workflow-demo, failure-triage.
// ---------------------------------------------------------------------------

export const AGENT_RUN_SCHEMA_VERSION = "todos.agent_run.v1";
export type AgentRunStatus = AgentRunDispatchState;
export type AgentAdapterConfig = AgentRunAdapterConfig;

export interface EnqueueAgentRunInput {
  task_id: string;
  adapter?: string;
  agent_id?: string;
  command?: string;
  plan_id?: string;
  evidence?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface AgentRun {
  id: string;
  task_id: string;
  agent_id: string | null;
  adapter: string | null;
  status: AgentRunStatus;
  command: string | null;
  evidence: Record<string, unknown>;
  queued_at: string;
  started_at: string | null;
  completed_at: string | null;
  metadata: Record<string, unknown>;
}

export interface ListAgentRunsFilter {
  task_id?: string;
  agent_id?: string;
  status?: AgentRunStatus;
  adapter?: string;
  limit?: number;
}

function toAgentRun(item: QueuedAgentRun): AgentRun {
  const md = (item.run.metadata || {}) as Record<string, unknown>;
  return {
    id: item.run.id,
    task_id: item.run.task_id,
    agent_id: item.run.agent_id,
    adapter: item.dispatcher.adapter ?? null,
    status: item.dispatcher.state,
    command: item.dispatcher.command ?? null,
    evidence: (md["agent_run_evidence"] as Record<string, unknown>) ?? {},
    queued_at: item.dispatcher.queued_at,
    started_at: item.dispatcher.started_at ?? null,
    completed_at: item.dispatcher.completed_at ?? null,
    metadata: md,
  };
}

function queuedRunById(runId: string, db?: Database): QueuedAgentRun | null {
  const d = db || getDatabase();
  const run = getTaskRun(resolveTaskRunId(runId, d), d);
  if (!run) return null;
  const item = { run, dispatcher: dispatcherFromRun(run) };
  return item.dispatcher ? (item as QueuedAgentRun) : null;
}

export function enqueueAgentRun(input: EnqueueAgentRunInput, db?: Database): AgentRun {
  const command = input.command || resolveAdapter(input.adapter)?.command || `agent-run:${input.adapter ?? "custom"}`;
  const queued = queueAgentRun(
    {
      task_id: input.task_id,
      agent_id: input.agent_id,
      adapter: input.adapter,
      command,
      metadata: {
        ...input.metadata,
        ...(input.plan_id ? { plan_id: input.plan_id } : {}),
        ...(input.evidence ? { agent_run_evidence: input.evidence } : {}),
      },
    },
    db,
  );
  return toAgentRun(queued);
}

export function claimNextAgentRun(
  agentId: string,
  options: { adapter?: string } = {},
  db?: Database,
): AgentRun | null {
  const d = db || getDatabase();
  const next = listAgentRunQueue(d).find(
    (item) => item.dispatcher.state === "queued" && (!options.adapter || item.dispatcher.adapter === options.adapter),
  );
  if (!next) return null;
  const dispatcher = { ...next.dispatcher, state: "running" as const, started_at: new Date().toISOString() };
  const updated = updateDispatcherMetadata(next.run.id, dispatcher, d);
  if (agentId) d.run("UPDATE task_runs SET agent_id = ?, updated_at = ? WHERE id = ?", [agentId, now(), next.run.id]);
  const reread = getTaskRun(next.run.id, d) ?? updated;
  return toAgentRun({ run: reread, dispatcher });
}

export function completeAgentRun(runId: string, evidence: Record<string, unknown> = {}, db?: Database): AgentRun {
  const d = db || getDatabase();
  const item = queuedRunById(runId, d);
  if (!item) throw new Error(`Agent run not found: ${runId}`);
  const dispatcher = { ...item.dispatcher, state: "completed" as const, completed_at: new Date().toISOString() };
  updateDispatcherMetadata(item.run.id, dispatcher, d);
  const md = { ...(item.run.metadata || {}), agent_run_evidence: { ...(item.run.metadata?.["agent_run_evidence"] as object), ...evidence } };
  d.run("UPDATE task_runs SET metadata = ? WHERE id = ?", [JSON.stringify(md), item.run.id]);
  finishTaskRun({ run_id: item.run.id, status: "completed", summary: "agent run completed", agent_id: item.run.agent_id ?? undefined }, d);
  return toAgentRun({ run: getTaskRun(item.run.id, d)!, dispatcher });
}

export function failAgentRun(runId: string, error?: string, db?: Database): AgentRun {
  const d = db || getDatabase();
  const item = queuedRunById(runId, d);
  if (!item) throw new Error(`Agent run not found: ${runId}`);
  const dispatcher = { ...item.dispatcher, state: "failed" as const, completed_at: new Date().toISOString(), last_error: error };
  updateDispatcherMetadata(item.run.id, dispatcher, d);
  finishTaskRun({ run_id: item.run.id, status: "failed", summary: error || "agent run failed", agent_id: item.run.agent_id ?? undefined }, d);
  return toAgentRun({ run: getTaskRun(item.run.id, d)!, dispatcher });
}

export function cancelAgentRun(runId: string, db?: Database): AgentRun {
  return toAgentRun(cancelAgentRunDispatch(runId, db));
}

export function getAgentRun(runId: string, db?: Database): AgentRun | null {
  const item = queuedRunById(runId, db);
  return item ? toAgentRun(item) : null;
}

// Adapter config helpers (back the agent_run_adapters config map).
export function loadAgentAdapters(): AgentAdapterConfig[] {
  return listAgentRunAdapters();
}

export function saveAgentAdapters(adapters: AgentAdapterConfig[]): void {
  const config = loadConfig();
  const map: Record<string, AgentAdapterConfig> = {};
  for (const a of adapters) map[a.name] = a;
  saveConfig({ ...config, agent_run_adapters: map });
}

export function getAgentAdapter(name: string): AgentAdapterConfig | null {
  return loadConfig().agent_run_adapters?.[name] ?? null;
}

export function getDefaultAgentAdapters(): AgentAdapterConfig[] {
  return listAgentRunAdapters();
}

export function resetAgentAdapterCache(): void {
  // Config is read fresh via loadConfig(); no in-process cache to clear.
}
