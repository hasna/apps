import type { ExecutableTarget, ExecutorResult, Loop, LoopRun, WorkflowRun, WorkflowRunStatus, WorkflowSpec, WorkflowStep } from "../types.js";
import { executeLoop, executeTarget, preflightTarget, type ExecuteOptions } from "./executor.js";
import { runGoal } from "./goal/runner.js";
import { nowIso } from "./ids.js";
import type { Store } from "./store.js";
import { workflowExecutionOrder } from "./workflow-spec.js";

export interface ExecuteWorkflowOptions extends ExecuteOptions {
  loop?: Loop;
  loopRun?: LoopRun;
  scheduledFor?: string;
  idempotencyKey?: string;
  cancelPollMs?: number;
  signalTimeoutMessage?: () => string | undefined;
}

function targetWithStepAccount(step: WorkflowStep): ExecutableTarget {
  const account = step.account ?? step.target.account;
  const timeoutMs = step.timeoutMs ?? step.target.timeoutMs;
  if (!account && timeoutMs === step.target.timeoutMs) return step.target;
  return { ...step.target, account, timeoutMs } as ExecutableTarget;
}

function workflowResult(
  workflowRun: WorkflowRun,
  status: WorkflowRunStatus,
  startedAt: string,
  finishedAt: string,
  stdout: string,
  error?: string,
): ExecutorResult {
  const executorStatus: ExecutorResult["status"] =
    status === "succeeded" ? "succeeded" : status === "timed_out" ? "timed_out" : "failed";
  return {
    status: executorStatus,
    exitCode: executorStatus === "succeeded" ? 0 : 1,
    stdout,
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
    const workflowWithoutGoal: WorkflowSpec = { ...workflow, goal: undefined };
    return runGoal(store, workflow.goal, {
      ...opts,
      context: {
        loopId: opts.loop?.id,
        loopName: opts.loop?.name,
        loopRunId: opts.loopRun?.id,
        scheduledFor: opts.loopRun?.scheduledFor ?? opts.scheduledFor,
        workflowId: workflow.id,
        workflowName: workflow.name,
      },
      executeNode: async (node) =>
        executeWorkflow(store, workflowWithoutGoal, {
          ...opts,
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
    const steps = store.listWorkflowStepRuns(run.id);
    return workflowResult(
      run,
      run.status,
      startedAt,
      run.finishedAt ?? nowIso(),
      JSON.stringify({ workflowRun: run, steps }, null, 2),
      run.error,
    );
  }
  const ordered = workflowExecutionOrder(workflow);
  const byId = new Map(workflow.steps.map((step) => [step.id, step]));
  let blockingError: string | undefined;
  let terminalStatus: WorkflowRunStatus = "succeeded";

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
    const metadata = {
      loopId: opts.loop?.id,
      loopName: opts.loop?.name,
      runId: opts.loopRun?.id,
      scheduledFor: opts.loopRun?.scheduledFor ?? opts.scheduledFor,
      workflowId: workflow.id,
      workflowName: workflow.name,
      workflowRunId: run.id,
      workflowStepId: step.id,
    };
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
      if (step.goal) {
        result = await runGoal(store, step.goal, {
          ...opts,
          target: targetWithStepAccount(step),
          signal: controller.signal,
          context: {
            loopId: opts.loop?.id,
            loopName: opts.loop?.name,
            loopRunId: opts.loopRun?.id,
            scheduledFor: opts.loopRun?.scheduledFor ?? opts.scheduledFor,
            workflowId: workflow.id,
            workflowName: workflow.name,
            workflowRunId: run.id,
            workflowStepId: step.id,
          },
        });
      } else {
        result = await executeTarget(targetWithStepAccount(step), metadata, {
          ...opts,
          machine: opts.machine ?? opts.loop?.machine,
          signal: controller.signal,
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
    const steps = store.listWorkflowStepRuns(run.id);
    return workflowResult(
      terminalRun,
      terminalRun.status,
      startedAt,
      terminalRun.finishedAt ?? finishedAt,
      JSON.stringify({ workflowRun: terminalRun, steps }, null, 2),
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
  const steps = store.listWorkflowStepRuns(run.id);
  return workflowResult(
    finalRun,
    terminalStatus,
    startedAt,
    finishedAt,
    JSON.stringify({ workflowRun: finalRun, steps }, null, 2),
    blockingError,
  );
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
        target: loop.target,
        context: {
          loopId: loop.id,
          loopName: loop.name,
          loopRunId: run.id,
          scheduledFor: run.scheduledFor,
        },
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
    return runGoal(store, loop.goal, {
      ...opts,
      context: {
        loopId: loop.id,
        loopName: loop.name,
        loopRunId: run.id,
        scheduledFor: run.scheduledFor,
        workflowId: workflow.id,
        workflowName: workflow.name,
      },
      executeNode: async (node) =>
        executeWorkflow(store, workflow, {
          ...opts,
          loop,
          loopRun: run,
          scheduledFor: run.scheduledFor,
          idempotencyKey: `${loop.id}:${run.scheduledFor}:attempt:${run.attempt}:goal:${node.key}`,
        }),
    });
  }
  const controller = loop.target.timeoutMs ? new AbortController() : undefined;
  let workflowTimedOut = false;
  const externalAbort = (): void => controller?.abort();
  if (controller && opts.signal?.aborted) controller.abort();
  if (controller) opts.signal?.addEventListener("abort", externalAbort, { once: true });
  const timer = controller
    ? setTimeout(() => {
        workflowTimedOut = true;
        controller.abort();
      }, loop.target.timeoutMs)
    : undefined;
  timer?.unref();
  try {
    return await executeWorkflow(store, workflow, {
      ...opts,
      signal: controller?.signal ?? opts.signal,
      signalTimeoutMessage: () =>
        workflowTimedOut && loop.target.type === "workflow" ? `workflow timed out after ${loop.target.timeoutMs}ms` : undefined,
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
