import type { Database } from "bun:sqlite";
import { storeArtifactContent, verifyStoredArtifact, type ArtifactIntegrityReport } from "../lib/artifact-store.js";
import { databasePathFromDatabase } from "../lib/event-emission-safety.js";
import { emitLocalEventHooksQuiet } from "../lib/event-hooks.js";
import { redactEvidenceText, redactValue } from "../lib/redaction.js";
import { TaskNotFoundError } from "../types/index.js";
import { addComment } from "./comments.js";
import { getDatabase, now, uuid } from "./database.js";
import { addTaskFile, type TaskFile } from "./task-files.js";
import { addTaskVerification } from "./task-commits.js";
import { startTask } from "./task-lifecycle.js";
import { getTask } from "./tasks.js";

export const LOOP_RUN_TRANSACTION_SCHEMA_VERSION = "todos.loop_run_transaction.v1";

export type TaskRunStatus = "running" | "completed" | "failed" | "cancelled";
export type TaskRunEventType =
  | "started"
  | "progress"
  | "claim"
  | "comment"
  | "command"
  | "file"
  | "artifact"
  | "completed"
  | "failed"
  | "cancelled";
export type TaskRunCommandStatus = "passed" | "failed" | "unknown";

export interface TaskRun {
  id: string;
  task_id: string;
  agent_id: string | null;
  title: string | null;
  status: TaskRunStatus;
  summary: string | null;
  metadata: Record<string, unknown>;
  started_at: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TaskRunEvent {
  id: string;
  run_id: string;
  task_id: string;
  event_type: TaskRunEventType;
  message: string | null;
  data: Record<string, unknown>;
  agent_id: string | null;
  created_at: string;
}

export interface TaskRunCommand {
  id: string;
  run_id: string;
  task_id: string;
  command: string;
  status: TaskRunCommandStatus;
  exit_code: number | null;
  output_summary: string | null;
  artifact_path: string | null;
  agent_id: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface TaskRunArtifact {
  id: string;
  run_id: string;
  task_id: string;
  path: string;
  artifact_type: string | null;
  description: string | null;
  size_bytes: number | null;
  sha256: string | null;
  metadata: Record<string, unknown>;
  agent_id: string | null;
  created_at: string;
}

export interface TaskRunLedger {
  run: TaskRun;
  events: TaskRunEvent[];
  commands: TaskRunCommand[];
  artifacts: TaskRunArtifact[];
  files: TaskFile[];
}

export interface CompactTaskRun {
  id: string;
  task_id: string;
  agent_id: string | null;
  title: string | null;
  status: TaskRunStatus;
  summary: string | null;
  idempotency_key: string | null;
  loop_id: string | null;
  loop_run_id: string | null;
  metadata_keys: string[];
  started_at: string;
  completed_at: string | null;
  updated_at: string;
}

export type LoopRunTransactionAction = "preview" | "created" | "matched" | "finished" | "conflict";

export interface LoopRunTransactionResult {
  schema_version: typeof LOOP_RUN_TRANSACTION_SCHEMA_VERSION;
  local_only: true;
  dry_run: boolean;
  processed_at: string;
  action: LoopRunTransactionAction;
  key: string;
  run: CompactTaskRun | null;
  warnings: string[];
  commands: string[];
}

export interface BeginTaskRunTransactionInput {
  task_id: string;
  key?: string;
  loop_id?: string;
  loop_run_id?: string;
  agent_id?: string;
  title?: string;
  summary?: string;
  metadata?: Record<string, unknown>;
  claim?: boolean;
  apply?: boolean;
  started_at?: string;
}

export interface FinishTaskRunTransactionInput {
  run_id?: string;
  key?: string;
  task_id?: string;
  status?: Exclude<TaskRunStatus, "running">;
  summary?: string;
  agent_id?: string;
  apply?: boolean;
  completed_at?: string;
}

interface TaskRunRow extends Omit<TaskRun, "metadata"> {
  metadata: string | null;
}

interface TaskRunEventRow extends Omit<TaskRunEvent, "data"> {
  data: string | null;
}

interface TaskRunArtifactRow extends Omit<TaskRunArtifact, "metadata"> {
  metadata: string | null;
}

interface TaskRunTransactionRow {
  id: string;
  task_id: string;
  run_id: string | null;
  key: string;
  loop_id: string | null;
  loop_run_id: string | null;
  metadata: string | null;
  created_at: string;
  updated_at: string;
}

function parseObject(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export { redactEvidenceText } from "../lib/redaction.js";

function rowToRun(row: TaskRunRow): TaskRun {
  return { ...row, metadata: parseObject(row.metadata) };
}

function rowToEvent(row: TaskRunEventRow): TaskRunEvent {
  return { ...row, data: parseObject(row.data) };
}

function rowToArtifact(row: TaskRunArtifactRow): TaskRunArtifact {
  return { ...row, metadata: parseObject(row.metadata) };
}

function getRunRow(runId: string, db: Database): TaskRunRow | null {
  return db.query("SELECT * FROM task_runs WHERE id = ?").get(runId) as TaskRunRow | null;
}

function normalizeTransactionKey(input: { key?: string; loop_run_id?: string; loop_id?: string }): string {
  const key = (input.key || input.loop_run_id || input.loop_id || "").trim();
  if (!key) throw new Error("idempotent run transactions require --key, --loop-run-id, or --loop-id");
  return key.toLowerCase().replace(/[^a-z0-9._:/-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 240);
}

function loopTransactionMetadata(record: TaskRun): Record<string, unknown> {
  const value = record.metadata["loop_transaction"];
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function runKey(record: TaskRun): string | null {
  const tx = loopTransactionMetadata(record);
  const key = tx["idempotency_key"] ?? record.metadata["idempotency_key"];
  return typeof key === "string" ? key : null;
}

function loopId(record: TaskRun): string | null {
  const tx = loopTransactionMetadata(record);
  const value = tx["loop_id"] ?? record.metadata["loop_id"];
  return typeof value === "string" ? value : null;
}

function loopRunId(record: TaskRun): string | null {
  const tx = loopTransactionMetadata(record);
  const value = tx["loop_run_id"] ?? record.metadata["loop_run_id"];
  return typeof value === "string" ? value : null;
}

function getTaskRunTransactionByKey(key: string, taskId: string | undefined, db: Database): TaskRunTransactionRow | null {
  if (taskId) {
    return db
      .query("SELECT * FROM task_run_transactions WHERE task_id = ? AND key = ?")
      .get(taskId, key) as TaskRunTransactionRow | null;
  }
  const rows = db
    .query("SELECT * FROM task_run_transactions WHERE key = ? ORDER BY created_at DESC LIMIT 2")
    .all(key) as TaskRunTransactionRow[];
  if (rows.length > 1) throw new Error(`Run transaction key is ambiguous across tasks: ${key}. Pass task_id.`);
  return rows[0] ?? null;
}

export function summarizeTaskRun(run: TaskRun): CompactTaskRun {
  return {
    id: run.id,
    task_id: run.task_id,
    agent_id: run.agent_id,
    title: run.title,
    status: run.status,
    summary: run.summary,
    idempotency_key: runKey(run),
    loop_id: loopId(run),
    loop_run_id: loopRunId(run),
    metadata_keys: Object.keys(run.metadata).sort(),
    started_at: run.started_at,
    completed_at: run.completed_at,
    updated_at: run.updated_at,
  };
}

export function findTaskRunByTransactionKey(
  key: string,
  taskId?: string,
  db?: Database,
): TaskRun | null {
  const d = db || getDatabase();
  const normalized = normalizeTransactionKey({ key });
  const transaction = getTaskRunTransactionByKey(normalized, taskId, d);
  if (transaction?.run_id) return getTaskRun(transaction.run_id, d);
  return null;
}

function loopRunCommands(run: TaskRun | null, key: string): string[] {
  return [
    run ? `todos runs show ${run.id.slice(0, 8)}` : "todos runs list",
    run ? `todos findings list --task ${run.task_id.slice(0, 8)} --json` : "todos findings list --json",
    `todos runs begin <task-id> --key ${key} --apply --json`,
  ];
}

export function resolveTaskRunId(idOrPrefix: string, db?: Database): string {
  const d = db || getDatabase();
  const rows = d
    .query("SELECT id FROM task_runs WHERE id = ? OR id LIKE ? ORDER BY created_at DESC LIMIT 2")
    .all(idOrPrefix, `${idOrPrefix}%`) as Array<{ id: string }>;
  if (rows.length === 0) throw new Error(`Run not found: ${idOrPrefix}`);
  if (rows.length > 1) throw new Error(`Run ID is ambiguous: ${idOrPrefix}`);
  return rows[0]!.id;
}

export function getTaskRun(runId: string, db?: Database): TaskRun | null {
  const d = db || getDatabase();
  const row = getRunRow(runId, d);
  return row ? rowToRun(row) : null;
}

export interface StartTaskRunInput {
  task_id: string;
  id?: string;
  agent_id?: string;
  title?: string;
  summary?: string;
  metadata?: Record<string, unknown>;
  claim?: boolean;
  started_at?: string;
}

export function startTaskRun(input: StartTaskRunInput, db?: Database): TaskRun {
  const d = db || getDatabase();
  if (!getTask(input.task_id, d)) throw new TaskNotFoundError(input.task_id);
  const id = input.id ?? uuid();
  const timestamp = input.started_at || now();

  if (input.claim && input.agent_id) {
    startTask(input.task_id, input.agent_id, d);
  }

  d.run(
    "INSERT INTO task_runs (id, task_id, agent_id, title, status, summary, metadata, started_at, created_at, updated_at) VALUES (?, ?, ?, ?, 'running', ?, ?, ?, ?, ?)",
    [
      id,
      input.task_id,
      input.agent_id ?? null,
      input.title ? redactEvidenceText(input.title) : null,
      input.summary ? redactEvidenceText(input.summary) : null,
      JSON.stringify(redactValue(input.metadata || {})),
      timestamp,
      timestamp,
      timestamp,
    ],
  );

  addTaskRunEvent({
    run_id: id,
    event_type: "started",
    message: input.summary || input.title || "run started",
    data: { title: input.title, claim: Boolean(input.claim) },
    agent_id: input.agent_id,
    created_at: timestamp,
  }, d);

  if (input.claim && input.agent_id) {
    addTaskRunEvent({
      run_id: id,
      event_type: "claim",
      message: `claimed by ${input.agent_id}`,
      data: { agent_id: input.agent_id },
      agent_id: input.agent_id,
      created_at: timestamp,
    }, d);
  }

  const run = getTaskRun(id, d)!;
  emitLocalEventHooksQuiet({
    type: "run.started",
    payload: { id: run.id, task_id: run.task_id, agent_id: run.agent_id, title: run.title },
    databasePath: databasePathFromDatabase(d),
  });
  return run;
}

export function beginTaskRunTransaction(
  input: BeginTaskRunTransactionInput,
  db?: Database,
): LoopRunTransactionResult {
  const d = db || getDatabase();
  if (!getTask(input.task_id, d)) throw new TaskNotFoundError(input.task_id);
  const timestamp = input.started_at || now();
  const key = normalizeTransactionKey(input);
  const existing = findTaskRunByTransactionKey(key, input.task_id, d);
  const dryRun = !input.apply;

  if (existing) {
    return {
      schema_version: LOOP_RUN_TRANSACTION_SCHEMA_VERSION,
      local_only: true,
      dry_run: dryRun,
      processed_at: timestamp,
      action: "matched",
      key,
      run: summarizeTaskRun(existing),
      warnings: existing.status === "running" ? [] : [`matched ${existing.status} run`],
      commands: loopRunCommands(existing, key),
    };
  }

  if (dryRun) {
    return {
      schema_version: LOOP_RUN_TRANSACTION_SCHEMA_VERSION,
      local_only: true,
      dry_run: true,
      processed_at: timestamp,
      action: "preview",
      key,
      run: null,
      warnings: [],
      commands: loopRunCommands(null, key),
    };
  }

  const metadata = redactValue({
    ...(input.metadata || {}),
    loop_transaction: {
      schema_version: LOOP_RUN_TRANSACTION_SCHEMA_VERSION,
      idempotency_key: key,
      loop_id: input.loop_id ?? null,
      loop_run_id: input.loop_run_id ?? null,
      first_seen_at: timestamp,
    },
    idempotency_key: key,
  });
  const created = d.transaction(() => {
    d.run(
      `INSERT OR IGNORE INTO task_run_transactions (
        id, task_id, run_id, key, loop_id, loop_run_id, metadata, created_at, updated_at
      ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
      [
        uuid(),
        input.task_id,
        key,
        input.loop_id ?? null,
        input.loop_run_id ?? null,
        JSON.stringify(metadata),
        timestamp,
        timestamp,
      ],
    );
    const transaction = getTaskRunTransactionByKey(key, input.task_id, d);
    if (!transaction) throw new Error(`Could not create run transaction for key: ${key}`);
    if (transaction.run_id) {
      const existingRun = getTaskRun(transaction.run_id, d);
      if (existingRun) return { run: existingRun, action: "matched" as const };
    }
    const run = startTaskRun({
      id: uuid(),
      task_id: input.task_id,
      agent_id: input.agent_id,
      title: input.title,
      summary: input.summary,
      metadata,
      claim: input.claim,
      started_at: timestamp,
    }, d);
    d.run(
      "UPDATE task_run_transactions SET run_id = ?, loop_id = COALESCE(?, loop_id), loop_run_id = COALESCE(?, loop_run_id), metadata = ?, updated_at = ? WHERE id = ?",
      [run.id, input.loop_id ?? null, input.loop_run_id ?? null, JSON.stringify(metadata), timestamp, transaction.id],
    );
    return { run, action: "created" as const };
  })();

  return {
    schema_version: LOOP_RUN_TRANSACTION_SCHEMA_VERSION,
    local_only: true,
    dry_run: false,
    processed_at: timestamp,
    action: created.action,
    key,
    run: summarizeTaskRun(created.run),
    warnings: [],
    commands: loopRunCommands(created.run, key),
  };
}

export interface AddTaskRunEventInput {
  run_id: string;
  event_type: TaskRunEventType;
  message?: string;
  data?: Record<string, unknown>;
  agent_id?: string;
  created_at?: string;
}

export function addTaskRunEvent(input: AddTaskRunEventInput, db?: Database): TaskRunEvent {
  const d = db || getDatabase();
  const runId = resolveTaskRunId(input.run_id, d);
  const run = getTaskRun(runId, d);
  if (!run) throw new Error(`Run not found: ${input.run_id}`);
  const id = uuid();
  const timestamp = input.created_at || now();
  d.run(
    "INSERT INTO task_run_events (id, run_id, task_id, event_type, message, data, agent_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [
      id,
      run.id,
      run.task_id,
      input.event_type,
      input.message ? redactEvidenceText(input.message) : null,
      JSON.stringify(redactValue(input.data || {})),
      input.agent_id ?? run.agent_id,
      timestamp,
    ],
  );

  if (input.event_type === "comment" && input.message) {
    addComment({ task_id: run.task_id, content: redactEvidenceText(input.message), type: "comment", agent_id: input.agent_id ?? run.agent_id ?? undefined }, d);
  }

  return rowToEvent(d.query("SELECT * FROM task_run_events WHERE id = ?").get(id) as TaskRunEventRow);
}

export interface AddTaskRunCommandInput {
  run_id: string;
  command: string;
  status?: TaskRunCommandStatus;
  exit_code?: number;
  output_summary?: string;
  artifact_path?: string;
  tokens?: number;
  cost_usd?: number;
  duration_ms?: number;
  agent_id?: string;
  started_at?: string;
  completed_at?: string;
}

export function addTaskRunCommand(input: AddTaskRunCommandInput, db?: Database): TaskRunCommand {
  const d = db || getDatabase();
  const runId = resolveTaskRunId(input.run_id, d);
  const run = getTaskRun(runId, d);
  if (!run) throw new Error(`Run not found: ${input.run_id}`);
  const id = uuid();
  const status = input.status || "unknown";
  const timestamp = now();
  const command = redactEvidenceText(input.command);
  const outputSummary = input.output_summary ? redactEvidenceText(input.output_summary) : null;
  const artifactPath = input.artifact_path ? redactEvidenceText(input.artifact_path) : null;

  d.run(
    "INSERT INTO task_run_commands (id, run_id, task_id, command, status, exit_code, output_summary, artifact_path, agent_id, started_at, completed_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      id,
      run.id,
      run.task_id,
      command,
      status,
      input.exit_code ?? null,
      outputSummary,
      artifactPath,
      input.agent_id ?? run.agent_id,
      input.started_at ?? null,
      input.completed_at ?? timestamp,
      timestamp,
    ],
  );

  addTaskVerification({
    task_id: run.task_id,
    command,
    status,
    output_summary: outputSummary ?? undefined,
    artifact_path: artifactPath ?? undefined,
    agent_id: input.agent_id ?? run.agent_id ?? undefined,
    run_at: input.completed_at ?? timestamp,
  }, d);

  addTaskRunEvent({
    run_id: run.id,
    event_type: "command",
    message: `${status}: ${command}`,
    data: {
      command,
      status,
      exit_code: input.exit_code ?? null,
      output_summary: outputSummary,
      artifact_path: artifactPath,
      usage: {
        tokens: input.tokens ?? null,
        cost_usd: input.cost_usd ?? null,
        duration_ms: input.duration_ms ?? null,
      },
    },
    agent_id: input.agent_id ?? run.agent_id ?? undefined,
    created_at: timestamp,
  }, d);

  return d.query("SELECT * FROM task_run_commands WHERE id = ?").get(id) as TaskRunCommand;
}

export interface AddTaskRunFileInput {
  run_id: string;
  path: string;
  status?: TaskFile["status"];
  note?: string;
  agent_id?: string;
}

export function addTaskRunFile(input: AddTaskRunFileInput, db?: Database): TaskFile {
  const d = db || getDatabase();
  const runId = resolveTaskRunId(input.run_id, d);
  const run = getTaskRun(runId, d);
  if (!run) throw new Error(`Run not found: ${input.run_id}`);
  const file = addTaskFile({
    task_id: run.task_id,
    path: input.path,
    status: input.status || "modified",
    note: input.note ? redactEvidenceText(input.note) : undefined,
    agent_id: input.agent_id ?? run.agent_id ?? undefined,
  }, d);
  addTaskRunEvent({
    run_id: run.id,
    event_type: "file",
    message: `${file.status}: ${file.path}`,
    data: { path: file.path, status: file.status, note: file.note },
    agent_id: input.agent_id ?? run.agent_id ?? undefined,
  }, d);
  return file;
}

export interface AddTaskRunArtifactInput {
  run_id: string;
  path: string;
  artifact_type?: string;
  description?: string;
  size_bytes?: number;
  sha256?: string;
  metadata?: Record<string, unknown>;
  store_content?: boolean;
  retention_days?: number;
  agent_id?: string;
}

export function addTaskRunArtifact(input: AddTaskRunArtifactInput, db?: Database): TaskRunArtifact {
  const d = db || getDatabase();
  const runId = resolveTaskRunId(input.run_id, d);
  const run = getTaskRun(runId, d);
  if (!run) throw new Error(`Run not found: ${input.run_id}`);
  const id = uuid();
  const timestamp = now();
  const path = redactEvidenceText(input.path);
  const description = input.description ? redactEvidenceText(input.description) : null;
  const metadata = redactValue(input.metadata || {});
  let sizeBytes = input.size_bytes ?? null;
  let digest = input.sha256 ?? null;
  const stored = input.store_content !== false
    ? storeArtifactContent({ path: input.path, metadata, retention_days: input.retention_days, created_at: timestamp })
    : null;
  if (stored) {
    sizeBytes = stored.size_bytes;
    digest = stored.sha256;
    metadata["artifact_store"] = stored.store;
  } else if (input.store_content === true) {
    throw new Error(`Artifact file not found: ${input.path}`);
  }
  d.run(
    "INSERT INTO task_run_artifacts (id, run_id, task_id, path, artifact_type, description, size_bytes, sha256, metadata, agent_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      id,
      run.id,
      run.task_id,
      path,
      input.artifact_type ?? null,
      description,
      sizeBytes,
      digest,
      JSON.stringify(metadata),
      input.agent_id ?? run.agent_id,
      timestamp,
    ],
  );
  addTaskRunEvent({
    run_id: run.id,
    event_type: "artifact",
    message: description || path,
    data: { path, artifact_type: input.artifact_type, size_bytes: sizeBytes, sha256: digest, stored: Boolean(stored) },
    agent_id: input.agent_id ?? run.agent_id ?? undefined,
    created_at: timestamp,
  }, d);
  return rowToArtifact(d.query("SELECT * FROM task_run_artifacts WHERE id = ?").get(id) as TaskRunArtifactRow);
}

export function verifyTaskRunArtifacts(runId: string, db?: Database): ArtifactIntegrityReport[] {
  const ledger = getTaskRunLedger(runId, db);
  return ledger.artifacts.map((artifact) => verifyStoredArtifact({
    id: artifact.id,
    path: artifact.path,
    size_bytes: artifact.size_bytes,
    sha256: artifact.sha256,
    metadata: artifact.metadata,
  }));
}

export interface FinishTaskRunInput {
  run_id: string;
  status: Exclude<TaskRunStatus, "running">;
  summary?: string;
  agent_id?: string;
  completed_at?: string;
}

export function finishTaskRun(input: FinishTaskRunInput, db?: Database): TaskRun {
  const d = db || getDatabase();
  const runId = resolveTaskRunId(input.run_id, d);
  const run = getTaskRun(runId, d);
  if (!run) throw new Error(`Run not found: ${input.run_id}`);
  const timestamp = input.completed_at || now();
  const summary = input.summary ? redactEvidenceText(input.summary) : null;
  d.run(
    "UPDATE task_runs SET status = ?, summary = COALESCE(?, summary), completed_at = ?, updated_at = ? WHERE id = ?",
    [input.status, summary, timestamp, timestamp, run.id],
  );
  addTaskRunEvent({
    run_id: run.id,
    event_type: input.status,
    message: summary || `run ${input.status}`,
    data: { status: input.status },
    agent_id: input.agent_id ?? run.agent_id ?? undefined,
    created_at: timestamp,
  }, d);
  const updated = getTaskRun(run.id, d)!;
  emitLocalEventHooksQuiet({
    type: `run.${input.status}`,
    payload: { id: updated.id, task_id: updated.task_id, agent_id: updated.agent_id, status: updated.status, summary: updated.summary, completed_at: timestamp },
    databasePath: databasePathFromDatabase(d),
  });
  return updated;
}

export function finishTaskRunTransaction(
  input: FinishTaskRunTransactionInput,
  db?: Database,
): LoopRunTransactionResult {
  const d = db || getDatabase();
  const timestamp = input.completed_at || now();
  const status = input.status || "completed";
  const key = input.key ? normalizeTransactionKey({ key: input.key }) : "";
  const run = input.run_id
    ? getTaskRun(resolveTaskRunId(input.run_id, d), d)
    : key
      ? findTaskRunByTransactionKey(key, input.task_id, d)
      : null;

  if (!run) {
    throw new Error(input.run_id ? `Run not found: ${input.run_id}` : "runs finish requires a run id or --key");
  }
  if (input.task_id && run.task_id !== input.task_id) {
    throw new Error(`Run ${run.id} belongs to task ${run.task_id}, not ${input.task_id}`);
  }

  const resolvedKey = key || runKey(run) || run.id;
  const dryRun = input.apply === false;
  if (run.status !== "running") {
    const conflict = run.status !== status;
    return {
      schema_version: LOOP_RUN_TRANSACTION_SCHEMA_VERSION,
      local_only: true,
      dry_run: dryRun,
      processed_at: timestamp,
      action: conflict ? "conflict" : "matched",
      key: resolvedKey,
      run: summarizeTaskRun(run),
      warnings: conflict ? [`run is already ${run.status}; requested ${status}`] : [],
      commands: loopRunCommands(run, resolvedKey),
    };
  }

  if (dryRun) {
    return {
      schema_version: LOOP_RUN_TRANSACTION_SCHEMA_VERSION,
      local_only: true,
      dry_run: true,
      processed_at: timestamp,
      action: "preview",
      key: resolvedKey,
      run: summarizeTaskRun({ ...run, status, summary: input.summary ?? run.summary, completed_at: timestamp, updated_at: timestamp }),
      warnings: [],
      commands: loopRunCommands(run, resolvedKey),
    };
  }

  const finished = finishTaskRun({
    run_id: run.id,
    status,
    summary: input.summary,
    agent_id: input.agent_id,
    completed_at: timestamp,
  }, d);

  return {
    schema_version: LOOP_RUN_TRANSACTION_SCHEMA_VERSION,
    local_only: true,
    dry_run: false,
    processed_at: timestamp,
    action: "finished",
    key: resolvedKey,
    run: summarizeTaskRun(finished),
    warnings: [],
    commands: loopRunCommands(finished, resolvedKey),
  };
}

export function listTaskRuns(taskId?: string, db?: Database): TaskRun[] {
  const d = db || getDatabase();
  const rows = taskId
    ? d.query("SELECT * FROM task_runs WHERE task_id = ? ORDER BY started_at DESC, created_at DESC").all(taskId) as TaskRunRow[]
    : d.query("SELECT * FROM task_runs ORDER BY started_at DESC, created_at DESC LIMIT 100").all() as TaskRunRow[];
  return rows.map(rowToRun);
}

export function getTaskRunLedger(runId: string, db?: Database): TaskRunLedger {
  const d = db || getDatabase();
  const resolved = resolveTaskRunId(runId, d);
  const run = getTaskRun(resolved, d);
  if (!run) throw new Error(`Run not found: ${runId}`);
  const events = (d
    .query("SELECT * FROM task_run_events WHERE run_id = ? ORDER BY created_at, rowid")
    .all(run.id) as TaskRunEventRow[]).map(rowToEvent);
  const commands = d
    .query("SELECT * FROM task_run_commands WHERE run_id = ? ORDER BY created_at, rowid")
    .all(run.id) as TaskRunCommand[];
  const artifacts = (d
    .query("SELECT * FROM task_run_artifacts WHERE run_id = ? ORDER BY created_at, rowid")
    .all(run.id) as TaskRunArtifactRow[]).map(rowToArtifact);
  const files = d
    .query("SELECT * FROM task_files WHERE task_id = ? ORDER BY updated_at DESC, path")
    .all(run.task_id) as TaskFile[];
  return { run, events, commands, artifacts, files };
}
