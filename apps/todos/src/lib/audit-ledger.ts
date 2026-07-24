import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { getDatabase, now, resolvePartialId, uuid } from "../db/database.js";
import { resolveTaskRunId } from "../db/task-runs.js";
import { loadConfig, saveConfig, type LocalAuditLedgerCheckpointConfig } from "./config.js";
import { redactValue } from "./redaction.js";

export const LOCAL_AUDIT_LEDGER_SCHEMA_VERSION = 1;
export const LOCAL_AUDIT_LEDGER_HASH_ALGORITHM = "sha256";
export const LOCAL_AUDIT_LEDGER_INITIAL_HASH = "0".repeat(64);

export type LocalAuditLedgerSource =
  | "task_history"
  | "task_verification"
  | "run_event"
  | "run_command"
  | "run_artifact"
  | "approval_gate"
  | "handoff";

export interface LocalAuditLedgerScope {
  project_id?: string;
  task_id?: string;
  run_id?: string;
}

export interface LocalAuditLedgerInput extends LocalAuditLedgerScope {
  include_entries?: boolean;
}

export interface SealLocalAuditLedgerInput extends LocalAuditLedgerScope {
  name: string;
  agent_id?: string;
  note?: string;
}

export interface LocalAuditLedgerEntry {
  index: number;
  source: LocalAuditLedgerSource;
  source_id: string;
  task_id: string | null;
  run_id: string | null;
  project_id: string | null;
  created_at: string;
  payload_hash: string;
  previous_hash: string;
  chain_hash: string;
  payload: Record<string, unknown>;
}

export interface LocalAuditLedger {
  schema_version: typeof LOCAL_AUDIT_LEDGER_SCHEMA_VERSION;
  local_only: true;
  hash_algorithm: typeof LOCAL_AUDIT_LEDGER_HASH_ALGORITHM;
  project_id: string | null;
  task_id: string | null;
  run_id: string | null;
  entry_count: number;
  root_hash: string;
  first_entry_hash: string | null;
  last_entry_hash: string | null;
  source_counts: Record<string, number>;
  generated_at: string;
  entries?: LocalAuditLedgerEntry[];
}

export interface LocalAuditLedgerVerifyResult {
  ok: boolean;
  checkpoint: LocalAuditLedgerCheckpointConfig | null;
  current: Omit<LocalAuditLedger, "entries">;
  issues: string[];
}

