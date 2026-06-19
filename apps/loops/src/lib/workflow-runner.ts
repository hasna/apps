import type { ExecutableTarget, ExecutorResult, Loop, LoopRun, WorkflowRun, WorkflowSpec, WorkflowStep } from "../types.js";
import { executeLoop, executeTarget, type ExecuteOptions } from "./executor.js";
import { nowIso } from "./ids.js";
import type { Store } from "./store.js";
import { workflowExecutionOrder } from "./workflow-spec.js";

export interface ExecuteWorkflowOptions extends ExecuteOptions {
  loop?: Loop;
  loopRun?: LoopRun;
  scheduledFor?: string;
  idempotencyKey?: string;
}

function targetWithStepAccount(step: WorkflowStep): ExecutableTarget {
  const account = step.account ?? step.target.account;
  if (!account) return step.target;
  return { ...step.target, account } as ExecutableTarget;
}

function workflowResult(
  workflowRun: WorkflowRun,
  status: ExecutorResult["status"],
  startedAt: string,
  finishedAt: string,
  stdout: string,
  error?: string,
): ExecutorResult {
  return {
    status,
    exitCode: status === "succeeded" ? 0 : 1,
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
  const run = store.createWorkflowRun({
    workflow,
    loop: opts.loop,
    loopRun: opts.loopRun,
    scheduledFor: opts.scheduledFor,
    idempotencyKey: opts.idempotencyKey,
  });
  const startedAt = run.startedAt ?? nowIso();
  if (run.status === "succeeded" || run.status === "failed" || run.status === "timed_out") {
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
  let terminalStatus: ExecutorResult["status"] = "succeeded";

  for (const step of ordered) {
    const existing = store.getWorkflowStepRun(run.id, step.id);
    if (existing?.status === "succeeded" || existing?.status === "skipped") continue;

    const blockedBy = (step.dependsOn ?? []).find((dependencyId) => {
      const dependencyRun = store.getWorkflowStepRun(run.id, dependencyId);
      const dependencyStep = byId.get(dependencyId);
      if (dependencyRun?.status === "succeeded") return false;
      return !dependencyStep?.continueOnFailure;
    });
    if (blockedBy) {
      store.skipWorkflowStepRun(run.id, step.id, `dependency did not succeed: ${blockedBy}`);
      blockingError ??= `step ${step.id} blocked by dependency ${blockedBy}`;
      terminalStatus = "failed";
      continue;
    }

    store.startWorkflowStepRun(run.id, step.id);
    const result = await executeTarget(
      targetWithStepAccount(step),
      {
        loopId: opts.loop?.id,
        loopName: opts.loop?.name,
        runId: opts.loopRun?.id,
        scheduledFor: opts.loopRun?.scheduledFor ?? opts.scheduledFor,
        workflowId: workflow.id,
        workflowName: workflow.name,
        workflowRunId: run.id,
        workflowStepId: step.id,
      },
      opts,
    );
    store.finalizeWorkflowStepRun(run.id, step.id, {
      status: result.status,
      finishedAt: result.finishedAt,
      durationMs: result.durationMs,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      error: result.error,
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
        store.skipWorkflowStepRun(run.id, step.id, blockingError ?? "workflow stopped before step could run");
      }
    }
  }

  const finishedAt = nowIso();
  const finalRun = store.finalizeWorkflowRun(run.id, terminalStatus, {
    finishedAt,
    durationMs: new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
    error: blockingError,
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

export async function executeLoopTarget(
  store: Store,
  loop: Loop,
  run: LoopRun,
  opts: ExecuteOptions = {},
): Promise<ExecutorResult> {
  if (loop.target.type !== "workflow") return executeLoop(loop, run, opts);
  const workflow = store.requireWorkflow(loop.target.workflowId);
  return executeWorkflow(store, workflow, {
    ...opts,
    loop,
    loopRun: run,
    scheduledFor: run.scheduledFor,
    idempotencyKey: `${loop.id}:${run.scheduledFor}`,
  });
}
