import type { GoalSpec } from "./lib/goal/types.js";
export type {
  Goal,
  GoalAutoExecute,
  GoalExecutorResult,
  GoalPlan,
  GoalPlanNode,
  GoalPlanNodeStatus,
  GoalPlanStatus,
  GoalRollup,
  GoalRun,
  GoalSpec,
  GoalStatus,
} from "./lib/goal/types.js";

export type LoopStatus = "active" | "paused" | "stopped" | "expired";

export type RunStatus =
  | "running"
  | "succeeded"
  | "failed"
  | "timed_out"
  | "abandoned"
  | "skipped";

export type CatchUpPolicy = "none" | "latest" | "all";

export type OverlapPolicy = "skip" | "allow";

export type IntervalAnchor = "fixed_rate" | "fixed_delay";

export interface AccountRef {
  profile: string;
  tool?: string;
}

export type LoopMachineRoute = "local" | "lan" | "tailscale" | "ssh" | "unknown";

export type LoopMachineConfidence = "exact" | "high" | "medium" | "low" | "none";

export interface LoopMachineRef {
  id: string;
  requestedId?: string;
  route?: LoopMachineRoute;
  local?: boolean;
  confidence?: LoopMachineConfidence;
  workspacePath?: string;
  resolvedAt?: string;
  packageVersion?: string;
  warnings?: string[];
}

export interface OnceSchedule {
  type: "once";
  at: string;
}

export interface IntervalSchedule {
  type: "interval";
  everyMs: number;
  anchor?: IntervalAnchor;
}

export interface CronSchedule {
  type: "cron";
  expression: string;
}

export interface DynamicSchedule {
  type: "dynamic";
  minIntervalMs?: number;
}

export type ScheduleSpec = OnceSchedule | IntervalSchedule | CronSchedule | DynamicSchedule;

export interface CommandTarget {
  type: "command";
  command: string;
  args?: string[];
  cwd?: string;
  shell?: boolean;
  env?: Record<string, string>;
  timeoutMs?: number;
  account?: AccountRef;
}

export type AgentProvider = "claude" | "cursor" | "codewith" | "aicopilot" | "opencode" | "codex";

export type AgentConfigIsolation = "safe" | "none";
export type AgentSandbox = "read-only" | "workspace-write" | "danger-full-access";

export interface AgentTarget {
  type: "agent";
  provider: AgentProvider;
  prompt: string;
  cwd?: string;
  model?: string;
  agent?: string;
  authProfile?: string;
  extraArgs?: string[];
  timeoutMs?: number;
  configIsolation?: AgentConfigIsolation;
  sandbox?: AgentSandbox;
  account?: AccountRef;
}

export interface WorkflowTarget {
  type: "workflow";
  workflowId: string;
  input?: Record<string, string>;
  timeoutMs?: number;
}

export type ExecutableTarget = CommandTarget | AgentTarget;

export type LoopTarget = ExecutableTarget | WorkflowTarget;

export type WorkflowStatus = "active" | "archived";

export type WorkflowRunStatus = "running" | "succeeded" | "failed" | "timed_out" | "cancelled";

export type WorkflowStepRunStatus = "pending" | "running" | "succeeded" | "failed" | "timed_out" | "skipped" | "cancelled";

export interface WorkflowStep {
  id: string;
  name?: string;
  description?: string;
  target: ExecutableTarget;
  goal?: GoalSpec;
  dependsOn?: string[];
  continueOnFailure?: boolean;
  timeoutMs?: number;
  account?: AccountRef;
}

export interface WorkflowSpec {
  id: string;
  name: string;
  description?: string;
  version: number;
  status: WorkflowStatus;
  goal?: GoalSpec;
  steps: WorkflowStep[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateWorkflowInput {
  name: string;
  description?: string;
  goal?: GoalSpec;
  steps: WorkflowStep[];
  version?: number;
}

export interface WorkflowRun {
  id: string;
  workflowId: string;
  workflowName: string;
  loopId?: string;
  loopRunId?: string;
  scheduledFor?: string;
  idempotencyKey?: string;
  goalRunId?: string;
  status: WorkflowRunStatus;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowStepRun {
  id: string;
  workflowRunId: string;
  stepId: string;
  sequence: number;
  status: WorkflowStepRunStatus;
  startedAt?: string;
  finishedAt?: string;
  exitCode?: number;
  pid?: number;
  durationMs?: number;
  stdout?: string;
  stderr?: string;
  error?: string;
  accountProfile?: string;
  accountTool?: string;
  goalRunId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowEvent {
  id: string;
  workflowRunId: string;
  sequence: number;
  eventType: string;
  stepId?: string;
  payload?: Record<string, unknown>;
  createdAt: string;
}

export interface Loop {
  id: string;
  name: string;
  description?: string;
  labels?: string[];
  status: LoopStatus;
  schedule: ScheduleSpec;
  target: LoopTarget;
  goal?: GoalSpec;
  machine?: LoopMachineRef;
  nextRunAt?: string;
  retryScheduledFor?: string;
  catchUp: CatchUpPolicy;
  catchUpLimit: number;
  overlap: OverlapPolicy;
  maxAttempts: number;
  retryDelayMs: number;
  leaseMs: number;
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface LoopRun {
  id: string;
  loopId: string;
  loopName: string;
  scheduledFor: string;
  attempt: number;
  status: RunStatus;
  startedAt?: string;
  finishedAt?: string;
  claimedBy?: string;
  leaseExpiresAt?: string;
  pid?: number;
  exitCode?: number;
  durationMs?: number;
  stdout?: string;
  stderr?: string;
  error?: string;
  goalRunId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RunArtifactRef {
  kind: "output" | "external";
  ref: string;
  stream?: "stdout" | "stderr";
  path?: string;
  chars?: number;
}

export interface RunReceipt {
  id: string;
  loopId: string;
  runId: string;
  taskId?: string;
  conversationId?: string;
  knowledgeId?: string;
  artifactRefs: RunArtifactRef[];
  summary: Record<string, unknown>;
  createdAt: string;
}

export interface CreateRunReceiptInput {
  runId: string;
  taskId?: string;
  conversationId?: string;
  knowledgeId?: string;
  artifactRefs?: RunArtifactRef[];
  summary?: Record<string, unknown>;
}

export interface CreateLoopInput {
  name: string;
  description?: string;
  labels?: string[];
  schedule: ScheduleSpec;
  target: LoopTarget;
  goal?: GoalSpec;
  machine?: LoopMachineRef;
  catchUp?: CatchUpPolicy;
  catchUpLimit?: number;
  overlap?: OverlapPolicy;
  maxAttempts?: number;
  retryDelayMs?: number;
  leaseMs?: number;
  expiresAt?: string;
}

export interface ExecutorResult {
  status: "succeeded" | "failed" | "timed_out";
  exitCode?: number;
  stdout: string;
  stderr: string;
  error?: string;
  pid?: number;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
}

export interface PersistGuardOptions {
  beforePersist?: () => void;
  daemonLeaseId?: string;
}
