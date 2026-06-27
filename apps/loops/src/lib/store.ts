import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type {
  CatchUpPolicy,
  CreateLoopInput,
  CreateWorkflowInput,
  Goal,
  GoalAutoExecute,
  GoalPlanNode,
  GoalPlanNodeStatus,
  GoalRun,
  GoalStatus,
  Loop,
  LoopRun,
  LoopStatus,
  RunStatus,
  WorkflowEvent,
  WorkflowRun,
  WorkflowRunStatus,
  WorkflowSpec,
  WorkflowStepRun,
  WorkflowStepRunStatus,
} from "../types.js";
import { genId, nowIso } from "./ids.js";
import { dbPath } from "./paths.js";
import { initialNextRun } from "./schedule.js";
import { assertGoalTransition, rollupSummary, updateReadyFlags } from "./goal/status.js";
import { normalizeCreateWorkflowInput } from "./workflow-spec.js";

interface DaemonLeaseFence {
  daemonLeaseId?: string;
  now?: Date;
}

interface LoopRow {
  id: string;
  name: string;
  description: string | null;
  status: string;
  archived_at: string | null;
  archived_from_status: string | null;
  schedule_json: string;
  target_json: string;
  goal_json: string | null;
  machine_json: string | null;
  next_run_at: string | null;
  retry_scheduled_for: string | null;
  catch_up: string;
  catch_up_limit: number;
  overlap: string;
  max_attempts: number;
  retry_delay_ms: number;
  lease_ms: number;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

interface RunRow {
  id: string;
  loop_id: string;
  loop_name: string;
  scheduled_for: string;
  attempt: number;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  claimed_by: string | null;
  lease_expires_at: string | null;
  pid: number | null;
  exit_code: number | null;
  duration_ms: number | null;
  stdout: string | null;
  stderr: string | null;
  error: string | null;
  goal_run_id: string | null;
  created_at: string;
  updated_at: string;
}

interface WorkflowRow {
  id: string;
  name: string;
  description: string | null;
  version: number;
  status: string;
  goal_json: string | null;
  steps_json: string;
  created_at: string;
  updated_at: string;
}

interface WorkflowRunRow {
  id: string;
  workflow_id: string;
  workflow_name: string;
  loop_id: string | null;
  loop_run_id: string | null;
  scheduled_for: string | null;
  idempotency_key: string | null;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
  error: string | null;
  goal_run_id: string | null;
  created_at: string;
  updated_at: string;
}

interface WorkflowStepRunRow {
  id: string;
  workflow_run_id: string;
  step_id: string;
  sequence: number;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  exit_code: number | null;
  pid: number | null;
  duration_ms: number | null;
  stdout: string | null;
  stderr: string | null;
  error: string | null;
  account_profile: string | null;
  account_tool: string | null;
  goal_run_id: string | null;
  created_at: string;
  updated_at: string;
}

interface WorkflowEventRow {
  id: string;
  workflow_run_id: string;
  sequence: number;
  event_type: string;
  step_id: string | null;
  payload_json: string | null;
  created_at: string;
}

interface GoalRow {
  id: string;
  plan_id: string;
  objective: string;
  status: string;
  token_budget: number | null;
  tokens_used: number;
  time_used_seconds: number;
  auto_execute: string;
  max_tokens: number | null;
  source_type: string | null;
  source_id: string | null;
  loop_id: string | null;
  loop_run_id: string | null;
  workflow_id: string | null;
  workflow_run_id: string | null;
  workflow_step_id: string | null;
  created_at: string;
  updated_at: string;
}

interface GoalPlanNodeRow {
  id: string;
  goal_id: string;
  plan_id: string;
  key: string;
  sequence: number;
  priority: number;
  objective: string;
  status: string;
  ready: number;
  token_budget: number | null;
  tokens_used: number;
  time_used_seconds: number;
  depends_on_json: string;
  created_at: string;
  updated_at: string;
}

interface GoalRunRow {
  id: string;
  goal_id: string;
  plan_id: string;
  loop_id: string | null;
  loop_run_id: string | null;
  workflow_id: string | null;
  workflow_run_id: string | null;
  workflow_step_id: string | null;
  turn: number;
  phase: string;
  status: string;
  node_key: string | null;
  tokens_used: number;
  evidence_json: string | null;
  raw_response_json: string | null;
  created_at: string;
  updated_at: string;
}

export interface DaemonLease {
  id: string;
  pid: number;
  hostname: string;
  heartbeatAt: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

interface LeaseRow {
  id: string;
  pid: number;
  hostname: string;
  heartbeat_at: string;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

function rowToLoop(row: LoopRow): Loop {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    status: row.status as LoopStatus,
    archivedAt: row.archived_at ?? undefined,
    archivedFromStatus: row.archived_from_status ? (row.archived_from_status as LoopStatus) : undefined,
    schedule: JSON.parse(row.schedule_json) as Loop["schedule"],
    target: JSON.parse(row.target_json) as Loop["target"],
    goal: row.goal_json ? (JSON.parse(row.goal_json) as Loop["goal"]) : undefined,
    machine: row.machine_json ? (JSON.parse(row.machine_json) as Loop["machine"]) : undefined,
    nextRunAt: row.next_run_at ?? undefined,
    retryScheduledFor: row.retry_scheduled_for ?? undefined,
    catchUp: row.catch_up as Loop["catchUp"],
    catchUpLimit: row.catch_up_limit,
    overlap: row.overlap as Loop["overlap"],
    maxAttempts: row.max_attempts,
    retryDelayMs: row.retry_delay_ms,
    leaseMs: row.lease_ms,
    expiresAt: row.expires_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToRun(row: RunRow): LoopRun {
  return {
    id: row.id,
    loopId: row.loop_id,
    loopName: row.loop_name,
    scheduledFor: row.scheduled_for,
    attempt: row.attempt,
    status: row.status as RunStatus,
    startedAt: row.started_at ?? undefined,
    finishedAt: row.finished_at ?? undefined,
    claimedBy: row.claimed_by ?? undefined,
    leaseExpiresAt: row.lease_expires_at ?? undefined,
    pid: row.pid ?? undefined,
    exitCode: row.exit_code ?? undefined,
    durationMs: row.duration_ms ?? undefined,
    stdout: row.stdout ?? undefined,
    stderr: row.stderr ?? undefined,
    error: row.error ?? undefined,
    goalRunId: row.goal_run_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToWorkflow(row: WorkflowRow): WorkflowSpec {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    version: row.version,
    status: row.status as WorkflowSpec["status"],
    goal: row.goal_json ? (JSON.parse(row.goal_json) as WorkflowSpec["goal"]) : undefined,
    steps: JSON.parse(row.steps_json) as WorkflowSpec["steps"],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToWorkflowRun(row: WorkflowRunRow): WorkflowRun {
  return {
    id: row.id,
    workflowId: row.workflow_id,
    workflowName: row.workflow_name,
    loopId: row.loop_id ?? undefined,
    loopRunId: row.loop_run_id ?? undefined,
    scheduledFor: row.scheduled_for ?? undefined,
    idempotencyKey: row.idempotency_key ?? undefined,
    status: row.status as WorkflowRunStatus,
    startedAt: row.started_at ?? undefined,
    finishedAt: row.finished_at ?? undefined,
    durationMs: row.duration_ms ?? undefined,
    error: row.error ?? undefined,
    goalRunId: row.goal_run_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToWorkflowStepRun(row: WorkflowStepRunRow): WorkflowStepRun {
  return {
    id: row.id,
    workflowRunId: row.workflow_run_id,
    stepId: row.step_id,
    sequence: row.sequence,
    status: row.status as WorkflowStepRunStatus,
    startedAt: row.started_at ?? undefined,
    finishedAt: row.finished_at ?? undefined,
    exitCode: row.exit_code ?? undefined,
    pid: row.pid ?? undefined,
    durationMs: row.duration_ms ?? undefined,
    stdout: row.stdout ?? undefined,
    stderr: row.stderr ?? undefined,
    error: row.error ?? undefined,
    accountProfile: row.account_profile ?? undefined,
    accountTool: row.account_tool ?? undefined,
    goalRunId: row.goal_run_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToGoal(row: GoalRow): Goal {
  return {
    goalId: row.id,
    planId: row.plan_id,
    objective: row.objective,
    status: row.status as GoalStatus,
    tokenBudget: row.token_budget ?? undefined,
    tokensUsed: row.tokens_used,
    timeUsedSeconds: row.time_used_seconds,
    autoExecute: row.auto_execute as GoalAutoExecute,
    maxTokens: row.max_tokens ?? undefined,
    sourceType: row.source_type ?? undefined,
    sourceId: row.source_id ?? undefined,
    loopId: row.loop_id ?? undefined,
    loopRunId: row.loop_run_id ?? undefined,
    workflowId: row.workflow_id ?? undefined,
    workflowRunId: row.workflow_run_id ?? undefined,
    workflowStepId: row.workflow_step_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToGoalPlanNode(row: GoalPlanNodeRow): GoalPlanNode {
  return {
    nodeId: row.id,
    planId: row.plan_id,
    key: row.key,
    sequence: row.sequence,
    priority: row.priority,
    objective: row.objective,
    status: row.status as GoalPlanNodeStatus,
    ready: row.ready === 1,
    tokenBudget: row.token_budget ?? undefined,
    tokensUsed: row.tokens_used,
    timeUsedSeconds: row.time_used_seconds,
    dependsOn: JSON.parse(row.depends_on_json) as string[],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToGoalRun(row: GoalRunRow): GoalRun {
  return {
    runId: row.id,
    goalId: row.goal_id,
    planId: row.plan_id,
    loopId: row.loop_id ?? undefined,
    loopRunId: row.loop_run_id ?? undefined,
    workflowId: row.workflow_id ?? undefined,
    workflowRunId: row.workflow_run_id ?? undefined,
    workflowStepId: row.workflow_step_id ?? undefined,
    turn: row.turn,
    phase: row.phase as GoalRun["phase"],
    status: row.status as GoalRun["status"],
    nodeKey: row.node_key ?? undefined,
    tokensUsed: row.tokens_used,
    evidence: row.evidence_json ? (JSON.parse(row.evidence_json) as Record<string, unknown>) : undefined,
    rawResponse: row.raw_response_json ? (JSON.parse(row.raw_response_json) as unknown) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToWorkflowEvent(row: WorkflowEventRow): WorkflowEvent {
  return {
    id: row.id,
    workflowRunId: row.workflow_run_id,
    sequence: row.sequence,
    eventType: row.event_type,
    stepId: row.step_id ?? undefined,
    payload: row.payload_json ? (JSON.parse(row.payload_json) as Record<string, unknown>) : undefined,
    createdAt: row.created_at,
  };
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function rowToLease(row: LeaseRow): DaemonLease {
  return {
    id: row.id,
    pid: row.pid,
    hostname: row.hostname,
    heartbeatAt: row.heartbeat_at,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface ClaimRunResult {
  run: LoopRun;
  loop: Loop;
}

export interface CreateWorkflowRunInput {
  workflow: WorkflowSpec;
  loop?: Loop;
  loopRun?: LoopRun;
  scheduledFor?: string;
  idempotencyKey?: string;
  daemonLeaseId?: string;
}

export interface CreateGoalInput {
  objective: string;
  tokenBudget?: number;
  autoExecute?: GoalAutoExecute;
  maxTokens?: number;
  sourceType?: string;
  sourceId?: string;
  loopId?: string;
  loopRunId?: string;
  workflowId?: string;
  workflowRunId?: string;
  workflowStepId?: string;
}

export interface CreateGoalPlanNodeInput {
  key: string;
  objective: string;
  dependsOn?: string[];
  priority?: number;
  tokenBudget?: number;
}

export interface RecordGoalEventInput {
  goalId: string;
  turn?: number;
  phase: GoalRun["phase"];
  status: GoalRun["status"];
  nodeKey?: string;
  tokensUsed?: number;
  evidence?: Record<string, unknown>;
  rawResponse?: unknown;
}

export class Store {
  private db: Database;

  constructor(path?: string) {
    const file = path ?? dbPath();
    if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    this.db = new Database(file);
    this.db.exec("PRAGMA busy_timeout = 5000;");
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS loops (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL,
        archived_at TEXT,
        archived_from_status TEXT,
        schedule_json TEXT NOT NULL,
        target_json TEXT NOT NULL,
        goal_json TEXT,
        machine_json TEXT,
        next_run_at TEXT,
        retry_scheduled_for TEXT,
        catch_up TEXT NOT NULL,
        catch_up_limit INTEGER NOT NULL,
        overlap TEXT NOT NULL,
        max_attempts INTEGER NOT NULL,
        retry_delay_ms INTEGER NOT NULL,
        lease_ms INTEGER NOT NULL,
        expires_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_loops_status_next ON loops(status, next_run_at);
      CREATE INDEX IF NOT EXISTS idx_loops_name ON loops(name);

      CREATE TABLE IF NOT EXISTS loop_runs (
        id TEXT PRIMARY KEY,
        loop_id TEXT NOT NULL,
        loop_name TEXT NOT NULL,
        scheduled_for TEXT NOT NULL,
        attempt INTEGER NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT,
        claimed_by TEXT,
        lease_expires_at TEXT,
        pid INTEGER,
        exit_code INTEGER,
        duration_ms INTEGER,
        stdout TEXT,
        stderr TEXT,
        error TEXT,
        goal_run_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(loop_id, scheduled_for)
      );
      CREATE INDEX IF NOT EXISTS idx_runs_loop ON loop_runs(loop_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_runs_status ON loop_runs(status);
      CREATE INDEX IF NOT EXISTS idx_runs_scheduled ON loop_runs(scheduled_for);

      CREATE TABLE IF NOT EXISTS daemon_lease (
        id TEXT PRIMARY KEY,
        pid INTEGER NOT NULL,
        hostname TEXT NOT NULL,
        heartbeat_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS workflow_specs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        version INTEGER NOT NULL,
        status TEXT NOT NULL,
        goal_json TEXT,
        steps_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_workflows_status_name ON workflow_specs(status, name);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_workflows_name_active ON workflow_specs(name) WHERE status = 'active';

      CREATE TABLE IF NOT EXISTS workflow_runs (
        id TEXT PRIMARY KEY,
        workflow_id TEXT NOT NULL REFERENCES workflow_specs(id) ON DELETE CASCADE,
        workflow_name TEXT NOT NULL,
        loop_id TEXT REFERENCES loops(id) ON DELETE SET NULL,
        loop_run_id TEXT REFERENCES loop_runs(id) ON DELETE SET NULL,
        scheduled_for TEXT,
        idempotency_key TEXT,
        status TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT,
        duration_ms INTEGER,
        error TEXT,
        goal_run_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_runs_idempotency
        ON workflow_runs(workflow_id, idempotency_key)
        WHERE idempotency_key IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow_created ON workflow_runs(workflow_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_workflow_runs_loop_run ON workflow_runs(loop_run_id);
      CREATE INDEX IF NOT EXISTS idx_workflow_runs_status ON workflow_runs(status);

      CREATE TABLE IF NOT EXISTS workflow_step_runs (
        id TEXT PRIMARY KEY,
        workflow_run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
        step_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT,
        exit_code INTEGER,
        pid INTEGER,
        duration_ms INTEGER,
        stdout TEXT,
        stderr TEXT,
        error TEXT,
        account_profile TEXT,
        account_tool TEXT,
        goal_run_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(workflow_run_id, step_id)
      );
      CREATE INDEX IF NOT EXISTS idx_workflow_step_runs_run_sequence ON workflow_step_runs(workflow_run_id, sequence);
      CREATE INDEX IF NOT EXISTS idx_workflow_step_runs_status ON workflow_step_runs(status);

      CREATE TABLE IF NOT EXISTS workflow_events (
        id TEXT PRIMARY KEY,
        workflow_run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
        sequence INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        step_id TEXT,
        payload_json TEXT,
        created_at TEXT NOT NULL,
        UNIQUE(workflow_run_id, sequence)
      );
      CREATE INDEX IF NOT EXISTS idx_workflow_events_run_sequence ON workflow_events(workflow_run_id, sequence);

      CREATE TABLE IF NOT EXISTS goals (
        id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL,
        objective TEXT NOT NULL,
        status TEXT NOT NULL,
        token_budget INTEGER,
        tokens_used INTEGER NOT NULL,
        time_used_seconds INTEGER NOT NULL,
        auto_execute TEXT NOT NULL,
        max_tokens INTEGER,
        source_type TEXT,
        source_id TEXT,
        loop_id TEXT,
        loop_run_id TEXT,
        workflow_id TEXT,
        workflow_run_id TEXT,
        workflow_step_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_goals_status_updated ON goals(status, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_goals_loop_run ON goals(loop_run_id);
      CREATE INDEX IF NOT EXISTS idx_goals_workflow_run ON goals(workflow_run_id);
      CREATE INDEX IF NOT EXISTS idx_goals_source ON goals(source_type, source_id);

      CREATE TABLE IF NOT EXISTS goal_plan_nodes (
        id TEXT PRIMARY KEY,
        goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
        plan_id TEXT NOT NULL,
        key TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        priority INTEGER NOT NULL,
        objective TEXT NOT NULL,
        status TEXT NOT NULL,
        ready INTEGER NOT NULL,
        token_budget INTEGER,
        tokens_used INTEGER NOT NULL,
        time_used_seconds INTEGER NOT NULL,
        depends_on_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(plan_id, key)
      );
      CREATE INDEX IF NOT EXISTS idx_goal_plan_nodes_goal_sequence ON goal_plan_nodes(goal_id, sequence);
      CREATE INDEX IF NOT EXISTS idx_goal_plan_nodes_status ON goal_plan_nodes(status);

      CREATE TABLE IF NOT EXISTS goal_runs (
        id TEXT PRIMARY KEY,
        goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
        plan_id TEXT NOT NULL,
        loop_id TEXT,
        loop_run_id TEXT,
        workflow_id TEXT,
        workflow_run_id TEXT,
        workflow_step_id TEXT,
        turn INTEGER NOT NULL,
        phase TEXT NOT NULL,
        status TEXT NOT NULL,
        node_key TEXT,
        tokens_used INTEGER NOT NULL,
        evidence_json TEXT,
        raw_response_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_goal_runs_goal_created ON goal_runs(goal_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_goal_runs_loop_run ON goal_runs(loop_run_id);
      CREATE INDEX IF NOT EXISTS idx_goal_runs_workflow_run ON goal_runs(workflow_run_id);
    `);
    // Additive columns for older databases. These must be idempotent: issuing
    // `ALTER TABLE ... ADD COLUMN` for a column that already exists makes
    // SQLite log a "duplicate column name" error via libsqlite3 *before* a JS
    // try/catch can swallow it, polluting the system log on every process
    // start. Check for the column first so the failing statement never runs.
    this.addColumnIfMissing("loops", "machine_json", "TEXT");
    this.addColumnIfMissing("loops", "goal_json", "TEXT");
    this.addColumnIfMissing("loops", "archived_at", "TEXT");
    this.addColumnIfMissing("loops", "archived_from_status", "TEXT");
    this.addColumnIfMissing("loop_runs", "goal_run_id", "TEXT");
    this.addColumnIfMissing("workflow_specs", "goal_json", "TEXT");
    this.addColumnIfMissing("workflow_runs", "goal_run_id", "TEXT");
    this.addColumnIfMissing("workflow_step_runs", "pid", "INTEGER");
    this.addColumnIfMissing("workflow_step_runs", "goal_run_id", "TEXT");
    this.db
      .query("INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES (?, ?)")
      .run("0001_initial_and_workflows", nowIso());
    this.db
      .query("INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES (?, ?)")
      .run("0002_loop_machines", nowIso());
    this.db
      .query("INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES (?, ?)")
      .run("0003_goals", nowIso());
    this.db
      .query("INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES (?, ?)")
      .run("0004_loop_archive_metadata", nowIso());
  }

  /**
   * Add a column only if it does not already exist. Idempotent — avoids the
   * "duplicate column name" error that SQLite logs (via libsqlite3, before any
   * JS try/catch) when re-running an additive migration on a database that has
   * already been upgraded. Table/column/definition come from hardcoded literals
   * in {@link migrate}, never user input, so interpolation here is safe.
   */
  private addColumnIfMissing(table: string, column: string, definition: string): void {
    const columns = this.db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (columns.some((c) => c.name === column)) return;
    this.db.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
  }

  private assertDaemonLeaseFence(opts: DaemonLeaseFence = {}, now: string = nowIso()): void {
    if (!opts.daemonLeaseId) return;
    const row = this.db
      .query<{ id: string }, [string, string]>("SELECT id FROM daemon_lease WHERE id = ? AND expires_at > ?")
      .get(opts.daemonLeaseId, now);
    if (!row) throw new Error("daemon lease lost");
  }

  createLoop(input: CreateLoopInput, from: Date = new Date()): Loop {
    const now = nowIso();
    const loop: Loop = {
      id: genId(),
      name: input.name,
      description: input.description,
      status: "active",
      schedule: input.schedule,
      target: input.target,
      goal: input.goal,
      machine: input.machine,
      nextRunAt: initialNextRun(input.schedule, from),
      catchUp: input.catchUp ?? "latest",
      catchUpLimit: input.catchUpLimit ?? 50,
      overlap: input.overlap ?? "skip",
      maxAttempts: input.maxAttempts ?? 1,
      retryDelayMs: input.retryDelayMs ?? 60_000,
      leaseMs: input.leaseMs ?? 30 * 60_000,
      expiresAt: input.expiresAt,
      createdAt: now,
      updatedAt: now,
    };
    this.db
      .query(
        `INSERT INTO loops (id, name, description, status, schedule_json, target_json, machine_json, next_run_at, retry_scheduled_for,
          goal_json, catch_up, catch_up_limit, overlap, max_attempts, retry_delay_ms, lease_ms, expires_at, created_at, updated_at)
         VALUES ($id, $name, $description, $status, $schedule, $target, $machine, $nextRun, NULL, $goal, $catchUp, $catchUpLimit,
          $overlap, $maxAttempts, $retryDelay, $leaseMs, $expiresAt, $created, $updated)`,
      )
      .run({
        $id: loop.id,
        $name: loop.name,
        $description: loop.description ?? null,
        $status: loop.status,
        $schedule: JSON.stringify(loop.schedule),
        $target: JSON.stringify(loop.target),
        $machine: loop.machine ? JSON.stringify(loop.machine) : null,
        $goal: loop.goal ? JSON.stringify(loop.goal) : null,
        $nextRun: loop.nextRunAt ?? null,
        $catchUp: loop.catchUp,
        $catchUpLimit: loop.catchUpLimit,
        $overlap: loop.overlap,
        $maxAttempts: loop.maxAttempts,
        $retryDelay: loop.retryDelayMs,
        $leaseMs: loop.leaseMs,
        $expiresAt: loop.expiresAt ?? null,
        $created: loop.createdAt,
        $updated: loop.updatedAt,
      });
    return loop;
  }

  getLoop(id: string): Loop | undefined {
    const row = this.db.query<LoopRow, [string]>("SELECT * FROM loops WHERE id = ?").get(id);
    return row ? rowToLoop(row) : undefined;
  }

  findLoopByName(name: string): Loop | undefined {
    const row = this.db.query<LoopRow, [string]>("SELECT * FROM loops WHERE name = ? ORDER BY created_at DESC LIMIT 1").get(name);
    return row ? rowToLoop(row) : undefined;
  }

  requireLoop(idOrName: string): Loop {
    return this.getLoop(idOrName) ?? this.findLoopByName(idOrName) ?? (() => {
      throw new Error(`loop not found: ${idOrName}`);
    })();
  }

  listLoops(opts: { status?: LoopStatus; limit?: number; archived?: boolean; includeArchived?: boolean } = {}): Loop[] {
    const limit = opts.limit ?? 200;
    let rows: LoopRow[];
    if (opts.status && opts.archived) {
      rows = this.db
        .query<LoopRow, [string, number]>("SELECT * FROM loops WHERE status = ? AND archived_at IS NOT NULL ORDER BY next_run_at ASC LIMIT ?")
        .all(opts.status, limit);
    } else if (opts.status && opts.includeArchived) {
      rows = this.db
        .query<LoopRow, [string, number]>("SELECT * FROM loops WHERE status = ? ORDER BY next_run_at ASC LIMIT ?")
        .all(opts.status, limit);
    } else if (opts.status) {
      rows = this.db
        .query<LoopRow, [string, number]>("SELECT * FROM loops WHERE status = ? AND archived_at IS NULL ORDER BY next_run_at ASC LIMIT ?")
        .all(opts.status, limit);
    } else if (opts.archived) {
      rows = this.db
        .query<LoopRow, [number]>("SELECT * FROM loops WHERE archived_at IS NOT NULL ORDER BY archived_at DESC LIMIT ?")
        .all(limit);
    } else if (opts.includeArchived) {
      rows = this.db.query<LoopRow, [number]>("SELECT * FROM loops ORDER BY status ASC, next_run_at ASC LIMIT ?").all(limit);
    } else {
      rows = this.db
        .query<LoopRow, [number]>("SELECT * FROM loops WHERE archived_at IS NULL ORDER BY status ASC, next_run_at ASC LIMIT ?")
        .all(limit);
    }
    return rows.map(rowToLoop);
  }

  dueLoops(now: Date): Loop[] {
    const rows = this.db
      .query<LoopRow, [string]>(
        `SELECT * FROM loops
         WHERE status = 'active'
           AND archived_at IS NULL
           AND next_run_at IS NOT NULL
           AND next_run_at <= ?
         ORDER BY next_run_at ASC`,
      )
      .all(now.toISOString());
    return rows.map(rowToLoop);
  }

  updateLoop(
    id: string,
    patch: Partial<Pick<Loop, "status" | "nextRunAt" | "retryScheduledFor" | "expiresAt">>,
    opts: DaemonLeaseFence = {},
  ): Loop {
    const current = this.getLoop(id);
    if (!current) throw new Error(`loop not found: ${id}`);
    const updated = (opts.now ?? new Date()).toISOString();
    const merged: Loop = { ...current, ...patch, updatedAt: updated };
    this.db
      .query(
        `UPDATE loops SET status=$status, next_run_at=$nextRun, retry_scheduled_for=$retrySlot,
         expires_at=$expiresAt, updated_at=$updated
         WHERE id=$id
           AND ($daemonLeaseId IS NULL OR EXISTS (
             SELECT 1 FROM daemon_lease WHERE id=$daemonLeaseId AND expires_at > $now
           ))`,
      )
      .run({
        $id: id,
        $status: merged.status,
        $nextRun: merged.nextRunAt ?? null,
        $retrySlot: merged.retryScheduledFor ?? null,
        $expiresAt: merged.expiresAt ?? null,
        $updated: merged.updatedAt,
        $daemonLeaseId: opts.daemonLeaseId ?? null,
        $now: updated,
      });
    const after = this.getLoop(id);
    if (!after) throw new Error(`loop not found after update: ${id}`);
    return after;
  }

  renameLoop(id: string, name: string, opts: DaemonLeaseFence = {}): Loop {
    const current = this.getLoop(id);
    if (!current) throw new Error(`loop not found: ${id}`);
    const trimmed = name.trim();
    if (!trimmed) throw new Error("loop name must not be empty");
    const updated = (opts.now ?? new Date()).toISOString();
    this.db
      .query(
        `UPDATE loops SET name=$name, updated_at=$updated
         WHERE id=$id
           AND ($daemonLeaseId IS NULL OR EXISTS (
             SELECT 1 FROM daemon_lease WHERE id=$daemonLeaseId AND expires_at > $now
           ))`,
      )
      .run({
        $id: id,
        $name: trimmed,
        $updated: updated,
        $daemonLeaseId: opts.daemonLeaseId ?? null,
        $now: updated,
      });
    const after = this.getLoop(id);
    if (!after) throw new Error(`loop not found after rename: ${id}`);
    return after;
  }

  archiveLoop(idOrName: string): Loop {
    const loop = this.requireLoop(idOrName);
    if (loop.archivedAt) return loop;
    const updated = nowIso();
    const archivedStatus: LoopStatus = loop.status === "active" ? "paused" : loop.status;
    this.db
      .query(
        `UPDATE loops
         SET status=$status, archived_at=$archivedAt, archived_from_status=$archivedFromStatus, updated_at=$updated
         WHERE id=$id`,
      )
      .run({
        $id: loop.id,
        $status: archivedStatus,
        $archivedAt: updated,
        $archivedFromStatus: loop.status,
        $updated: updated,
      });
    const archived = this.getLoop(loop.id);
    if (!archived) throw new Error(`loop not found after archive: ${loop.id}`);
    return archived;
  }

  unarchiveLoop(idOrName: string): Loop {
    const loop = this.requireLoop(idOrName);
    if (!loop.archivedAt) return loop;
    const updated = nowIso();
    const restoredStatus = loop.archivedFromStatus ?? loop.status;
    this.db
      .query(
        `UPDATE loops
         SET status=$status, archived_at=NULL, archived_from_status=NULL, updated_at=$updated
         WHERE id=$id`,
      )
      .run({
        $id: loop.id,
        $status: restoredStatus,
        $updated: updated,
      });
    const unarchived = this.getLoop(loop.id);
    if (!unarchived) throw new Error(`loop not found after unarchive: ${loop.id}`);
    return unarchived;
  }

  deleteLoop(idOrName: string): boolean {
    const loop = this.requireLoop(idOrName);
    const res = this.db.query("DELETE FROM loops WHERE id = ?").run(loop.id);
    return res.changes > 0;
  }

  createWorkflow(input: CreateWorkflowInput): WorkflowSpec {
    const normalized = normalizeCreateWorkflowInput(input);
    const now = nowIso();
    const workflow: WorkflowSpec = {
      id: genId(),
      name: normalized.name,
      description: normalized.description,
      version: normalized.version ?? 1,
      status: "active",
      goal: normalized.goal,
      steps: normalized.steps,
      createdAt: now,
      updatedAt: now,
    };
    this.db
      .query(
        `INSERT INTO workflow_specs (id, name, description, version, status, goal_json, steps_json, created_at, updated_at)
         VALUES ($id, $name, $description, $version, $status, $goal, $steps, $created, $updated)`,
      )
      .run({
        $id: workflow.id,
        $name: workflow.name,
        $description: workflow.description ?? null,
        $version: workflow.version,
        $status: workflow.status,
        $goal: workflow.goal ? JSON.stringify(workflow.goal) : null,
        $steps: JSON.stringify(workflow.steps),
        $created: workflow.createdAt,
        $updated: workflow.updatedAt,
      });
    return workflow;
  }

  getWorkflow(id: string): WorkflowSpec | undefined {
    const row = this.db.query<WorkflowRow, [string]>("SELECT * FROM workflow_specs WHERE id = ?").get(id);
    return row ? rowToWorkflow(row) : undefined;
  }

  findWorkflowByName(name: string): WorkflowSpec | undefined {
    const row = this.db
      .query<WorkflowRow, [string]>(
        "SELECT * FROM workflow_specs WHERE name = ? AND status = 'active' ORDER BY updated_at DESC LIMIT 1",
      )
      .get(name);
    return row ? rowToWorkflow(row) : undefined;
  }

  requireWorkflow(idOrName: string): WorkflowSpec {
    return this.getWorkflow(idOrName) ?? this.findWorkflowByName(idOrName) ?? (() => {
      throw new Error(`workflow not found: ${idOrName}`);
    })();
  }

  listWorkflows(opts: { status?: WorkflowSpec["status"]; limit?: number } = {}): WorkflowSpec[] {
    const limit = opts.limit ?? 200;
    const rows = opts.status
      ? this.db
          .query<WorkflowRow, [string, number]>("SELECT * FROM workflow_specs WHERE status = ? ORDER BY updated_at DESC LIMIT ?")
          .all(opts.status, limit)
      : this.db.query<WorkflowRow, [number]>("SELECT * FROM workflow_specs ORDER BY status ASC, updated_at DESC LIMIT ?").all(limit);
    return rows.map(rowToWorkflow);
  }

  archiveWorkflow(idOrName: string): WorkflowSpec {
    const workflow = this.requireWorkflow(idOrName);
    const updated = nowIso();
    this.db
      .query("UPDATE workflow_specs SET status='archived', updated_at=? WHERE id=?")
      .run(updated, workflow.id);
    const archived = this.getWorkflow(workflow.id);
    if (!archived) throw new Error(`workflow not found after archive: ${workflow.id}`);
    return archived;
  }

  createGoal(input: CreateGoalInput, opts: DaemonLeaseFence = {}): Goal {
    const now = nowIso();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.assertDaemonLeaseFence(opts, now);
      const id = genId();
      this.db
        .query(
          `INSERT INTO goals (id, plan_id, objective, status, token_budget, tokens_used, time_used_seconds, auto_execute,
            max_tokens, source_type, source_id, loop_id, loop_run_id, workflow_id, workflow_run_id, workflow_step_id,
            created_at, updated_at)
           VALUES ($id, $planId, $objective, 'active', $tokenBudget, 0, 0, $autoExecute, $maxTokens, $sourceType,
            $sourceId, $loopId, $loopRunId, $workflowId, $workflowRunId, $workflowStepId, $created, $updated)`,
        )
        .run({
          $id: id,
          $planId: id,
          $objective: input.objective,
          $tokenBudget: input.tokenBudget ?? null,
          $autoExecute: input.autoExecute ?? "readyOnly",
          $maxTokens: input.maxTokens ?? input.tokenBudget ?? null,
          $sourceType: input.sourceType ?? null,
          $sourceId: input.sourceId ?? null,
          $loopId: input.loopId ?? null,
          $loopRunId: input.loopRunId ?? null,
          $workflowId: input.workflowId ?? null,
          $workflowRunId: input.workflowRunId ?? null,
          $workflowStepId: input.workflowStepId ?? null,
          $created: now,
          $updated: now,
        });
      this.db.exec("COMMIT");
      return this.requireGoal(id);
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        /* transaction may already be closed */
      }
      throw error;
    }
  }

  getGoal(id: string): Goal | undefined {
    const row = this.db.query<GoalRow, [string]>("SELECT * FROM goals WHERE id = ?").get(id);
    return row ? rowToGoal(row) : undefined;
  }

  requireGoal(id: string): Goal {
    const goal = this.getGoal(id);
    if (!goal) throw new Error(`goal not found: ${id}`);
    return goal;
  }

  findGoalByLoop(idOrName: string): Goal | undefined {
    const loop = this.getLoop(idOrName) ?? this.findLoopByName(idOrName);
    if (!loop) return undefined;
    const row = this.db
      .query<GoalRow, [string]>("SELECT * FROM goals WHERE loop_id = ? ORDER BY created_at DESC LIMIT 1")
      .get(loop.id);
    return row ? rowToGoal(row) : undefined;
  }

  findGoalByRunId(id: string): Goal | undefined {
    const direct = this.getGoal(id);
    if (direct) return direct;
    const event = this.db.query<GoalRunRow, [string]>("SELECT * FROM goal_runs WHERE id = ?").get(id);
    if (event) return this.getGoal(event.goal_id);
    const row = this.db
      .query<GoalRow, [string, string, string]>(
        `SELECT * FROM goals
         WHERE loop_run_id = ? OR workflow_run_id = ? OR workflow_step_id = ?
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get(id, id, id);
    return row ? rowToGoal(row) : undefined;
  }

  findGoalByContext(context: {
    loopRunId?: string;
    workflowRunId?: string;
    workflowStepId?: string;
    sourceType?: string;
    sourceId?: string;
  }): Goal | undefined {
    if (context.loopRunId) {
      const row = this.db
        .query<GoalRow, [string, string | null, string | null]>(
          `SELECT * FROM goals
           WHERE loop_run_id = ? AND (? IS NULL OR workflow_step_id = ?)
           ORDER BY created_at DESC LIMIT 1`,
        )
        .get(context.loopRunId, context.workflowStepId ?? null, context.workflowStepId ?? null);
      if (row) return rowToGoal(row);
    }
    if (context.workflowRunId) {
      const row = this.db
        .query<GoalRow, [string, string | null, string | null]>(
          `SELECT * FROM goals
           WHERE workflow_run_id = ? AND (? IS NULL OR workflow_step_id = ?)
           ORDER BY created_at DESC LIMIT 1`,
        )
        .get(context.workflowRunId, context.workflowStepId ?? null, context.workflowStepId ?? null);
      if (row) return rowToGoal(row);
    }
    if (context.sourceType && context.sourceId) {
      const row = this.db
        .query<GoalRow, [string, string]>(
          "SELECT * FROM goals WHERE source_type = ? AND source_id = ? ORDER BY created_at DESC LIMIT 1",
        )
        .get(context.sourceType, context.sourceId);
      if (row) return rowToGoal(row);
    }
    return undefined;
  }

  listGoals(opts: { status?: GoalStatus; limit?: number } = {}): Goal[] {
    const limit = opts.limit ?? 100;
    const rows = opts.status
      ? this.db
          .query<GoalRow, [string, number]>("SELECT * FROM goals WHERE status = ? ORDER BY created_at DESC LIMIT ?")
          .all(opts.status, limit)
      : this.db.query<GoalRow, [number]>("SELECT * FROM goals ORDER BY created_at DESC LIMIT ?").all(limit);
    return rows.map(rowToGoal);
  }

  createGoalPlanNodes(goalId: string, nodes: CreateGoalPlanNodeInput[], opts: DaemonLeaseFence = {}): GoalPlanNode[] {
    const goal = this.requireGoal(goalId);
    const now = nowIso();
    const materialized: GoalPlanNode[] = nodes.map((node, sequence) => ({
      nodeId: genId(),
      planId: goal.planId,
      key: node.key,
      sequence,
      priority: node.priority ?? 0,
      objective: node.objective,
      status: "pending",
      ready: false,
      tokenBudget: node.tokenBudget,
      tokensUsed: 0,
      timeUsedSeconds: 0,
      dependsOn: node.dependsOn ?? [],
      createdAt: now,
      updatedAt: now,
    }));
    const withReady = updateReadyFlags(materialized, "active");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.assertDaemonLeaseFence(opts, now);
      for (const node of withReady) {
        this.db
          .query(
            `INSERT OR IGNORE INTO goal_plan_nodes (id, goal_id, plan_id, key, sequence, priority, objective, status, ready,
              token_budget, tokens_used, time_used_seconds, depends_on_json, created_at, updated_at)
             VALUES ($id, $goalId, $planId, $key, $sequence, $priority, $objective, $status, $ready, $tokenBudget,
              $tokensUsed, $timeUsedSeconds, $dependsOn, $created, $updated)`,
          )
          .run({
            $id: node.nodeId,
            $goalId: goal.goalId,
            $planId: goal.planId,
            $key: node.key,
            $sequence: node.sequence,
            $priority: node.priority,
            $objective: node.objective,
            $status: node.status,
            $ready: node.ready ? 1 : 0,
            $tokenBudget: node.tokenBudget ?? null,
            $tokensUsed: node.tokensUsed,
            $timeUsedSeconds: node.timeUsedSeconds,
            $dependsOn: JSON.stringify(node.dependsOn),
            $created: node.createdAt,
            $updated: node.updatedAt,
          });
      }
      this.db.exec("COMMIT");
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        /* transaction may already be closed */
      }
      throw error;
    }
    return this.listGoalPlanNodes(goalId);
  }

  listGoalPlanNodes(goalIdOrPlanId: string): GoalPlanNode[] {
    const rows = this.db
      .query<GoalPlanNodeRow, [string, string]>(
        "SELECT * FROM goal_plan_nodes WHERE goal_id = ? OR plan_id = ? ORDER BY sequence ASC",
      )
      .all(goalIdOrPlanId, goalIdOrPlanId);
    return rows.map(rowToGoalPlanNode);
  }

  updateGoalStatus(goalId: string, status: GoalStatus, opts: DaemonLeaseFence = {}): Goal {
    const current = this.requireGoal(goalId);
    assertGoalTransition(current.status, status);
    const now = (opts.now ?? new Date()).toISOString();
    this.db
      .query(
        `UPDATE goals SET status=$status, updated_at=$updated
         WHERE id=$id
           AND ($daemonLeaseId IS NULL OR EXISTS (
             SELECT 1 FROM daemon_lease WHERE id=$daemonLeaseId AND expires_at > $now
           ))`,
      )
      .run({
        $id: goalId,
        $status: status,
        $updated: now,
        $daemonLeaseId: opts.daemonLeaseId ?? null,
        $now: now,
      });
    return this.requireGoal(goalId);
  }

  addGoalUsage(goalId: string, tokens: number, timeUsedSeconds = 0, opts: DaemonLeaseFence = {}): Goal {
    const now = (opts.now ?? new Date()).toISOString();
    this.db
      .query(
        `UPDATE goals
         SET tokens_used=tokens_used + $tokens, time_used_seconds=time_used_seconds + $seconds, updated_at=$updated
         WHERE id=$id
           AND ($daemonLeaseId IS NULL OR EXISTS (
             SELECT 1 FROM daemon_lease WHERE id=$daemonLeaseId AND expires_at > $now
           ))`,
      )
      .run({
        $id: goalId,
        $tokens: tokens,
        $seconds: timeUsedSeconds,
        $updated: now,
        $daemonLeaseId: opts.daemonLeaseId ?? null,
        $now: now,
      });
    return this.requireGoal(goalId);
  }

  updateGoalPlanNode(
    goalId: string,
    key: string,
    patch: Partial<Pick<GoalPlanNode, "status" | "tokensUsed" | "timeUsedSeconds" | "ready">>,
    opts: DaemonLeaseFence = {},
  ): GoalPlanNode {
    const now = (opts.now ?? new Date()).toISOString();
    this.db
      .query(
        `UPDATE goal_plan_nodes
         SET status=COALESCE($status, status),
          tokens_used=COALESCE($tokensUsed, tokens_used),
          time_used_seconds=COALESCE($timeUsedSeconds, time_used_seconds),
          ready=COALESCE($ready, ready),
          updated_at=$updated
         WHERE goal_id=$goalId AND key=$key
           AND ($daemonLeaseId IS NULL OR EXISTS (
             SELECT 1 FROM daemon_lease WHERE id=$daemonLeaseId AND expires_at > $now
           ))`,
      )
      .run({
        $goalId: goalId,
        $key: key,
        $status: patch.status ?? null,
        $tokensUsed: patch.tokensUsed ?? null,
        $timeUsedSeconds: patch.timeUsedSeconds ?? null,
        $ready: patch.ready === undefined ? null : patch.ready ? 1 : 0,
        $updated: now,
        $daemonLeaseId: opts.daemonLeaseId ?? null,
        $now: now,
      });
    const node = this.listGoalPlanNodes(goalId).find((entry) => entry.key === key);
    if (!node) throw new Error(`goal node not found: ${goalId}/${key}`);
    return node;
  }

  recordGoalEvent(input: RecordGoalEventInput, opts: DaemonLeaseFence = {}): GoalRun {
    const goal = this.requireGoal(input.goalId);
    const now = nowIso();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.assertDaemonLeaseFence(opts, now);
      const previous = this.db
        .query<{ turn: number | null }, [string]>("SELECT MAX(turn) AS turn FROM goal_runs WHERE goal_id = ?")
        .get(goal.goalId);
      const turn = input.turn ?? (previous?.turn ?? 0) + 1;
      const id = genId();
      this.db
        .query(
          `INSERT INTO goal_runs (id, goal_id, plan_id, loop_id, loop_run_id, workflow_id, workflow_run_id, workflow_step_id,
            turn, phase, status, node_key, tokens_used, evidence_json, raw_response_json, created_at, updated_at)
           VALUES ($id, $goalId, $planId, $loopId, $loopRunId, $workflowId, $workflowRunId, $workflowStepId,
            $turn, $phase, $status, $nodeKey, $tokensUsed, $evidence, $rawResponse, $created, $updated)`,
        )
        .run({
          $id: id,
          $goalId: goal.goalId,
          $planId: goal.planId,
          $loopId: goal.loopId ?? null,
          $loopRunId: goal.loopRunId ?? null,
          $workflowId: goal.workflowId ?? null,
          $workflowRunId: goal.workflowRunId ?? null,
          $workflowStepId: goal.workflowStepId ?? null,
          $turn: turn,
          $phase: input.phase,
          $status: input.status,
          $nodeKey: input.nodeKey ?? null,
          $tokensUsed: input.tokensUsed ?? 0,
          $evidence: input.evidence ? JSON.stringify(input.evidence) : null,
          $rawResponse: input.rawResponse === undefined ? null : JSON.stringify(input.rawResponse),
          $created: now,
          $updated: now,
        });
      if (input.tokensUsed && input.tokensUsed > 0) {
        this.db
          .query("UPDATE goals SET tokens_used=tokens_used + ?, updated_at=? WHERE id=?")
          .run(input.tokensUsed, now, goal.goalId);
      }
      this.db.exec("COMMIT");
      const event = this.db.query<GoalRunRow, [string]>("SELECT * FROM goal_runs WHERE id = ?").get(id);
      if (!event) throw new Error(`goal run not found after record: ${id}`);
      return rowToGoalRun(event);
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        /* transaction may already be closed */
      }
      throw error;
    }
  }

  listGoalRuns(opts: { goalId?: string; runId?: string; limit?: number } = {}): GoalRun[] {
    const limit = opts.limit ?? 200;
    let rows: GoalRunRow[];
    if (opts.goalId) {
      rows = this.db
        .query<GoalRunRow, [string, number]>("SELECT * FROM goal_runs WHERE goal_id = ? ORDER BY created_at ASC LIMIT ?")
        .all(opts.goalId, limit);
    } else if (opts.runId) {
      rows = this.db
        .query<GoalRunRow, [string, string, string, number]>(
          `SELECT * FROM goal_runs
           WHERE id = ? OR loop_run_id = ? OR workflow_run_id = ?
           ORDER BY created_at ASC LIMIT ?`,
        )
        .all(opts.runId, opts.runId, opts.runId, limit);
    } else {
      rows = this.db.query<GoalRunRow, [number]>("SELECT * FROM goal_runs ORDER BY created_at DESC LIMIT ?").all(limit);
    }
    return rows.map(rowToGoalRun);
  }

  createWorkflowRun(input: CreateWorkflowRunInput): WorkflowRun {
    const now = nowIso();
    if (input.idempotencyKey) {
      const existing = this.db
        .query<WorkflowRunRow, [string, string]>(
          "SELECT * FROM workflow_runs WHERE workflow_id = ? AND idempotency_key = ? LIMIT 1",
        )
        .get(input.workflow.id, input.idempotencyKey);
      if (existing) {
        this.assertDaemonLeaseFence(input);
        return rowToWorkflowRun(existing);
      }
    }

    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.assertDaemonLeaseFence(input, now);
      if (input.idempotencyKey) {
        const existing = this.db
          .query<WorkflowRunRow, [string, string]>(
            "SELECT * FROM workflow_runs WHERE workflow_id = ? AND idempotency_key = ? LIMIT 1",
          )
          .get(input.workflow.id, input.idempotencyKey);
        if (existing) {
          this.db.exec("COMMIT");
          return rowToWorkflowRun(existing);
        }
      }

      const runId = genId();
      this.db
        .query(
          `INSERT INTO workflow_runs (id, workflow_id, workflow_name, loop_id, loop_run_id, scheduled_for, idempotency_key,
            status, started_at, finished_at, duration_ms, error, created_at, updated_at)
           VALUES ($id, $workflowId, $workflowName, $loopId, $loopRunId, $scheduledFor, $idempotencyKey,
            'running', $started, NULL, NULL, NULL, $created, $updated)`,
        )
        .run({
          $id: runId,
          $workflowId: input.workflow.id,
          $workflowName: input.workflow.name,
          $loopId: input.loop?.id ?? null,
          $loopRunId: input.loopRun?.id ?? null,
          $scheduledFor: input.scheduledFor ?? input.loopRun?.scheduledFor ?? null,
          $idempotencyKey: input.idempotencyKey ?? null,
          $started: now,
          $created: now,
          $updated: now,
        });

      input.workflow.steps.forEach((step, sequence) => {
        const account = step.account ?? step.target.account;
        this.db
          .query(
            `INSERT INTO workflow_step_runs (id, workflow_run_id, step_id, sequence, status, started_at, finished_at,
              exit_code, pid, duration_ms, stdout, stderr, error, account_profile, account_tool, created_at, updated_at)
             VALUES ($id, $workflowRunId, $stepId, $sequence, 'pending', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
              $accountProfile, $accountTool, $created, $updated)`,
          )
          .run({
            $id: genId(),
            $workflowRunId: runId,
            $stepId: step.id,
            $sequence: sequence,
            $accountProfile: account?.profile ?? null,
            $accountTool: account?.tool ?? null,
            $created: now,
            $updated: now,
          });
      });

      this.db
        .query(
          `INSERT INTO workflow_events (id, workflow_run_id, sequence, event_type, step_id, payload_json, created_at)
           VALUES ($id, $workflowRunId, 1, 'created', NULL, $payload, $created)`,
        )
        .run({
          $id: genId(),
          $workflowRunId: runId,
          $payload: JSON.stringify({
            workflowId: input.workflow.id,
            workflowName: input.workflow.name,
            stepCount: input.workflow.steps.length,
            loopId: input.loop?.id,
            loopRunId: input.loopRun?.id,
          }),
          $created: now,
        });

      this.db.exec("COMMIT");
      const run = this.getWorkflowRun(runId);
      if (!run) throw new Error(`workflow run not found after create: ${runId}`);
      return run;
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        /* transaction may already be closed */
      }
      throw error;
    }
  }

  getWorkflowRun(id: string): WorkflowRun | undefined {
    const row = this.db.query<WorkflowRunRow, [string]>("SELECT * FROM workflow_runs WHERE id = ?").get(id);
    return row ? rowToWorkflowRun(row) : undefined;
  }

  requireWorkflowRun(id: string): WorkflowRun {
    const run = this.getWorkflowRun(id);
    if (!run) throw new Error(`workflow run not found: ${id}`);
    return run;
  }

  listWorkflowRuns(opts: { workflowId?: string; loopRunId?: string; limit?: number } = {}): WorkflowRun[] {
    const limit = opts.limit ?? 100;
    let rows: WorkflowRunRow[];
    if (opts.workflowId) {
      rows = this.db
        .query<WorkflowRunRow, [string, number]>(
          "SELECT * FROM workflow_runs WHERE workflow_id = ? ORDER BY created_at DESC LIMIT ?",
        )
        .all(opts.workflowId, limit);
    } else if (opts.loopRunId) {
      rows = this.db
        .query<WorkflowRunRow, [string, number]>(
          "SELECT * FROM workflow_runs WHERE loop_run_id = ? ORDER BY created_at DESC LIMIT ?",
        )
        .all(opts.loopRunId, limit);
    } else {
      rows = this.db.query<WorkflowRunRow, [number]>("SELECT * FROM workflow_runs ORDER BY created_at DESC LIMIT ?").all(limit);
    }
    return rows.map(rowToWorkflowRun);
  }

  listWorkflowStepRuns(workflowRunId: string): WorkflowStepRun[] {
    const rows = this.db
      .query<WorkflowStepRunRow, [string]>(
        "SELECT * FROM workflow_step_runs WHERE workflow_run_id = ? ORDER BY sequence ASC",
      )
      .all(workflowRunId);
    return rows.map(rowToWorkflowStepRun);
  }

  getWorkflowStepRun(workflowRunId: string, stepId: string): WorkflowStepRun | undefined {
    const row = this.db
      .query<WorkflowStepRunRow, [string, string]>(
        "SELECT * FROM workflow_step_runs WHERE workflow_run_id = ? AND step_id = ?",
      )
      .get(workflowRunId, stepId);
    return row ? rowToWorkflowStepRun(row) : undefined;
  }

  isWorkflowRunTerminal(workflowRunId: string): boolean {
    const run = this.getWorkflowRun(workflowRunId);
    return Boolean(run && ["succeeded", "failed", "timed_out", "cancelled"].includes(run.status));
  }

  startWorkflowStepRun(workflowRunId: string, stepId: string, opts: DaemonLeaseFence = {}): WorkflowStepRun {
    const now = (opts.now ?? new Date()).toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const res = this.db
        .query(
          `UPDATE workflow_step_runs
           SET status='running', started_at=$started, finished_at=NULL, exit_code=NULL, duration_ms=NULL,
            pid=NULL, stdout=NULL, stderr=NULL, error=NULL, updated_at=$updated
           WHERE workflow_run_id=$workflowRunId
             AND step_id=$stepId
             AND status IN ('pending', 'failed', 'timed_out')
             AND EXISTS (
               SELECT 1 FROM workflow_runs
               WHERE id=$workflowRunId AND status='running'
             )
             AND ($daemonLeaseId IS NULL OR EXISTS (
               SELECT 1 FROM daemon_lease WHERE id=$daemonLeaseId AND expires_at > $now
             ))`,
        )
        .run({
          $workflowRunId: workflowRunId,
          $stepId: stepId,
          $started: now,
          $updated: now,
          $daemonLeaseId: opts.daemonLeaseId ?? null,
          $now: now,
        });
      const run = this.getWorkflowStepRun(workflowRunId, stepId);
      if (!run) throw new Error(`workflow step run not found: ${workflowRunId}/${stepId}`);
      if (res.changes !== 1) {
        throw new Error(`workflow step is not claimable: ${workflowRunId}/${stepId} status=${run.status}`);
      }
      this.appendWorkflowEvent(workflowRunId, "step_started", stepId);
      this.db.exec("COMMIT");
      return run;
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        /* transaction may already be closed */
      }
      throw error;
    }
  }

  markWorkflowStepPid(workflowRunId: string, stepId: string, pid: number, opts: DaemonLeaseFence = {}): WorkflowStepRun {
    const now = (opts.now ?? new Date()).toISOString();
    this.db
      .query(
        `UPDATE workflow_step_runs SET pid=$pid, updated_at=$updated
         WHERE workflow_run_id=$workflowRunId AND step_id=$stepId AND status='running'
           AND ($daemonLeaseId IS NULL OR EXISTS (
             SELECT 1 FROM daemon_lease WHERE id=$daemonLeaseId AND expires_at > $now
           ))`,
      )
      .run({
        $workflowRunId: workflowRunId,
        $stepId: stepId,
        $pid: pid,
        $updated: now,
        $daemonLeaseId: opts.daemonLeaseId ?? null,
        $now: now,
      });
    const run = this.getWorkflowStepRun(workflowRunId, stepId);
    if (!run) throw new Error(`workflow step run not found after pid update: ${workflowRunId}/${stepId}`);
    return run;
  }

  recoverWorkflowRun(workflowRunId: string, reason = "workflow run recovered for retry"): {
    run: WorkflowRun;
    recoveredSteps: WorkflowStepRun[];
  } {
    const now = nowIso();
    const before = this.listWorkflowStepRuns(workflowRunId).filter((step) => step.status === "running");
    const live = before.filter((step) => step.pid !== undefined && isProcessAlive(step.pid));
    if (live.length > 0) {
      throw new Error(
        `cannot recover workflow run while step processes are still alive: ${live
          .map((step) => `${step.stepId} pid=${step.pid}`)
          .join(", ")}`,
      );
    }
    this.db
      .query(
        `UPDATE workflow_step_runs
         SET status='pending', started_at=NULL, finished_at=NULL, exit_code=NULL, pid=NULL, duration_ms=NULL,
          stdout=NULL, stderr=NULL, error=$reason, updated_at=$updated
         WHERE workflow_run_id=$workflowRunId AND status='running'`,
      )
      .run({ $workflowRunId: workflowRunId, $reason: reason, $updated: now });
    if (before.length > 0) {
      this.appendWorkflowEvent(workflowRunId, "recovered", undefined, {
        reason,
        recoveredSteps: before.map((step) => step.stepId),
      });
    }
    return {
      run: this.requireWorkflowRun(workflowRunId),
      recoveredSteps: before.map((step) => this.getWorkflowStepRun(workflowRunId, step.stepId)).filter(Boolean) as WorkflowStepRun[],
    };
  }

  finalizeWorkflowStepRun(
    workflowRunId: string,
    stepId: string,
    patch: Pick<WorkflowStepRun, "status" | "finishedAt" | "durationMs" | "stdout" | "stderr"> &
      Partial<Pick<WorkflowStepRun, "exitCode" | "error">>,
    opts: DaemonLeaseFence = {},
  ): WorkflowStepRun {
    const finishedAt = patch.finishedAt ?? nowIso();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const res = this.db
        .query(
          `UPDATE workflow_step_runs SET status=$status, finished_at=$finished, exit_code=$exitCode, duration_ms=$durationMs,
           pid=NULL, stdout=$stdout, stderr=$stderr, error=$error, updated_at=$updated
           WHERE workflow_run_id=$workflowRunId AND step_id=$stepId AND status='running'
             AND ($daemonLeaseId IS NULL OR EXISTS (
               SELECT 1 FROM daemon_lease WHERE id=$daemonLeaseId AND expires_at > $now
             ))`,
        )
        .run({
          $workflowRunId: workflowRunId,
          $stepId: stepId,
          $status: patch.status,
          $finished: finishedAt,
          $exitCode: patch.exitCode ?? null,
          $durationMs: patch.durationMs ?? null,
          $stdout: patch.stdout ?? null,
          $stderr: patch.stderr ?? null,
          $error: patch.error ?? null,
          $updated: finishedAt,
          $daemonLeaseId: opts.daemonLeaseId ?? null,
          $now: (opts.now ?? new Date(finishedAt)).toISOString(),
        });
      if (res.changes === 1) {
        this.appendWorkflowEvent(workflowRunId, `step_${patch.status}`, stepId, {
          exitCode: patch.exitCode,
          error: patch.error,
        });
      }
      this.db.exec("COMMIT");
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        /* transaction may already be closed */
      }
      throw error;
    }
    const run = this.getWorkflowStepRun(workflowRunId, stepId);
    if (!run) throw new Error(`workflow step run not found after finalize: ${workflowRunId}/${stepId}`);
    return run;
  }

  skipWorkflowStepRun(workflowRunId: string, stepId: string, reason: string, opts: DaemonLeaseFence = {}): WorkflowStepRun {
    const now = (opts.now ?? new Date()).toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const res = this.db
        .query(
          `UPDATE workflow_step_runs SET status='skipped', finished_at=$finished, pid=NULL, error=$error, updated_at=$updated
           WHERE workflow_run_id=$workflowRunId AND step_id=$stepId AND status IN ('pending', 'running')
             AND ($daemonLeaseId IS NULL OR EXISTS (
               SELECT 1 FROM daemon_lease WHERE id=$daemonLeaseId AND expires_at > $now
             ))`,
        )
        .run({
          $workflowRunId: workflowRunId,
          $stepId: stepId,
          $finished: now,
          $error: reason,
          $updated: now,
          $daemonLeaseId: opts.daemonLeaseId ?? null,
          $now: now,
        });
      if (res.changes === 1) this.appendWorkflowEvent(workflowRunId, "step_skipped", stepId, { reason });
      this.db.exec("COMMIT");
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        /* transaction may already be closed */
      }
      throw error;
    }
    const run = this.getWorkflowStepRun(workflowRunId, stepId);
    if (!run) throw new Error(`workflow step run not found after skip: ${workflowRunId}/${stepId}`);
    return run;
  }

  finalizeWorkflowRun(
    workflowRunId: string,
    status: WorkflowRunStatus,
    patch: Partial<Pick<WorkflowRun, "finishedAt" | "durationMs" | "error">> = {},
    opts: DaemonLeaseFence = {},
  ): WorkflowRun {
    const finishedAt = patch.finishedAt ?? nowIso();
    let changed = false;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const res = this.db
        .query(
          `UPDATE workflow_runs SET status=$status, finished_at=$finished, duration_ms=$durationMs, error=$error, updated_at=$updated
           WHERE id=$id AND status NOT IN ('succeeded', 'failed', 'timed_out', 'cancelled')
             AND ($daemonLeaseId IS NULL OR EXISTS (
               SELECT 1 FROM daemon_lease WHERE id=$daemonLeaseId AND expires_at > $now
             ))`,
        )
        .run({
          $id: workflowRunId,
          $status: status,
          $finished: finishedAt,
          $durationMs: patch.durationMs ?? null,
          $error: patch.error ?? null,
          $updated: finishedAt,
          $daemonLeaseId: opts.daemonLeaseId ?? null,
          $now: (opts.now ?? new Date(finishedAt)).toISOString(),
        });
      changed = res.changes === 1;
      if (changed) this.appendWorkflowEvent(workflowRunId, status, undefined, { error: patch.error });
      this.db.exec("COMMIT");
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        /* transaction may already be closed */
      }
      throw error;
    }
    const run = this.getWorkflowRun(workflowRunId);
    if (!run) throw new Error(`workflow run not found after finalize: ${workflowRunId}`);
    void changed;
    return run;
  }

  cancelWorkflowRun(workflowRunId: string, reason = "cancelled by user"): WorkflowRun {
    const now = nowIso();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const run = this.requireWorkflowRun(workflowRunId);
      if (!["succeeded", "failed", "timed_out", "cancelled"].includes(run.status)) {
        this.db
          .query(
            `UPDATE workflow_runs
             SET status='cancelled', finished_at=$finished, error=$reason, updated_at=$updated
             WHERE id=$id AND status NOT IN ('succeeded', 'failed', 'timed_out', 'cancelled')`,
          )
          .run({ $id: workflowRunId, $finished: now, $reason: reason, $updated: now });
        this.db
          .query(
            `UPDATE workflow_step_runs
             SET status='cancelled', finished_at=$finished, pid=NULL, error=$reason, updated_at=$updated
             WHERE workflow_run_id=$workflowRunId AND status IN ('pending', 'running')`,
          )
          .run({ $workflowRunId: workflowRunId, $finished: now, $reason: reason, $updated: now });
        this.appendWorkflowEvent(workflowRunId, "cancelled", undefined, { reason });
      }
      this.db.exec("COMMIT");
      return this.requireWorkflowRun(workflowRunId);
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        /* transaction may already be closed */
      }
      throw error;
    }
  }

  appendWorkflowEvent(
    workflowRunId: string,
    eventType: string,
    stepId?: string,
    payload?: Record<string, unknown>,
  ): WorkflowEvent {
    const now = nowIso();
    const current = this.db
      .query<{ sequence: number | null }, [string]>("SELECT MAX(sequence) AS sequence FROM workflow_events WHERE workflow_run_id = ?")
      .get(workflowRunId);
    const sequence = (current?.sequence ?? 0) + 1;
    const id = genId();
    this.db
      .query(
        `INSERT INTO workflow_events (id, workflow_run_id, sequence, event_type, step_id, payload_json, created_at)
         VALUES ($id, $workflowRunId, $sequence, $eventType, $stepId, $payload, $created)`,
      )
      .run({
        $id: id,
        $workflowRunId: workflowRunId,
        $sequence: sequence,
        $eventType: eventType,
        $stepId: stepId ?? null,
        $payload: payload ? JSON.stringify(payload) : null,
        $created: now,
      });
    const event = this.db.query<WorkflowEventRow, [string]>("SELECT * FROM workflow_events WHERE id = ?").get(id);
    if (!event) throw new Error(`workflow event not found after append: ${id}`);
    return rowToWorkflowEvent(event);
  }

  listWorkflowEvents(workflowRunId: string, limit = 200): WorkflowEvent[] {
    const rows = this.db
      .query<WorkflowEventRow, [string, number]>(
        "SELECT * FROM workflow_events WHERE workflow_run_id = ? ORDER BY sequence ASC LIMIT ?",
      )
      .all(workflowRunId, limit);
    return rows.map(rowToWorkflowEvent);
  }

  hasRunningRun(loopId: string): boolean {
    const row = this.db
      .query<{ count: number }, [string]>("SELECT COUNT(*) AS count FROM loop_runs WHERE loop_id = ? AND status = 'running'")
      .get(loopId);
    return (row?.count ?? 0) > 0;
  }

  hasRunningRunForSlot(loopId: string, scheduledFor: string): boolean {
    const row = this.db
      .query<{ count: number }, [string, string]>(
        "SELECT COUNT(*) AS count FROM loop_runs WHERE loop_id = ? AND scheduled_for = ? AND status = 'running'",
      )
      .get(loopId, scheduledFor);
    return (row?.count ?? 0) > 0;
  }

  markRunPid(id: string, pid: number, claimedBy?: string, opts: DaemonLeaseFence = {}): LoopRun | undefined {
    const now = (opts.now ?? new Date()).toISOString();
    const res = claimedBy
      ? this.db
          .query(
            `UPDATE loop_runs SET pid=$pid, updated_at=$updated
             WHERE id=$id AND status='running' AND claimed_by=$claimedBy
               AND ($daemonLeaseId IS NULL OR EXISTS (
                 SELECT 1 FROM daemon_lease WHERE id=$daemonLeaseId AND expires_at > $now
               ))`,
          )
          .run({
            $id: id,
            $pid: pid,
            $updated: now,
            $claimedBy: claimedBy,
            $daemonLeaseId: opts.daemonLeaseId ?? null,
            $now: now,
          })
      : this.db
          .query(
            `UPDATE loop_runs SET pid=$pid, updated_at=$updated
             WHERE id=$id AND status='running'
               AND ($daemonLeaseId IS NULL OR EXISTS (
                 SELECT 1 FROM daemon_lease WHERE id=$daemonLeaseId AND expires_at > $now
               ))`,
          )
          .run({ $id: id, $pid: pid, $updated: now, $daemonLeaseId: opts.daemonLeaseId ?? null, $now: now });
    if (res.changes !== 1) return undefined;
    return this.getRun(id);
  }

  private hasLiveWorkflowStepProcesses(loopRunId: string): boolean {
    const liveWorkflowSteps = this.db
      .query<{ workflow_run_id: string; step_id: string; pid: number }, [string]>(
        `SELECT wr.id AS workflow_run_id, wsr.step_id AS step_id, wsr.pid AS pid
         FROM workflow_runs wr
         JOIN workflow_step_runs wsr ON wsr.workflow_run_id = wr.id
         WHERE wr.loop_run_id = ?
           AND wr.status NOT IN ('succeeded', 'failed', 'timed_out', 'cancelled')
           AND wsr.status = 'running'
           AND wsr.pid IS NOT NULL`,
      )
      .all(loopRunId);
    return liveWorkflowSteps.some((step) => isProcessAlive(step.pid));
  }

  createSkippedRun(loop: Loop, scheduledFor: string, reason: string, opts: DaemonLeaseFence = {}): LoopRun {
    const now = nowIso();
    const run: LoopRun = {
      id: genId(),
      loopId: loop.id,
      loopName: loop.name,
      scheduledFor,
      attempt: 1,
      status: "skipped",
      finishedAt: now,
      error: reason,
      createdAt: now,
      updatedAt: now,
    };
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.assertDaemonLeaseFence(opts, now);
      this.db
        .query(
          `INSERT OR IGNORE INTO loop_runs (id, loop_id, loop_name, scheduled_for, attempt, status, started_at, finished_at,
            claimed_by, lease_expires_at, pid, exit_code, duration_ms, stdout, stderr, error, created_at, updated_at)
           VALUES ($id, $loopId, $loopName, $scheduledFor, $attempt, $status, NULL, $finished, NULL, NULL, NULL, NULL, NULL,
            NULL, NULL, $error, $created, $updated)`,
        )
        .run({
          $id: run.id,
          $loopId: run.loopId,
          $loopName: run.loopName,
          $scheduledFor: run.scheduledFor,
          $attempt: run.attempt,
          $status: run.status,
          $finished: run.finishedAt ?? null,
          $error: run.error ?? null,
          $created: run.createdAt,
          $updated: run.updatedAt,
        });
      this.db.exec("COMMIT");
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        /* transaction may already be closed */
      }
      throw error;
    }
    return this.getRunBySlot(loop.id, scheduledFor) ?? run;
  }

  getRun(id: string): LoopRun | undefined {
    const row = this.db.query<RunRow, [string]>("SELECT * FROM loop_runs WHERE id = ?").get(id);
    return row ? rowToRun(row) : undefined;
  }

  getRunBySlot(loopId: string, scheduledFor: string): LoopRun | undefined {
    const row = this.db
      .query<RunRow, [string, string]>("SELECT * FROM loop_runs WHERE loop_id = ? AND scheduled_for = ?")
      .get(loopId, scheduledFor);
    return row ? rowToRun(row) : undefined;
  }

  nextRetryableRun(loopId: string, maxAttempts: number, afterScheduledFor?: string): LoopRun | undefined {
    const row = afterScheduledFor
      ? this.db
          .query<RunRow, [string, string, number]>(
            `SELECT * FROM loop_runs
             WHERE loop_id = ? AND scheduled_for > ? AND status IN ('failed', 'timed_out', 'abandoned') AND attempt < ?
             ORDER BY scheduled_for ASC LIMIT 1`,
          )
          .get(loopId, afterScheduledFor, maxAttempts)
      : this.db
          .query<RunRow, [string, number]>(
            `SELECT * FROM loop_runs
             WHERE loop_id = ? AND status IN ('failed', 'timed_out', 'abandoned') AND attempt < ?
             ORDER BY scheduled_for ASC LIMIT 1`,
          )
          .get(loopId, maxAttempts);
    return row ? rowToRun(row) : undefined;
  }

  claimRun(
    loop: Loop,
    scheduledFor: string,
    runnerId: string,
    now: Date = new Date(),
    opts: DaemonLeaseFence = {},
  ): ClaimRunResult | undefined {
    const startedAt = now.toISOString();

    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.assertDaemonLeaseFence(opts, startedAt);
      const currentLoop = this.getLoop(loop.id);
      if (!currentLoop || currentLoop.archivedAt) {
        this.db.exec("COMMIT");
        return undefined;
      }
      loop = currentLoop;
      const leaseExpiresAt = new Date(now.getTime() + loop.leaseMs).toISOString();
      const existing = this.getRunBySlot(loop.id, scheduledFor);

      if (existing) {
        if (existing.status === "running") {
          if (existing.leaseExpiresAt && existing.leaseExpiresAt <= startedAt && existing.pid && isProcessAlive(existing.pid)) {
            this.db.exec("COMMIT");
            return undefined;
          }
          if (existing.leaseExpiresAt && existing.leaseExpiresAt <= startedAt && this.hasLiveWorkflowStepProcesses(existing.id)) {
            this.db.exec("COMMIT");
            return undefined;
          }
          const res = this.db
            .query(
              `UPDATE loop_runs SET status='running', started_at=$started, finished_at=NULL,
               claimed_by=$claimedBy, lease_expires_at=$lease, pid=NULL, exit_code=NULL,
               duration_ms=NULL, stdout=NULL, stderr=NULL, error=NULL, updated_at=$updated
               WHERE id=$id AND status='running' AND lease_expires_at <= $now`,
            )
            .run({
              $id: existing.id,
              $started: startedAt,
              $claimedBy: runnerId,
              $lease: leaseExpiresAt,
              $updated: startedAt,
              $now: startedAt,
            });
          this.db.exec("COMMIT");
          if (res.changes !== 1) return undefined;
          const run = this.getRun(existing.id);
          return run ? { run, loop } : undefined;
        }

        if (existing.status === "succeeded" || existing.status === "skipped") {
          this.db.exec("COMMIT");
          return undefined;
        }

        const attempt = existing.attempt + 1;
        const res = this.db
          .query(
            `UPDATE loop_runs SET attempt=$attempt, status='running', started_at=$started, finished_at=NULL,
             claimed_by=$claimedBy, lease_expires_at=$lease, pid=NULL, exit_code=NULL,
             duration_ms=NULL, stdout=NULL, stderr=NULL, error=NULL, updated_at=$updated
             WHERE id=$id
               AND status IN ('failed', 'timed_out', 'abandoned')
               AND attempt < $maxAttempts`,
          )
          .run({
            $id: existing.id,
            $attempt: attempt,
            $started: startedAt,
            $claimedBy: runnerId,
            $lease: leaseExpiresAt,
            $updated: startedAt,
            $maxAttempts: loop.maxAttempts,
          });
        this.db.exec("COMMIT");
        if (res.changes !== 1) return undefined;
        const run = this.getRun(existing.id);
        return run ? { run, loop } : undefined;
      }

      const id = genId();
      const res = this.db
        .query(
          `INSERT OR IGNORE INTO loop_runs (id, loop_id, loop_name, scheduled_for, attempt, status, started_at, finished_at,
            claimed_by, lease_expires_at, pid, exit_code, duration_ms, stdout, stderr, error, created_at, updated_at)
           VALUES ($id, $loopId, $loopName, $scheduledFor, 1, 'running', $started, NULL, $claimedBy, $lease,
            NULL, NULL, NULL, NULL, NULL, NULL, $created, $updated)`,
        )
        .run({
          $id: id,
          $loopId: loop.id,
          $loopName: loop.name,
          $scheduledFor: scheduledFor,
          $started: startedAt,
          $claimedBy: runnerId,
          $lease: leaseExpiresAt,
          $created: startedAt,
          $updated: startedAt,
        });
      this.db.exec("COMMIT");
      if (res.changes !== 1) return undefined;
      const run = this.getRun(id);
      return run ? { run, loop } : undefined;
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        /* transaction may already be closed */
      }
      throw error;
    }
  }

  finalizeRun(
    id: string,
    patch: Pick<LoopRun, "status" | "finishedAt" | "durationMs" | "stdout" | "stderr"> &
      Partial<Pick<LoopRun, "exitCode" | "error" | "pid">>,
    opts: { claimedBy?: string; now?: Date; daemonLeaseId?: string } = {},
  ): LoopRun {
    const finishedAt = patch.finishedAt ?? nowIso();
    const params = {
      $id: id,
      $status: patch.status,
      $finished: finishedAt,
      $pid: patch.pid ?? null,
      $exitCode: patch.exitCode ?? null,
      $durationMs: patch.durationMs ?? null,
      $stdout: patch.stdout ?? null,
      $stderr: patch.stderr ?? null,
      $error: patch.error ?? null,
      $updated: finishedAt,
      $claimedBy: opts.claimedBy ?? null,
      $now: (opts.now ?? new Date()).toISOString(),
      $daemonLeaseId: opts.daemonLeaseId ?? null,
    };
    const res = opts.claimedBy
      ? this.db
          .query(
            `UPDATE loop_runs SET status=$status, finished_at=$finished, lease_expires_at=NULL, pid=$pid, exit_code=$exitCode,
             duration_ms=$durationMs, stdout=$stdout, stderr=$stderr, error=$error, updated_at=$updated
             WHERE id=$id AND status='running' AND claimed_by=$claimedBy AND lease_expires_at > $now
               AND ($daemonLeaseId IS NULL OR EXISTS (
                 SELECT 1 FROM daemon_lease WHERE id=$daemonLeaseId AND expires_at > $now
               ))`,
          )
          .run(params)
      : this.db
          .query(
            `UPDATE loop_runs SET status=$status, finished_at=$finished, lease_expires_at=NULL, pid=$pid, exit_code=$exitCode,
             duration_ms=$durationMs, stdout=$stdout, stderr=$stderr, error=$error, updated_at=$updated WHERE id=$id`,
          )
          .run(params);
    const run = this.getRun(id);
    if (!run) throw new Error(`run not found after finalize: ${id}`);
    if (opts.claimedBy && res.changes !== 1) return run;
    return run;
  }

  heartbeatRunLease(
    id: string,
    claimedBy: string,
    leaseMs: number,
    now: Date = new Date(),
    opts: DaemonLeaseFence = {},
  ): LoopRun | undefined {
    const expiresAt = new Date(now.getTime() + leaseMs).toISOString();
    const res = this.db
      .query(
        `UPDATE loop_runs SET lease_expires_at=$expires, updated_at=$updated
         WHERE id=$id AND status='running' AND claimed_by=$claimedBy AND lease_expires_at > $now
           AND ($daemonLeaseId IS NULL OR EXISTS (
             SELECT 1 FROM daemon_lease WHERE id=$daemonLeaseId AND expires_at > $now
           ))`,
      )
      .run({
        $id: id,
        $claimedBy: claimedBy,
        $expires: expiresAt,
        $updated: now.toISOString(),
        $now: now.toISOString(),
        $daemonLeaseId: opts.daemonLeaseId ?? null,
      });
    if (res.changes !== 1) return undefined;
    return this.getRun(id);
  }

  listRuns(opts: { loopId?: string; status?: RunStatus; limit?: number } = {}): LoopRun[] {
    const limit = opts.limit ?? 100;
    let rows: RunRow[];
    if (opts.loopId && opts.status) {
      rows = this.db
        .query<RunRow, [string, string, number]>(
          "SELECT * FROM loop_runs WHERE loop_id = ? AND status = ? ORDER BY created_at DESC LIMIT ?",
        )
        .all(opts.loopId, opts.status, limit);
    } else if (opts.loopId) {
      rows = this.db
        .query<RunRow, [string, number]>("SELECT * FROM loop_runs WHERE loop_id = ? ORDER BY created_at DESC LIMIT ?")
        .all(opts.loopId, limit);
    } else if (opts.status) {
      rows = this.db
        .query<RunRow, [string, number]>("SELECT * FROM loop_runs WHERE status = ? ORDER BY created_at DESC LIMIT ?")
        .all(opts.status, limit);
    } else {
      rows = this.db.query<RunRow, [number]>("SELECT * FROM loop_runs ORDER BY created_at DESC LIMIT ?").all(limit);
    }
    return rows.map(rowToRun);
  }

  recoverExpiredRunLeases(now: Date = new Date(), opts: DaemonLeaseFence = {}): LoopRun[] {
    const rows = this.db
      .query<RunRow, [string]>("SELECT * FROM loop_runs WHERE status = 'running' AND lease_expires_at <= ?")
      .all(now.toISOString());
    const recovered: LoopRun[] = [];
    for (const row of rows) {
      if (row.pid && isProcessAlive(row.pid)) continue;
      if (this.hasLiveWorkflowStepProcesses(row.id)) continue;
      const finished = now.toISOString();
      this.db.exec("BEGIN IMMEDIATE");
      try {
        const res = this.db
          .query(
            `UPDATE loop_runs SET status='abandoned', finished_at=$finished, lease_expires_at=NULL,
             error='run lease expired before completion', updated_at=$updated
             WHERE id=$id AND status='running' AND lease_expires_at <= $now
               AND ($daemonLeaseId IS NULL OR EXISTS (
                 SELECT 1 FROM daemon_lease WHERE id=$daemonLeaseId AND expires_at > $now
               ))`,
          )
          .run({
            $id: row.id,
            $finished: finished,
            $updated: finished,
            $now: finished,
            $daemonLeaseId: opts.daemonLeaseId ?? null,
          });
        if (res.changes !== 1) {
          this.db.exec("COMMIT");
          continue;
        }
        const workflowRows = this.db
          .query<WorkflowRunRow, [string]>(
            "SELECT * FROM workflow_runs WHERE loop_run_id = ? AND status NOT IN ('succeeded', 'failed', 'timed_out', 'cancelled')",
          )
          .all(row.id);
        for (const workflowRow of workflowRows) {
          const workflowRes = this.db
            .query(
              `UPDATE workflow_runs
               SET status='failed', finished_at=$finished, error='parent loop run lease expired before completion', updated_at=$updated
               WHERE id=$id AND status NOT IN ('succeeded', 'failed', 'timed_out', 'cancelled')
                 AND ($daemonLeaseId IS NULL OR EXISTS (
                   SELECT 1 FROM daemon_lease WHERE id=$daemonLeaseId AND expires_at > $now
                 ))`,
            )
            .run({
              $id: workflowRow.id,
              $finished: finished,
              $updated: finished,
              $now: finished,
              $daemonLeaseId: opts.daemonLeaseId ?? null,
            });
          if (workflowRes.changes !== 1) continue;
          this.db
            .query(
              `UPDATE workflow_step_runs
               SET status='skipped', finished_at=$finished, pid=NULL, error='parent loop run lease expired before completion', updated_at=$updated
               WHERE workflow_run_id=$workflowRunId AND status IN ('pending', 'running')
                 AND ($daemonLeaseId IS NULL OR EXISTS (
                   SELECT 1 FROM daemon_lease WHERE id=$daemonLeaseId AND expires_at > $now
                 ))`,
            )
            .run({
              $workflowRunId: workflowRow.id,
              $finished: finished,
              $updated: finished,
              $now: finished,
              $daemonLeaseId: opts.daemonLeaseId ?? null,
            });
          this.appendWorkflowEvent(workflowRow.id, "failed", undefined, {
            error: "parent loop run lease expired before completion",
            loopRunId: row.id,
          });
        }
        this.db.exec("COMMIT");
      } catch (error) {
        try {
          this.db.exec("ROLLBACK");
        } catch {
          /* transaction may already be closed */
        }
        throw error;
      }
      const run = this.getRun(row.id);
      if (run) recovered.push(run);
    }
    return recovered;
  }

  expireLoops(now: Date = new Date(), opts: DaemonLeaseFence = {}): Loop[] {
    const rows = this.db
      .query<LoopRow, [string]>(
        "SELECT * FROM loops WHERE status = 'active' AND archived_at IS NULL AND expires_at IS NOT NULL AND expires_at <= ?",
      )
      .all(now.toISOString());
    const expired: Loop[] = [];
    for (const row of rows) {
      const updated = this.updateLoop(row.id, { status: "expired", nextRunAt: undefined }, opts);
      if (updated.status === "expired") expired.push(updated);
    }
    return expired;
  }

  countLoops(status?: LoopStatus, opts: { archived?: boolean; includeArchived?: boolean } = {}): number {
    let row: { count: number } | null | undefined;
    if (status && opts.archived) {
      row = this.db
        .query<{ count: number }, [string]>("SELECT COUNT(*) AS count FROM loops WHERE status = ? AND archived_at IS NOT NULL")
        .get(status);
    } else if (status && opts.includeArchived) {
      row = this.db.query<{ count: number }, [string]>("SELECT COUNT(*) AS count FROM loops WHERE status = ?").get(status);
    } else if (status) {
      row = this.db
        .query<{ count: number }, [string]>("SELECT COUNT(*) AS count FROM loops WHERE status = ? AND archived_at IS NULL")
        .get(status);
    } else if (opts.archived) {
      row = this.db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM loops WHERE archived_at IS NOT NULL").get();
    } else if (opts.includeArchived) {
      row = this.db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM loops").get();
    } else {
      row = this.db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM loops WHERE archived_at IS NULL").get();
    }
    return row?.count ?? 0;
  }

  countRuns(status?: RunStatus): number {
    const row = status
      ? this.db.query<{ count: number }, [string]>("SELECT COUNT(*) AS count FROM loop_runs WHERE status = ?").get(status)
      : this.db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM loop_runs").get();
    return row?.count ?? 0;
  }

  acquireDaemonLease(input: {
    id: string;
    pid: number;
    hostname: string;
    ttlMs: number;
    now?: Date;
  }): DaemonLease | undefined {
    const now = input.now ?? new Date();
    const expiresAt = new Date(now.getTime() + input.ttlMs).toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.db.query<LeaseRow, []>("SELECT * FROM daemon_lease LIMIT 1").get();
      if (existing && existing.expires_at > now.toISOString() && existing.id !== input.id) {
        this.db.exec("COMMIT");
        return undefined;
      }
      this.db.query("DELETE FROM daemon_lease").run();
      this.db
        .query(
          `INSERT INTO daemon_lease (id, pid, hostname, heartbeat_at, expires_at, created_at, updated_at)
           VALUES ($id, $pid, $hostname, $heartbeat, $expires, $created, $updated)`,
        )
        .run({
          $id: input.id,
          $pid: input.pid,
          $hostname: input.hostname,
          $heartbeat: now.toISOString(),
          $expires: expiresAt,
          $created: now.toISOString(),
          $updated: now.toISOString(),
        });
      this.db.exec("COMMIT");
      return this.getDaemonLease();
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        /* transaction may already be closed */
      }
      throw error;
    }
  }

  heartbeatDaemonLease(id: string, ttlMs: number, now: Date = new Date()): DaemonLease | undefined {
    const expiresAt = new Date(now.getTime() + ttlMs).toISOString();
    const res = this.db
      .query(
        `UPDATE daemon_lease SET heartbeat_at=$heartbeat, expires_at=$expires, updated_at=$updated WHERE id=$id AND expires_at > $now`,
      )
      .run({ $id: id, $heartbeat: now.toISOString(), $expires: expiresAt, $updated: now.toISOString(), $now: now.toISOString() });
    if (res.changes !== 1) return undefined;
    return this.getDaemonLease();
  }

  releaseDaemonLease(id: string): void {
    this.db.query("DELETE FROM daemon_lease WHERE id = ?").run(id);
  }

  getDaemonLease(): DaemonLease | undefined {
    const row = this.db.query<LeaseRow, []>("SELECT * FROM daemon_lease LIMIT 1").get();
    return row ? rowToLease(row) : undefined;
  }

  close(): void {
    this.db.close();
  }
}
