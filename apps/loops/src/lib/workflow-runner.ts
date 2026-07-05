import type { ExecutableTarget, ExecutorResult, Loop, LoopRun, WorkflowRun, WorkflowRunStatus, WorkflowSpec, WorkflowStep, WorkflowStepRun } from "../types.js";
import { agentSessionContract } from "./agent-adapter.js";
import { executeLoop, executeTarget, preflightTarget, type ExecuteOptions } from "./executor.js";
import { executionMetadata, goalExecutionContext, withGoalNodeEnv } from "./goal/metadata.js";
import { iterationPrompt } from "./goal/prompts.js";
import { runGoal } from "./goal/runner.js";
import { nowIso } from "./ids.js";
import { BLOCKED_STEP_ERROR_PREFIX, isBlockedStepRun, workflowRunEnvelope } from "./run-envelope.js";
import type { Store } from "./store.js";
import { workflowExecutionOrder } from "./workflow-spec.js";

export interface ExecuteWorkflowOptions extends ExecuteOptions {
  loop?: Loop;
  loopRun?: LoopRun;
  scheduledFor?: string;
  idempotencyKey?: string;
  cancelPollMs?: number;
  signalTimeoutMessage?: () => string | undefined;
  /** Per-node goal prompt appended to agent step prompts when a goal executes this workflow. */
  goalNodePrompt?: string;
}

/** Exit codes that mark a step as blocked (policy control flow) instead of failed. */
const DEFAULT_BLOCKED_EXIT_CODES = [12];
/**
 * Only steps named "gate" as a standalone word (e.g. "gate", "triage-gate",
 * "gate_check") opt into blocked-exit semantics by convention. Substring hits
 * such as "gateway", "aggregate", or "delegate" must never inherit gate
 * behavior; those steps need an explicit `blockedExitCodes` override.
 */
const GATE_STEP_PATTERN = /(^|[^a-z])gate([^a-z]|$)/i;

// blockedExitCodes lives on step JSON; the WorkflowStep type addition belongs to types.ts owners.
type BlockAwareWorkflowStep = WorkflowStep & { blockedExitCodes?: number[] };

function blockedExitCodesForStep(step: WorkflowStep): number[] {
  const explicit = (step as BlockAwareWorkflowStep).blockedExitCodes;
  if (explicit !== undefined) return explicit.filter((code) => Number.isInteger(code));
  return GATE_STEP_PATTERN.test(step.name ? `${step.id} ${step.name}` : step.id) ? DEFAULT_BLOCKED_EXIT_CODES : [];
}

function targetWithStepAccount(step: WorkflowStep, goalNodePrompt?: string): ExecutableTarget {
  const account = step.account ?? step.target.account;
  const timeoutMs = step.timeoutMs !== undefined ? step.timeoutMs : step.target.timeoutMs;
  const target =
    !account && timeoutMs === step.target.timeoutMs ? step.target : ({ ...step.target, account, timeoutMs } as ExecutableTarget);
  if (goalNodePrompt && target.type === "agent") {
    return { ...target, prompt: `${target.prompt}\n\n${goalNodePrompt}` };
  }
  return target;
}

function workflowResult(
  workflowRun: WorkflowRun,
  status: WorkflowRunStatus,
  startedAt: string,
  finishedAt: string,
  steps: WorkflowStepRun[],
  error?: string,
): ExecutorResult {
  const executorStatus: ExecutorResult["status"] =
    status === "succeeded" ? "succeeded" : status === "timed_out" ? "timed_out" : "failed";
  return {
    status: executorStatus,
    exitCode: executorStatus === "succeeded" ? 0 : 1,
    stdout: workflowRunEnvelope(workflowRun, steps),
    stderr: "",
    error,
    startedAt,
    finishedAt,
    durationMs: new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
  };
}

