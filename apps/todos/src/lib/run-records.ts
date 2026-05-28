/**
 * First-class local run records — objectives, commands, logs, files, replay.
 * All data stored locally; stdout/stderr redacted before persistence.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import type { Database } from "bun:sqlite";
import { getDatabase, now, uuid } from "../db/database.js";
import { redactText } from "./secret-redaction.js";

export const RUN_RECORD_SCHEMA = "todos.run_record.v1";

export const RUN_RECORD_STATUSES = ["active", "completed", "failed", "archived"] as const;
export type RunRecordStatus = (typeof RUN_RECORD_STATUSES)[number];

export interface RunCommandEntry {
  command: string;
  exit_code?: number;
  at: string;
  duration_ms?: number;
}

export interface RunStatusTransition {
  from: RunRecordStatus | null;
  to: RunRecordStatus;
  at: string;
  note?: string;
}

export interface RunVerificationRef {
  record_id: string;
  provider: string;
  status: string;
  at: string;
}

export interface RunRecord {
  schema_version: typeof RUN_RECORD_SCHEMA;
  id: string;
  agent_run_id: string | null;
  agent_id: string | null;
  objective: string | null;
  plan_id: string | null;
  claimed_task_ids: string[];
  commands: RunCommandEntry[];
  stdout_summary: string | null;
  stderr_summary: string | null;
  files_touched: string[];
  verification_results: RunVerificationRef[];
  artifact_ids: string[];
  status_transitions: RunStatusTransition[];
  status: RunRecordStatus;
  replay_bundle: string | null;
  metadata: Record<string, unknown>;
  started_at: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateRunRecordInput {
  agent_run_id?: string;
  agent_id?: string;
  objective?: string;
  plan_id?: string;
  claimed_task_ids?: string[];
  metadata?: Record<string, unknown>;
}

export interface ListRunRecordsFilter {
  agent_run_id?: string;
  agent_id?: string;
  plan_id?: string;
  status?: RunRecordStatus;
  limit?: number;
  offset?: number;
}

export interface RunReplayBundle {
  schema_version: typeof RUN_RECORD_SCHEMA;
  exported_at: string;
  record: RunRecord;
}

function parseJsonArray<T>(raw: string | null | undefined, fallback: T[] = []): T[] {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as T[] : fallback;
  } catch {
    return fallback;
  }
}

function rowToRunRecord(row: Record<string, unknown>): RunRecord {
  return {
    schema_version: RUN_RECORD_SCHEMA,
    id: row.id as string,
    agent_run_id: (row.agent_run_id as string) ?? null,
    agent_id: (row.agent_id as string) ?? null,
    objective: (row.objective as string) ?? null,
    plan_id: (row.plan_id as string) ?? null,
    claimed_task_ids: parseJsonArray<string>(row.claimed_task_ids as string),
    commands: parseJsonArray<RunCommandEntry>(row.commands as string),
    stdout_summary: (row.stdout_summary as string) ?? null,
    stderr_summary: (row.stderr_summary as string) ?? null,
    files_touched: parseJsonArray<string>(row.files_touched as string),
    verification_results: parseJsonArray<RunVerificationRef>(row.verification_results as string),
    artifact_ids: parseJsonArray<string>(row.artifact_ids as string),
    status_transitions: parseJsonArray<RunStatusTransition>(row.status_transitions as string),
    status: row.status as RunRecordStatus,
    replay_bundle: (row.replay_bundle as string) ?? null,
    metadata: row.metadata ? JSON.parse(row.metadata as string) : {},
    started_at: row.started_at as string,
    completed_at: (row.completed_at as string) ?? null,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

function summarizeOutput(text: string, maxLen = 4000): string {
  const redacted = redactText(text);
  if (redacted.length <= maxLen) return redacted;
  return `${redacted.slice(0, maxLen)}\n… [truncated ${redacted.length - maxLen} chars]`;
}

function appendTransition(
  record: RunRecord,
  to: RunRecordStatus,
  note?: string,
): RunStatusTransition[] {
  return [
    ...record.status_transitions,
    { from: record.status, to, at: now(), note },
  ];
}

export function createRunRecord(input: CreateRunRecordInput = {}, db?: Database): RunRecord {
  const d = db || getDatabase();
  const id = uuid();
  const ts = now();
  const transitions: RunStatusTransition[] = [{ from: null, to: "active", at: ts, note: "run started" }];

  d.run(
    `INSERT INTO run_records (
      id, agent_run_id, agent_id, objective, plan_id, claimed_task_ids,
      commands, status_transitions, status, metadata, started_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, '[]', ?, 'active', ?, ?, ?, ?)`,
    [
      id,
      input.agent_run_id ?? null,
      input.agent_id ?? null,
      input.objective ?? null,
      input.plan_id ?? null,
      JSON.stringify(input.claimed_task_ids ?? []),
      JSON.stringify(transitions),
      JSON.stringify(input.metadata ?? {}),
      ts,
      ts,
      ts,
    ],
  );

  return getRunRecord(id, d)!;
}

export function getRunRecord(id: string, db?: Database): RunRecord | null {
  const d = db || getDatabase();
  const row = d.query("SELECT * FROM run_records WHERE id = ?").get(id) as Record<string, unknown> | null;
  return row ? rowToRunRecord(row) : null;
}

export function listRunRecords(filter: ListRunRecordsFilter = {}, db?: Database): RunRecord[] {
  const d = db || getDatabase();
  const conditions: string[] = ["1=1"];
  const params: unknown[] = [];

  if (filter.agent_run_id) {
    conditions.push("agent_run_id = ?");
    params.push(filter.agent_run_id);
  }
  if (filter.agent_id) {
    conditions.push("agent_id = ?");
    params.push(filter.agent_id);
  }
  if (filter.plan_id) {
    conditions.push("plan_id = ?");
    params.push(filter.plan_id);
  }
  if (filter.status) {
    conditions.push("status = ?");
    params.push(filter.status);
  }

  const limit = filter.limit ?? 50;
  const offset = filter.offset ?? 0;
  const sql = `SELECT * FROM run_records WHERE ${conditions.join(" AND ")} ORDER BY started_at DESC LIMIT ? OFFSET ?`;
  const rows = d.query(sql).all(...[...params, limit, offset] as any) as Record<string, unknown>[];
  return rows.map(rowToRunRecord);
}

export function appendRunCommand(
  id: string,
  command: string,
  options: { exit_code?: number; duration_ms?: number; stdout?: string; stderr?: string } = {},
  db?: Database,
): RunRecord {
  const d = db || getDatabase();
  const record = getRunRecord(id, d);
  if (!record) throw new Error(`Run record not found: ${id}`);

  const commands = [
    ...record.commands,
    { command, exit_code: options.exit_code, duration_ms: options.duration_ms, at: now() },
  ];

  let stdout = record.stdout_summary ?? "";
  let stderr = record.stderr_summary ?? "";
  if (options.stdout) stdout = stdout ? `${stdout}\n${options.stdout}` : options.stdout;
  if (options.stderr) stderr = stderr ? `${stderr}\n${options.stderr}` : options.stderr;

  const ts = now();
  d.run(
    `UPDATE run_records SET commands = ?, stdout_summary = ?, stderr_summary = ?, updated_at = ? WHERE id = ?`,
    [
      JSON.stringify(commands),
      stdout ? summarizeOutput(stdout) : null,
      stderr ? summarizeOutput(stderr) : null,
      ts,
      id,
    ],
  );

  return getRunRecord(id, d)!;
}

export function recordFilesTouched(id: string, paths: string[], db?: Database): RunRecord {
  const d = db || getDatabase();
  const record = getRunRecord(id, d);
  if (!record) throw new Error(`Run record not found: ${id}`);

  const merged = [...new Set([...record.files_touched, ...paths])].slice(0, 500);
  d.run(
    `UPDATE run_records SET files_touched = ?, updated_at = ? WHERE id = ?`,
    [JSON.stringify(merged), now(), id],
  );
  return getRunRecord(id, d)!;
}

export function linkRunVerification(
  id: string,
  ref: Omit<RunVerificationRef, "at"> & { at?: string },
  db?: Database,
): RunRecord {
  const d = db || getDatabase();
  const record = getRunRecord(id, d);
  if (!record) throw new Error(`Run record not found: ${id}`);

  const results = [...record.verification_results, { ...ref, at: ref.at ?? now() }];
  d.run(
    `UPDATE run_records SET verification_results = ?, updated_at = ? WHERE id = ?`,
    [JSON.stringify(results), now(), id],
  );
  return getRunRecord(id, d)!;
}

export function linkRunArtifact(id: string, artifactId: string, db?: Database): RunRecord {
  const d = db || getDatabase();
  const record = getRunRecord(id, d);
  if (!record) throw new Error(`Run record not found: ${id}`);

  const ids = [...new Set([...record.artifact_ids, artifactId])];
  d.run(
    `UPDATE run_records SET artifact_ids = ?, updated_at = ? WHERE id = ?`,
    [JSON.stringify(ids), now(), id],
  );
  return getRunRecord(id, d)!;
}

export function completeRunRecord(id: string, note?: string, db?: Database): RunRecord {
  const d = db || getDatabase();
  const record = getRunRecord(id, d);
  if (!record) throw new Error(`Run record not found: ${id}`);

  const ts = now();
  const transitions = appendTransition(record, "completed", note);
  d.run(
    `UPDATE run_records SET status = 'completed', status_transitions = ?, completed_at = ?, updated_at = ? WHERE id = ?`,
    [JSON.stringify(transitions), ts, ts, id],
  );
  return getRunRecord(id, d)!;
}

export function failRunRecord(id: string, error: string, db?: Database): RunRecord {
  const d = db || getDatabase();
  const record = getRunRecord(id, d);
  if (!record) throw new Error(`Run record not found: ${id}`);

  const ts = now();
  const transitions = appendTransition(record, "failed", error);
  const stderr = record.stderr_summary
    ? `${record.stderr_summary}\n${error}`
    : error;

  d.run(
    `UPDATE run_records SET status = 'failed', status_transitions = ?, stderr_summary = ?, completed_at = ?, updated_at = ? WHERE id = ?`,
    [JSON.stringify(transitions), summarizeOutput(stderr), ts, ts, id],
  );
  return getRunRecord(id, d)!;
}

export function buildRunReplayBundle(id: string, db?: Database): RunReplayBundle {
  const record = getRunRecord(id, db);
  if (!record) throw new Error(`Run record not found: ${id}`);
  return {
    schema_version: RUN_RECORD_SCHEMA,
    exported_at: now(),
    record,
  };
}

export function exportRunReplay(
  id: string,
  outputPath?: string,
  db?: Database,
): { path: string; bundle: RunReplayBundle } {
  const bundle = buildRunReplayBundle(id, db);
  const path = outputPath ?? join(process.cwd(), ".todos", "replays", `${id.slice(0, 8)}.json`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(bundle, null, 2));
  const d = db || getDatabase();
  d.run(`UPDATE run_records SET replay_bundle = ?, updated_at = ? WHERE id = ?`, [path, now(), id]);
  return { path, bundle };
}

export function formatRunRecordMarkdown(record: RunRecord): string {
  const lines = [
    `# Run Record ${record.id.slice(0, 8)}`,
    "",
    `- **Status:** ${record.status}`,
    `- **Agent:** ${record.agent_id ?? "—"}`,
    `- **Objective:** ${record.objective ?? "—"}`,
    `- **Started:** ${record.started_at}`,
    record.completed_at ? `- **Completed:** ${record.completed_at}` : null,
    "",
    "## Commands",
    ...record.commands.map((c) => `- \`${c.command}\`${c.exit_code != null ? ` (exit ${c.exit_code})` : ""}`),
    "",
    "## Files Touched",
    ...(record.files_touched.length ? record.files_touched.map((f) => `- ${f}`) : ["- (none)"]),
    "",
    "## Verification",
    ...(record.verification_results.length
      ? record.verification_results.map((v) => `- ${v.provider}: ${v.status} (${v.record_id.slice(0, 8)})`)
      : ["- (none)"]),
    "",
    "## Artifacts",
    ...(record.artifact_ids.length ? record.artifact_ids.map((a) => `- ${a.slice(0, 8)}`) : ["- (none)"]),
  ].filter(Boolean) as string[];

  if (record.stdout_summary) {
    lines.push("", "## Stdout Summary", "", "```", record.stdout_summary.slice(0, 2000), "```");
  }
  if (record.stderr_summary) {
    lines.push("", "## Stderr Summary", "", "```", record.stderr_summary.slice(0, 2000), "```");
  }

  return lines.join("\n") + "\n";
}

export function getDefaultReplayDir(): string {
  const local = join(process.cwd(), ".todos", "replays");
  if (existsSync(join(process.cwd(), ".todos"))) return local;
  const home = process.env["HOME"] || "~";
  return join(home, ".hasna", "todos", "replays");
}
