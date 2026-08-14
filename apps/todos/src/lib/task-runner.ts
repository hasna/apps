import type { Database } from "bun:sqlite";
import type { Task } from "../types/index.js";
import { getDatabase } from "../db/database.js";
import {
  upsertCheckpoint,
  emitHeartbeat,
  getTaskCheckpoints,
  getTaskProgress,
  getLastHeartbeat,
  type Checkpoint,
  type Heartbeat,
} from "../db/checkpoints.js";
import { getTask } from "../db/task-crud.js";
import { startTask, completeTask, failTask } from "../db/task-lifecycle.js";

export type RetryStrategy =
  | { type: "none" }
  | { type: "fixed"; delay_ms: number; max_attempts: number }
  | { type: "exponential"; base_ms: number; max_attempts: number; max_delay_ms?: number }
  | { type: "linear"; base_ms: number; max_attempts: number };

export interface TaskRunnerOptions {
  agent_id: string;
  retry_strategy?: RetryStrategy;
  heartbeat_interval_ms?: number;
  checkpoint_on_error?: boolean;
}

export interface StepDefinition {
  name: string;
  description?: string;
  max_attempts?: number;
  timeout_ms?: number;
}

export type StepResult = {
  status: "completed" | "failed" | "skipped";
  data?: Record<string, unknown>;
  error?: string;
};

export type StepFn = (ctx: StepContext) => Promise<StepResult> | StepResult;

export interface StepContext {
  task: Task;
  agent_id: string;
  step_name: string;
  attempt: number;
  data: Record<string, unknown>;
  db: Database;
  emitHeartbeat: (opts?: { message?: string; progress?: number; meta?: Record<string, unknown> }) => Heartbeat;
  checkpoint: (updates: Partial<Checkpoint>) => Checkpoint;
}

export class TaskRunner {
  private agentId: string;
  private retryStrategy: RetryStrategy;
  private heartbeatIntervalMs: number;
  private checkpointOnError: boolean;
  private db: Database;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private _aborted = false;
  private _currentStep = "";
  private _stepIndex = 0;

  constructor(opts: TaskRunnerOptions, db?: Database) {
    this.agentId = opts.agent_id;
    this.retryStrategy = opts.retry_strategy ?? { type: "none" };
    this.heartbeatIntervalMs = opts.heartbeat_interval_ms ?? 30_000;
    this.checkpointOnError = opts.checkpoint_on_error ?? true;
    this.db = db || getDatabase();
  }

  abort() {
    this._aborted = true;
    this.stopHeartbeat();
  }

  get aborted() {
    return this._aborted;
  }