export async function executeWorkflow(
  store: Store,
  workflow: WorkflowSpec,
  opts: ExecuteWorkflowOptions = {},
): Promise<ExecutorResult> {
  if (workflow.goal) {
    const goalSpec = workflow.goal;
    const workflowWithoutGoal: WorkflowSpec = { ...workflow, goal: undefined };
    return runGoal(store, goalSpec, {
      ...opts,
      model: opts.goalModel,
      context: goalExecutionContext({ loop: opts.loop, loopRun: opts.loopRun, scheduledFor: opts.scheduledFor, workflow }),
      executeNode: async (node) =>
        executeWorkflow(store, workflowWithoutGoal, {
          ...opts,
          env: withGoalNodeEnv(opts.env, node),
          goalNodePrompt: iterationPrompt(goalSpec, node),
          idempotencyKey: `${opts.idempotencyKey ?? workflow.id}:goal:${node.key}`,
        }),
    });
  }
  const run = store.createWorkflowRun({
    workflow,
    loop: opts.loop,
    loopRun: opts.loopRun,
    scheduledFor: opts.scheduledFor,
    idempotencyKey: opts.idempotencyKey,
    daemonLeaseId: opts.daemonLeaseId,
  });
  const startedAt = run.startedAt ?? nowIso();
  if (run.status === "succeeded" || run.status === "failed" || run.status === "timed_out" || run.status === "cancelled") {
    return workflowResult(run, run.status, startedAt, run.finishedAt ?? nowIso(), store.listWorkflowStepRuns(run.id), run.error);
  }
  // A resumed idempotent workflow run (createWorkflowRun matched an existing
  // key — e.g. its loop run's lease was stolen and re-claimed at the same
  // attempt, so executeLoopTarget's `...:attempt:${attempt}` key resolves to
  // this still-"running" workflow run) can carry steps left "running" by the
  // interrupted executor. Those are not claimable (startWorkflowStepRun requires
  // pending/failed/timed_out) and would strand the workflow. Reset the dead
  // running steps to pending so they re-run.
  //
  // Only attempt this when EVERY running step already has a recorded pid: a
  // running step with no pid may belong to a *concurrent* executor that started
  // the step but has not yet recorded its child pid, and recovering it would
  // double-run the step and corrupt the peer. recoverWorkflowRun then refuses if
  // any recorded pid is still alive, so a live peer is never disturbed. If we
  // skip (no pid, or a live process), startWorkflowStepRun refuses the double
  // claim and the try/catch below finalizes the run instead of stranding it.
  const resumedRunningSteps = store.listWorkflowStepRuns(run.id).filter((step) => step.status === "running");
  if (resumedRunningSteps.length > 0 && resumedRunningSteps.every((step) => step.pid !== undefined)) {
    try {
      store.recoverWorkflowRun(run.id, "workflow run resumed after lease takeover");
    } catch {
      // A step process is still alive (live peer): leave the steps as-is.
    }
  }
  const ordered = workflowExecutionOrder(workflow);
  const byId = new Map(workflow.steps.map((step) => [step.id, step]));
  let blockingError: string | undefined;
  let terminalStatus: WorkflowRunStatus = "succeeded";

  try {
    for (const step of ordered) {
      if (store.isWorkflowRunTerminal(run.id)) {
        terminalStatus = store.requireWorkflowRun(run.id).status;
        blockingError = "workflow run was cancelled";
        break;
      }
      const pendingTimeout = opts.signal?.aborted ? opts.signalTimeoutMessage?.() : undefined;
      if (pendingTimeout) {
        terminalStatus = "timed_out";
        blockingError = pendingTimeout;
        break;
      }
      const existing = store.getWorkflowStepRun(run.id, step.id);
      if (existing?.status === "succeeded" || existing?.status === "skipped" || existing?.status === "cancelled") continue;

      const blockedBy = (step.dependsOn ?? []).find((dependencyId) => {
        const dependencyRun = store.getWorkflowStepRun(run.id, dependencyId);
        const dependencyStep = byId.get(dependencyId);
        if (dependencyRun?.status === "succeeded") return false;
        return !dependencyStep?.continueOnFailure;
      });
      if (blockedBy) {
        opts.beforePersist?.();
        if (isBlockedStepRun(store.getWorkflowStepRun(run.id, blockedBy))) {
          // Upstream gate blocked by policy: skip dependents without failing the workflow.
          store.skipWorkflowStepRun(run.id, step.id, `${BLOCKED_STEP_ERROR_PREFIX} upstream step ${blockedBy} was blocked`, {
            daemonLeaseId: opts.daemonLeaseId,
          });
          continue;
        }
        store.skipWorkflowStepRun(run.id, step.id, `dependency did not succeed: ${blockedBy}`, { daemonLeaseId: opts.daemonLeaseId });
        blockingError ??= `step ${step.id} blocked by dependency ${blockedBy}`;
        terminalStatus = "failed";
        continue;
      }

      opts.beforePersist?.();
      const startedStep = store.startWorkflowStepRun(run.id, step.id, { daemonLeaseId: opts.daemonLeaseId });
      if (startedStep.status !== "running") {
        terminalStatus = "failed";
        blockingError = `step ${step.id} could not start because workflow is no longer running`;
        break;
      }
      const stepContext = goalExecutionContext({
        loop: opts.loop,
        loopRun: opts.loopRun,
        scheduledFor: opts.scheduledFor,
        workflow,
        workflowRunId: run.id,
        workflowStepId: step.id,
      });
      let result: ExecutorResult;
      const controller = new AbortController();
      const externalAbort = (): void => controller.abort();
      if (opts.signal?.aborted) controller.abort();
      opts.signal?.addEventListener("abort", externalAbort, { once: true });
      const cancelTimer = setInterval(() => {
        if (store.getWorkflowRun(run.id)?.status === "cancelled") controller.abort();
      }, opts.cancelPollMs ?? 500);
      cancelTimer.unref();
      try {
        const baseTarget = targetWithStepAccount(step);
        const executionTarget = step.goal ? baseTarget : targetWithStepAccount(step, opts.goalNodePrompt);
        if (executionTarget.type === "agent") {
          const contract = agentSessionContract(executionTarget);
          if (contract) {
            opts.beforePersist?.();
            store.appendWorkflowEvent(run.id, "agent_session_contract", step.id, contract as unknown as Record<string, unknown>);
          }
        }
        if (step.goal) {
          result = await runGoal(store, step.goal, {
            ...opts,
            model: opts.goalModel,
            target: executionTarget,
            signal: controller.signal,
            context: stepContext,
          });
        } else {
          result = await executeTarget(executionTarget, executionMetadata(stepContext), {
            ...opts,
            machine: opts.machine ?? opts.loop?.machine,
            signal: controller.signal,
            onAgentProgress: (progress) => {
              const stdout = JSON.stringify({ agentProgress: progress }, null, 2);
              opts.beforePersist?.();
              store.recordWorkflowStepProgress(run.id, step.id, {
                stdout,
                payload: progress as unknown as Record<string, unknown>,
              }, {
                daemonLeaseId: opts.daemonLeaseId,
              });
              opts.onAgentProgress?.(progress);
            },
            onSpawn: (pid) => {
              opts.beforePersist?.();
              store.markWorkflowStepPid(run.id, step.id, pid, { daemonLeaseId: opts.daemonLeaseId });
              opts.onSpawn?.(pid);
            },
          });
        }
      } catch (error) {
        const finishedAt = nowIso();
        result = {
          status: "failed",
          stdout: "",
          stderr: "",
          error: error instanceof Error ? error.message : String(error),
          startedAt: startedStep.startedAt ?? finishedAt,
          finishedAt,
          durationMs: new Date(finishedAt).getTime() - new Date(startedStep.startedAt ?? finishedAt).getTime(),
        };
      } finally {
        clearInterval(cancelTimer);
        opts.signal?.removeEventListener("abort", externalAbort);
      }
      const timeoutMessage = opts.signal?.aborted ? opts.signalTimeoutMessage?.() : undefined;
      if (timeoutMessage && result.status === "failed") {
        result = { ...result, status: "timed_out", error: timeoutMessage };
      }
      if (store.isWorkflowRunTerminal(run.id)) {
        terminalStatus = store.requireWorkflowRun(run.id).status;
        blockingError = "workflow run was cancelled";
        break;
      }
      opts.beforePersist?.();
      const blockedExit =
        result.status === "failed" && result.exitCode !== undefined && blockedExitCodesForStep(step).includes(result.exitCode);
      if (blockedExit) {
        // Intentional gate control flow: record as skipped/blocked, never as failure.
        store.finalizeWorkflowStepRun(run.id, step.id, {
          status: "skipped",
          finishedAt: result.finishedAt,
          durationMs: result.durationMs,
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
          error: `${BLOCKED_STEP_ERROR_PREFIX} step ${step.id} exited with blocked exit code ${result.exitCode}`,
        }, {
          daemonLeaseId: opts.daemonLeaseId,
        });
        continue;
      }
      store.finalizeWorkflowStepRun(run.id, step.id, {
        status: result.status,
        finishedAt: result.finishedAt,
        durationMs: result.durationMs,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        error: result.error,
      }, {
        daemonLeaseId: opts.daemonLeaseId,
      });
      if (result.status !== "succeeded" && !step.continueOnFailure) {
        terminalStatus = result.status;
        blockingError = `step ${step.id} ${result.status}${result.error ? `: ${result.error}` : ""}`;
        break;
      }
    }

    if (terminalStatus !== "succeeded") {
      for (const step of ordered) {
        const existing = store.getWorkflowStepRun(run.id, step.id);
        if (existing?.status === "pending" || existing?.status === "running") {
          store.skipWorkflowStepRun(run.id, step.id, blockingError ?? "workflow stopped before step could run", {
            daemonLeaseId: opts.daemonLeaseId,
          });
        }
      }
    }

    const finishedAt = nowIso();
    if (store.isWorkflowRunTerminal(run.id)) {
      const terminalRun = store.requireWorkflowRun(run.id);
      return workflowResult(
        terminalRun,
        terminalRun.status,
        startedAt,
        terminalRun.finishedAt ?? finishedAt,
        store.listWorkflowStepRuns(run.id),
        terminalRun.error ?? blockingError,
      );
    }
    opts.beforePersist?.();
    const finalRun = store.finalizeWorkflowRun(run.id, terminalStatus, {
      finishedAt,
      durationMs: new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
      error: blockingError,
    }, {
      daemonLeaseId: opts.daemonLeaseId,
    });
    return workflowResult(finalRun, terminalStatus, startedAt, finishedAt, store.listWorkflowStepRuns(run.id), blockingError);
  } catch (error) {
    // Finding (3): any unexpected throw inside the step loop (SQLITE_BUSY past
    // busy_timeout, a non-claimable step left "running" by a lease steal, etc.)
    // must not leave workflow_run stuck "running" forever. A genuinely lost
    // daemon lease is re-raised so the daemon's lease-lost handling stops it;
    // everything else finalizes the workflow run as failed (best-effort — the
    // daemon-lease fence still applies, so a lost lease no-ops and lets the new
    // owner finalize) and returns a failed result.
    if (opts.daemonLeaseId && error instanceof Error && error.message === "daemon lease lost") throw error;
    // A "not claimable" step means a peer executor owns it (a concurrent
    // idempotent run, or a resume we deliberately declined to recover because a
    // pid was missing/alive). Propagate without finalizing so the owning
    // executor still drives the shared workflow run to completion — finalizing
    // here would sabotage a live peer's run. Match only the step variant, not
    // the "workflow work item is not claimable" error from createWorkflowRun.
    if (error instanceof Error && error.message.includes("workflow step is not claimable")) throw error;
    const message = error instanceof Error ? error.message : String(error);
    const finishedAt = nowIso();
    try {
      if (!store.isWorkflowRunTerminal(run.id)) {
        store.finalizeWorkflowRun(run.id, "failed", {
          finishedAt,
          durationMs: new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
          error: message,
        }, {
          daemonLeaseId: opts.daemonLeaseId,
        });
      }
    } catch {
      /* best-effort finalize; surface the original failure below regardless */
    }
    const current = store.getWorkflowRun(run.id) ?? run;
    const resultStatus: WorkflowRunStatus = current.status === "running" ? "failed" : current.status;
    return workflowResult(current, resultStatus, startedAt, finishedAt, store.listWorkflowStepRuns(run.id), current.error ?? message);
  }
}

