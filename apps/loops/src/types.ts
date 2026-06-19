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
}

export type AgentProvider = "claude" | "cursor" | "codewith" | "aicopilot" | "opencode";

export type AgentConfigIsolation = "safe" | "none";

export interface AgentTarget {
  type: "agent";
  provider: AgentProvider;
  prompt: string;
  cwd?: string;
  model?: string;
  agent?: string;
  extraArgs?: string[];
  timeoutMs?: number;
  configIsolation?: AgentConfigIsolation;
}

export type LoopTarget = CommandTarget | AgentTarget;

export interface Loop {
  id: string;
  name: string;
  description?: string;
  status: LoopStatus;
  schedule: ScheduleSpec;
  target: LoopTarget;
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
  createdAt: string;
  updatedAt: string;
}

export interface CreateLoopInput {
  name: string;
  description?: string;
  schedule: ScheduleSpec;
  target: LoopTarget;
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