interface RawLedgerRow {
  source: LocalAuditLedgerSource;
  source_id: string;
  task_id: string | null;
  run_id: string | null;
  project_id: string | null;
  created_at: string;
  payload_json: string | null;
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(object[key])}`).join(",")}}`;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function parsePayload(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? redactValue(parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function bind(values: string[]): { clause: string; values: string[] } {
  return { clause: values.map(() => "?").join(","), values };
}

function scopeTaskIds(scope: LocalAuditLedgerScope, db: Database): string[] {
  if (scope.task_id) return [scope.task_id];
  if (scope.project_id) {
    return (db.query("SELECT id FROM tasks WHERE project_id = ? ORDER BY created_at, id").all(scope.project_id) as Array<{ id: string }>).map((row) => row.id);
  }
  return (db.query("SELECT id FROM tasks ORDER BY created_at, id").all() as Array<{ id: string }>).map((row) => row.id);
}

function resolveScope(input: LocalAuditLedgerScope, db: Database): Required<Pick<LocalAuditLedger, "project_id" | "task_id" | "run_id">> {
  const runId = input.run_id ? resolveTaskRunId(input.run_id, db) : null;
  const taskId = input.task_id ? resolvePartialId(db, "tasks", input.task_id) : null;
  if (input.task_id && !taskId) throw new Error(`Could not resolve task ID: ${input.task_id}`);
  const projectId = input.project_id ? resolvePartialId(db, "projects", input.project_id) : null;
  if (input.project_id && !projectId) throw new Error(`Could not resolve project ID: ${input.project_id}`);
  if (runId) {
    const run = db.query("SELECT task_id FROM task_runs WHERE id = ?").get(runId) as { task_id: string } | null;
    if (!run) throw new Error(`Run not found: ${input.run_id}`);
    return { run_id: runId, task_id: taskId ?? run.task_id, project_id: projectId };
  }
  return { run_id: null, task_id: taskId, project_id: projectId };
}

function taskScopedRows(db: Database, scope: LocalAuditLedgerScope): RawLedgerRow[] {
  const taskIds = scopeTaskIds(scope, db);
  if (taskIds.length === 0) return [];
  const bound = bind(taskIds);
  const taskWhere = `IN (${bound.clause})`;
  const params = bound.values;

  return [
    ...(db.query(`
      SELECT 'task_history' AS source, h.id AS source_id, h.task_id, NULL AS run_id, t.project_id, h.created_at,
        json_object('action', h.action, 'field', h.field, 'old_value', h.old_value, 'new_value', h.new_value, 'agent_id', h.agent_id) AS payload_json
      FROM task_history h JOIN tasks t ON t.id = h.task_id
      WHERE h.task_id ${taskWhere}
    `).all(...params) as RawLedgerRow[]),
    ...(db.query(`
      SELECT 'task_verification' AS source, v.id AS source_id, v.task_id, NULL AS run_id, t.project_id, v.created_at,
        json_object('command', v.command, 'status', v.status, 'output_summary', v.output_summary, 'artifact_path', v.artifact_path, 'agent_id', v.agent_id, 'run_at', v.run_at) AS payload_json
      FROM task_verifications v JOIN tasks t ON t.id = v.task_id
      WHERE v.task_id ${taskWhere}
    `).all(...params) as RawLedgerRow[]),
    ...(db.query(`
      SELECT 'run_event' AS source, e.id AS source_id, e.task_id, e.run_id, t.project_id, e.created_at,
        json_object('event_type', e.event_type, 'message', e.message, 'data', e.data, 'agent_id', e.agent_id) AS payload_json
      FROM task_run_events e JOIN tasks t ON t.id = e.task_id
      WHERE e.task_id ${taskWhere}
    `).all(...params) as RawLedgerRow[]),
    ...(db.query(`
      SELECT 'run_command' AS source, c.id AS source_id, c.task_id, c.run_id, t.project_id, c.created_at,
        json_object('command', c.command, 'status', c.status, 'exit_code', c.exit_code, 'output_summary', c.output_summary, 'artifact_path', c.artifact_path, 'agent_id', c.agent_id, 'started_at', c.started_at, 'completed_at', c.completed_at) AS payload_json
      FROM task_run_commands c JOIN tasks t ON t.id = c.task_id
      WHERE c.task_id ${taskWhere}
    `).all(...params) as RawLedgerRow[]),
    ...(db.query(`
      SELECT 'run_artifact' AS source, a.id AS source_id, a.task_id, a.run_id, t.project_id, a.created_at,
        json_object('path', a.path, 'artifact_type', a.artifact_type, 'description', a.description, 'size_bytes', a.size_bytes, 'sha256', a.sha256, 'metadata', a.metadata, 'agent_id', a.agent_id) AS payload_json
      FROM task_run_artifacts a JOIN tasks t ON t.id = a.task_id
      WHERE a.task_id ${taskWhere}
    `).all(...params) as RawLedgerRow[]),
    ...(db.query(`
      SELECT 'approval_gate' AS source, c.id AS source_id, c.task_id, json_extract(c.data, '$.run_id') AS run_id, t.project_id, c.updated_at AS created_at,
        json_object('step', c.step, 'status', c.status, 'data', c.data, 'error', c.error, 'agent_id', c.agent_id, 'completed_at', c.completed_at) AS payload_json
      FROM task_checkpoints c JOIN tasks t ON t.id = c.task_id
      WHERE c.step LIKE 'approval:%' AND c.task_id ${taskWhere}
    `).all(...params) as RawLedgerRow[]),
    ...(db.query(`
      SELECT 'handoff' AS source, h.id AS source_id, NULL AS task_id, NULL AS run_id, h.project_id, h.created_at,
        json_object('agent_id', h.agent_id, 'session_id', h.session_id, 'summary', h.summary, 'completed', h.completed, 'in_progress', h.in_progress, 'blockers', h.blockers, 'next_steps', h.next_steps, 'task_ids', h.task_ids, 'relevant_files', h.relevant_files, 'run_ids', h.run_ids) AS payload_json
      FROM handoffs h
      WHERE h.project_id IS NULL OR h.project_id = COALESCE(?, h.project_id)
    `).all(scope.project_id ?? null) as RawLedgerRow[]).filter((row) => {
      const payload = parsePayload(row.payload_json);
      const taskRefs = parseStringArray(payload["task_ids"]);
      const runRefs = parseStringArray(payload["run_ids"]);
      if (scope.project_id && row.project_id !== scope.project_id) return false;
      if (scope.task_id && !taskRefs.includes(scope.task_id)) return false;
      if (scope.run_id && !runRefs.includes(scope.run_id)) return false;
      return true;
    }),
  ];
}

function runScopedRows(db: Database, scope: LocalAuditLedgerScope): RawLedgerRow[] {
  if (!scope.run_id) return taskScopedRows(db, scope);
  const rows = taskScopedRows(db, scope);
  return rows.filter((row) => row.run_id === scope.run_id || row.source === "handoff");
}

function toLedgerEntries(rows: RawLedgerRow[]): LocalAuditLedgerEntry[] {
  const ordered = rows.sort((a, b) => {
    const time = a.created_at.localeCompare(b.created_at);
    if (time !== 0) return time;
    const source = a.source.localeCompare(b.source);
    if (source !== 0) return source;
    return a.source_id.localeCompare(b.source_id);
  });
  let previous = LOCAL_AUDIT_LEDGER_INITIAL_HASH;
  return ordered.map((row, index) => {
    const payload = parsePayload(row.payload_json);
    const payloadHash = hash(canonicalize({ source: row.source, source_id: row.source_id, created_at: row.created_at, payload }));
    const chainHash = hash(`${previous}\n${payloadHash}`);
    const entry: LocalAuditLedgerEntry = {
      index,
      source: row.source,
      source_id: row.source_id,
      task_id: row.task_id,
      run_id: row.run_id,
      project_id: row.project_id,
      created_at: row.created_at,
      payload_hash: payloadHash,
      previous_hash: previous,
      chain_hash: chainHash,
      payload,
    };
    previous = chainHash;
    return entry;
  });
}

export function getLocalAuditLedger(input: LocalAuditLedgerInput = {}, db?: Database): LocalAuditLedger {
  const d = getDatabase(db);
  const scope = resolveScope(input, d);
  const rows = runScopedRows(d, {
    project_id: scope.project_id ?? undefined,
    task_id: scope.task_id ?? undefined,
    run_id: scope.run_id ?? undefined,
  });
  const entries = toLedgerEntries(rows);
  const sourceCounts: Record<string, number> = {};
  for (const entry of entries) sourceCounts[entry.source] = (sourceCounts[entry.source] ?? 0) + 1;
  const root = entries.at(-1)?.chain_hash ?? LOCAL_AUDIT_LEDGER_INITIAL_HASH;
  return {
    schema_version: LOCAL_AUDIT_LEDGER_SCHEMA_VERSION,
    local_only: true,
    hash_algorithm: LOCAL_AUDIT_LEDGER_HASH_ALGORITHM,
    project_id: scope.project_id,
    task_id: scope.task_id,
    run_id: scope.run_id,
    entry_count: entries.length,
    root_hash: root,
    first_entry_hash: entries[0]?.chain_hash ?? null,
    last_entry_hash: entries.at(-1)?.chain_hash ?? null,
    source_counts: sourceCounts,
    generated_at: now(),
    ...(input.include_entries === false ? {} : { entries }),
  };
}

export function sealLocalAuditLedger(input: SealLocalAuditLedgerInput, db?: Database): LocalAuditLedgerCheckpointConfig {
  const ledger = getLocalAuditLedger({ ...input, include_entries: false }, db);
  const config = loadConfig();
  const id = uuid();
  const checkpoint: LocalAuditLedgerCheckpointConfig = {
    id,
    name: input.name.trim() || id,
    project_id: ledger.project_id,
    task_id: ledger.task_id,
    run_id: ledger.run_id,
    agent_id: input.agent_id ?? null,
    note: input.note ?? null,
    entry_count: ledger.entry_count,
    root_hash: ledger.root_hash,
    first_entry_hash: ledger.first_entry_hash,
    last_entry_hash: ledger.last_entry_hash,
    source_counts: ledger.source_counts,
    created_at: now(),
  };
  saveConfig({
    ...config,
    local_audit_ledgers: {
      checkpoints: {
        ...(config.local_audit_ledgers?.checkpoints ?? {}),
        [checkpoint.id]: checkpoint,
      },
    },
  });
  return checkpoint;
}

export function listLocalAuditLedgerCheckpoints(): LocalAuditLedgerCheckpointConfig[] {
  const checkpoints = Object.values(loadConfig().local_audit_ledgers?.checkpoints ?? {});
  return checkpoints.sort((a, b) => b.created_at.localeCompare(a.created_at) || a.name.localeCompare(b.name));
}

export function verifyLocalAuditLedger(checkpointIdOrName: string, db?: Database): LocalAuditLedgerVerifyResult {
  const checkpoints = listLocalAuditLedgerCheckpoints();
  const checkpoint = checkpoints.find((item) => item.id === checkpointIdOrName || item.id.startsWith(checkpointIdOrName) || item.name === checkpointIdOrName) ?? null;
  if (!checkpoint) {
    const current = getLocalAuditLedger({ include_entries: false }, db);
    return { ok: false, checkpoint: null, current, issues: [`Audit ledger checkpoint not found: ${checkpointIdOrName}`] };
  }
  const current = getLocalAuditLedger({
    project_id: checkpoint.project_id ?? undefined,
    task_id: checkpoint.task_id ?? undefined,
    run_id: checkpoint.run_id ?? undefined,
    include_entries: false,
  }, db);
  const issues: string[] = [];
  if (current.entry_count !== checkpoint.entry_count) issues.push(`entry_count changed: expected ${checkpoint.entry_count}, got ${current.entry_count}`);
  if (current.root_hash !== checkpoint.root_hash) issues.push("root_hash changed");
  if (current.first_entry_hash !== checkpoint.first_entry_hash) issues.push("first_entry_hash changed");
  if (current.last_entry_hash !== checkpoint.last_entry_hash) issues.push("last_entry_hash changed");
  return { ok: issues.length === 0, checkpoint, current, issues };
}

export function renderLocalAuditLedgerMarkdown(ledger: LocalAuditLedger | LocalAuditLedgerVerifyResult): string {
  if ("ok" in ledger) {
    return [
      `# Local Audit Ledger Verification`,
      ``,
      `Status: ${ledger.ok ? "ok" : "failed"}`,
      `Checkpoint: ${ledger.checkpoint?.name ?? "missing"}`,
      `Root hash: ${ledger.current.root_hash}`,
      `Entries: ${ledger.current.entry_count}`,
      ...(ledger.issues.length ? [``, `## Issues`, ...ledger.issues.map((issue) => `- ${issue}`)] : []),
    ].join("\n");
  }
  return [
    `# Local Audit Ledger`,
    ``,
    `Scope: ${ledger.run_id ?? ledger.task_id ?? ledger.project_id ?? "all local evidence"}`,
    `Root hash: ${ledger.root_hash}`,
    `Entries: ${ledger.entry_count}`,
    `Sources: ${Object.entries(ledger.source_counts).map(([source, count]) => `${source}=${count}`).join(", ") || "none"}`,
  ].join("\n");
}