export function preflightWorkflow(workflow: WorkflowSpec, opts: ExecuteOptions = {}): ReturnType<typeof preflightTarget>[] {
  return workflowExecutionOrder(workflow).map((step) => {
    try {
      return {
        workflowStepId: step.id,
        ...preflightTarget(
          targetWithStepAccount(step),
          {
            workflowId: workflow.id,
            workflowName: workflow.name,
            workflowStepId: step.id,
          },
          opts,
        ),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`workflow step ${step.id} preflight failed: ${message}`);
    }
  });
}

function preflightFailureResult(error: unknown, startedAt = nowIso()): ExecutorResult {
  const finishedAt = nowIso();
  return {
    status: "failed",
    stdout: "",
    stderr: "",
    error: `runtime preflight failed: ${error instanceof Error ? error.message : String(error)}`,
    startedAt,
    finishedAt,
    durationMs: new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
  };
}

export async function executeLoopTarget(
  store: Store,
  loop: Loop,
  run: LoopRun,
  opts: ExecuteOptions = {},
): Promise<ExecutorResult> {
  if (loop.target.type !== "workflow") {
    if (loop.goal && loop.target.preflight?.beforeRun) {
      const startedAt = nowIso();
      try {
        preflightTarget(
          loop.target,
          {
            loopId: loop.id,
            loopName: loop.name,
            runId: run.id,
            scheduledFor: run.scheduledFor,
          },
          { ...opts, machine: opts.machine ?? loop.machine },
        );
      } catch (error) {
        return preflightFailureResult(error, startedAt);
      }
    }
    if (loop.goal) {
      return runGoal(store, loop.goal, {
        ...opts,
        model: opts.goalModel,
        target: loop.target,
        context: goalExecutionContext({ loop, loopRun: run }),
      });
    }
    return executeLoop(loop, run, opts);
  }
  const workflow = store.requireWorkflow(loop.target.workflowId);
  if (loop.target.preflight?.beforeRun) {
    const startedAt = nowIso();
    try {
      preflightWorkflow(workflow, { ...opts, machine: opts.machine ?? loop.machine });
    } catch (error) {
      return preflightFailureResult(error, startedAt);
    }
  }
  if (loop.goal) {
    const loopGoal = loop.goal;
    const workflowForLoopGoal: WorkflowSpec = workflow.goal ? { ...workflow, goal: undefined } : workflow;
    return runGoal(store, loopGoal, {
      ...opts,
      model: opts.goalModel,
      context: goalExecutionContext({ loop, loopRun: run, workflow }),
      executeNode: async (node) =>
        executeWorkflow(store, workflowForLoopGoal, {
          ...opts,
          loop,
          loopRun: run,
          scheduledFor: run.scheduledFor,
          env: withGoalNodeEnv(opts.env, node),
          goalNodePrompt: iterationPrompt(loopGoal, node),
          idempotencyKey: `${loop.id}:${run.scheduledFor}:attempt:${run.attempt}:goal:${node.key}`,
        }),
    });
  }
  const workflowTimeoutMs = typeof loop.target.timeoutMs === "number" ? loop.target.timeoutMs : undefined;
  const controller = workflowTimeoutMs !== undefined ? new AbortController() : undefined;
  let workflowTimedOut = false;
  const externalAbort = (): void => controller?.abort();
  if (controller && opts.signal?.aborted) controller.abort();
  if (controller) opts.signal?.addEventListener("abort", externalAbort, { once: true });
  const timer = controller
    ? setTimeout(() => {
        workflowTimedOut = true;
        controller.abort();
      }, workflowTimeoutMs)
    : undefined;
  timer?.unref();
  try {
    return await executeWorkflow(store, workflow, {
      ...opts,
      signal: controller?.signal ?? opts.signal,
      signalTimeoutMessage: () =>
        workflowTimedOut && loop.target.type === "workflow" ? `workflow timed out after ${workflowTimeoutMs}ms` : undefined,
      loop,
      loopRun: run,
      scheduledFor: run.scheduledFor,
      idempotencyKey: `${loop.id}:${run.scheduledFor}:attempt:${run.attempt}`,
    });
  } finally {
    if (timer) clearTimeout(timer);
    if (controller) opts.signal?.removeEventListener("abort", externalAbort);
  }
}