  /** Start heartbeats at regular intervals */
  startHeartbeat(taskId: string) {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      emitHeartbeat(taskId, {
        agent_id: this.agentId,
        step: this._currentStep,
        message: "alive",
        meta: { step_index: this._stepIndex, aborted: this._aborted },
      }, this.db);
    }, this.heartbeatIntervalMs);
    this.heartbeatTimer.unref?.();
  }

  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /** Initialize a task run: set runner metadata, create checkpoints for each step */
  init(taskId: string, steps: StepDefinition[]): Task {
    const task = getTask(taskId, this.db);
    if (!task) throw new Error(`Task ${taskId} not found`);

    // Set runner metadata on the task
    this.db.run(
      "UPDATE tasks SET runner_id = ?, runner_started_at = ?, current_step = ?, total_steps = ? WHERE id = ?",
      [this.agentId, new Date().toISOString(), steps[0]?.name ?? null, steps.length, taskId],
    );

    // Create checkpoints for each step
    for (const step of steps) {
      upsertCheckpoint(taskId, step.name, {
        agent_id: this.agentId,
        status: "pending",
        max_attempts: step.max_attempts ?? this.getDefaultMaxAttempts(),
      }, this.db);
    }

    return { ...task, runner_id: this.agentId, current_step: steps[0]?.name ?? null, total_steps: steps.length };
  }

  /** Run all steps sequentially with retry support */
  async run(taskId: string, stepFns: Map<string, StepFn>): Promise<{ success: boolean; steps: StepResult[] }> {
    const checkpoints = getTaskCheckpoints(taskId, this.db);
    const task = getTask(taskId, this.db);
    if (!task) throw new Error(`Task ${taskId} not found`);

    // Resume from last non-completed step
    let startIndex = 0;
    const stepNames = checkpoints.map(c => c.step);
    for (let i = 0; i < checkpoints.length; i++) {
      const cp = checkpoints[i]!;
      if (cp.status === "completed" || cp.status === "skipped") {
        startIndex = i + 1;
      } else if (cp.status === "failed" && this.shouldRetry(cp)) {
        startIndex = i;
        break;
      } else if (cp.status === "failed") {
        // Failed and no more retries — skip
        startIndex = i + 1;
      }
    }

    this.startHeartbeat(taskId);
    const results: StepResult[] = [];

    try {
      for (let i = startIndex; i < stepNames.length; i++) {
        if (this._aborted) {
          // Mark remaining steps as skipped
          for (let j = i; j < stepNames.length; j++) {
            upsertCheckpoint(taskId, stepNames[j]!, { status: "skipped" }, this.db);
          }
          break;
        }

        const stepName = stepNames[i]!;
        const stepFn = stepFns.get(stepName);
        if (!stepFn) {
          const result = { status: "failed" as const, error: `No handler for step: ${stepName}` };
          results.push(result);
          upsertCheckpoint(taskId, stepName, { status: "failed", error: result.error }, this.db);
          continue;
        }

        const checkpoint = checkpoints[i]!;
        const attempt = checkpoint.attempt;
        const stepData = checkpoint.data || {};

        this._currentStep = stepName;
        this._stepIndex = i;

        upsertCheckpoint(taskId, stepName, {
          status: "running",
          attempt,
          started_at: new Date().toISOString(),
        }, this.db);

        // Update task's current step
        this.db.run("UPDATE tasks SET current_step = ? WHERE id = ?", [stepName, taskId]);

        const ctx: StepContext = {
          task,
          agent_id: this.agentId,
          step_name: stepName,
          attempt,
          data: stepData,
          db: this.db,
          emitHeartbeat: (opts) => emitHeartbeat(taskId, { agent_id: this.agentId, step: stepName, ...opts }, this.db),
          checkpoint: (updates) => upsertCheckpoint(taskId, stepName, updates as Parameters<typeof upsertCheckpoint>[2], this.db),
        };

        try {
          const result = await stepFn(ctx);

          if (result.status === "completed") {
            upsertCheckpoint(taskId, stepName, {
              status: "completed",
              data: result.data,
              completed_at: new Date().toISOString(),
            }, this.db);
            results.push(result);
          } else if (result.status === "skipped") {
            upsertCheckpoint(taskId, stepName, { status: "skipped" }, this.db);
            results.push(result);
          } else {
            // Step failed
            await this.handleStepFailure(taskId, stepName, result.error || "Step failed");
            results.push(result);

            if (this.retryStrategy.type === "none") break;
            // For retry, loop will continue with incremented attempt
            i--; // Decrement to retry same step
          }
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          await this.handleStepFailure(taskId, stepName, errorMsg);
          results.push({ status: "failed", error: errorMsg });

          if (this.retryStrategy.type === "none") break;
          i--;
        }
      }
    } finally {
      this.stopHeartbeat();
    }

    const allCompletedOrSkipped = results.every(r => r.status === "completed" || r.status === "skipped");
    const anyFailed = results.some(r => r.status === "failed");

    return { success: allCompletedOrSkipped && !anyFailed, steps: results };
  }

  /** Mark a task run as completed in the DB */
  complete(taskId: string): Task {
    this.db.run(
      "UPDATE tasks SET runner_completed_at = ?, current_step = NULL WHERE id = ?",
      [new Date().toISOString(), taskId],
    );
    emitHeartbeat(taskId, {
      agent_id: this.agentId,
      message: "run completed",
      progress: 1,
    }, this.db);

    return completeTask(taskId, this.agentId, this.db);
  }

  /** Mark a task run as failed */
  fail(taskId: string, reason?: string): { task: Task } {
    this.db.run(
      "UPDATE tasks SET runner_completed_at = ? WHERE id = ?",
      [new Date().toISOString(), taskId],
    );
    return failTask(taskId, this.agentId, reason, { retry: this.retryStrategy.type !== "none" }, this.db);
  }

  /** Get progress summary for a task */
  progress(taskId: string) {
    return getTaskProgress(taskId, this.db);
  }

  /** Get last heartbeat for a task */
  lastHeartbeat(taskId: string) {
    return getLastHeartbeat(taskId, this.db);
  }

  private async handleStepFailure(taskId: string, stepName: string, error: string) {
    const checkpoint = getTaskCheckpoints(taskId, this.db).find(c => c.step === stepName)!;
    const attempts = checkpoint.attempt;
    const maxAttempts = checkpoint.max_attempts;

    if (this.checkpointOnError) {
      upsertCheckpoint(taskId, stepName, {
        status: "failed",
        error,
        attempt: attempts + 1,
        completed_at: new Date().toISOString(),
      }, this.db);
    }

    if (attempts >= maxAttempts) {
      emitHeartbeat(taskId, {
        agent_id: this.agentId,
        step: stepName,
        message: `step failed after ${attempts} attempts: ${error}`,
      }, this.db);
    } else {
      const delay = this.computeRetryDelay(attempts);
      if (delay > 0) {
        await new Promise(resolve => setTimeout(resolve, delay));
      }
      // Increment attempt for retry
      upsertCheckpoint(taskId, stepName, {
        status: "running",
        attempt: attempts + 1,
        started_at: new Date().toISOString(),
      }, this.db);
    }
  }

  private shouldRetry(checkpoint: Checkpoint): boolean {
    if (this.retryStrategy.type === "none") return false;
    return checkpoint.attempt < checkpoint.max_attempts;
  }

  private computeRetryDelay(attempt: number): number {
    switch (this.retryStrategy.type) {
      case "none":
        return 0;
      case "fixed":
        return this.retryStrategy.delay_ms;
      case "exponential": {
        const delay = this.retryStrategy.base_ms * Math.pow(2, attempt - 1);
        return this.retryStrategy.max_delay_ms ? Math.min(delay, this.retryStrategy.max_delay_ms) : delay;
      }
      case "linear":
        return this.retryStrategy.base_ms * attempt;
    }
  }

  private getDefaultMaxAttempts(): number {
    switch (this.retryStrategy.type) {
      case "none":
        return 1;
      case "fixed":
        return this.retryStrategy.max_attempts;
      case "exponential":
        return this.retryStrategy.max_attempts;
      case "linear":
        return this.retryStrategy.max_attempts;
    }
  }
}

/** Convenience: create a runner and claim + start a task in one call */
export function runTask(taskId: string, opts: TaskRunnerOptions): { runner: TaskRunner; task: Task } {
  const db = getDatabase();
  const runner = new TaskRunner(opts, db);
  const task = startTask(taskId, opts.agent_id, db);
  return { runner, task };
}
