import type {
  ExecutableTarget,
  ExecutorResult,
  Loop,
  LoopRun,
  StoredWorkflowEvent,
  WorkflowRun,
  WorkflowRunStatus,
  WorkflowSpec,
  WorkflowStep,
  WorkflowStepRun,
} from "../types.js";
import {
  applyBundleExecution,
  bundleRefusalResult,
  executeLoop,
  executeTarget,
  preflightTarget,
  type ExecuteOptions,
} from "./executor.js";
import {
  executionMetadata,
  goalExecutionContext,
  withGoalNodeEnv,
} from "./goal/metadata.js";
import { iterationPrompt } from "./goal/prompts.js";
import { runGoal } from "./goal/runner.js";
import { nowIso } from "./ids.js";
import {
  BLOCKED_STEP_ERROR_PREFIX,
  isBlockedStepRun,
  workflowRunEnvelope,
} from "./run-envelope.js";
import type {
  CreateWorkflowRunInput,
  WorkflowRecoveryContext,
} from "./store.js";
import { workflowExecutionOrder } from "./workflow-spec.js";
import type { GoalRunnerStore } from "./goal/runner.js";
import {
  DEFAULT_OPERATION_LOOKUP_CAPS,
  lookupOperationReceiptState,
  operationAdmissionReceipt,
  operationTerminalReceipt,
  parsePrivateOperationDescriptor,
  privateOperationDescriptorDigest,
  type OperationReceiptState,
  type PrivateOperationDescriptor,
} from "./operation-contract.js";
import { DuplicateWorkflowEventError, ValidationError } from "./errors.js";
import { workflowDefinitionHash } from "./workflow-provenance.js";

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

type MaybePromise<T> = T | Promise<T>;

export interface WorkflowExecutionStore extends GoalRunnerStore {
  /** Hosted runners receive server-derived contract events and must not append client-authored copies. */
  readonly serverDerivedAgentSessionContracts?: boolean;
  requireWorkflow(idOrName: string): MaybePromise<WorkflowSpec>;
  createWorkflowRun(input: CreateWorkflowRunInput): MaybePromise<WorkflowRun>;
  getWorkflowRun(id: string): MaybePromise<WorkflowRun | undefined>;
  requireWorkflowRun(id: string): MaybePromise<WorkflowRun>;
  listWorkflowStepRuns(workflowRunId: string): MaybePromise<WorkflowStepRun[]>;
  getWorkflowStepRun(
    workflowRunId: string,
    stepId: string,
  ): MaybePromise<WorkflowStepRun | undefined>;
  isWorkflowRunTerminal(workflowRunId: string): MaybePromise<boolean>;
  startWorkflowStepRun(
    workflowRunId: string,
    stepId: string,
    opts?: { daemonLeaseId?: string; now?: Date },
  ): MaybePromise<WorkflowStepRun>;
  recoverWorkflowRun(
    workflowRunId: string,
    reason?: string,
    context?: WorkflowRecoveryContext,
  ): MaybePromise<{ run: WorkflowRun; recoveredSteps: WorkflowStepRun[] }>;
  finalizeWorkflowStepRun(
    workflowRunId: string,
    stepId: string,
    patch: Pick<
      WorkflowStepRun,
      "status" | "finishedAt" | "durationMs" | "stdout" | "stderr"
    > &
      Partial<Pick<WorkflowStepRun, "exitCode" | "error">>,
    opts?: { daemonLeaseId?: string; now?: Date },
  ): MaybePromise<WorkflowStepRun>;
  finalizeWorkflowRun(
    workflowRunId: string,
    status: WorkflowRunStatus,
    patch?: Partial<Pick<WorkflowRun, "finishedAt" | "durationMs" | "error">>,
    opts?: { daemonLeaseId?: string; now?: Date },
  ): MaybePromise<WorkflowRun>;
  markWorkflowStepPid(
    workflowRunId: string,
    stepId: string,
    pid: number,
    opts?: { daemonLeaseId?: string; now?: Date },
  ): MaybePromise<WorkflowStepRun>;
  recordWorkflowStepProgress(
    workflowRunId: string,
    stepId: string,
    progress: {
      stdout?: string;
      stderr?: string;
      payload?: Record<string, unknown>;
    },
    opts?: { daemonLeaseId?: string; now?: Date },
  ): MaybePromise<WorkflowStepRun>;
  appendWorkflowEvent(
    workflowRunId: string,
    eventType: string,
    stepId?: string,
    payload?: Record<string, unknown>,
  ): MaybePromise<unknown>;
  listWorkflowEvents?(
    workflowRunId: string,
    limit?: number,
  ): MaybePromise<StoredWorkflowEvent[]>;
  getPrivateOperationDescriptor?(
    workflowRunId: string,
    stepId: string,
  ): MaybePromise<PrivateOperationDescriptor>;
  getPrivateOperationState?(
    workflowRunId: string,
    stepId: string,
  ): MaybePromise<OperationReceiptState>;
  skipWorkflowStepRun(
    workflowRunId: string,
    stepId: string,
    reason: string,
    opts?: { daemonLeaseId?: string; now?: Date },
  ): MaybePromise<WorkflowStepRun>;
}

async function operationDescriptorForStep(
  store: WorkflowExecutionStore,
  workflow: WorkflowSpec,
  workflowRunId: string,
  step: WorkflowStep,
): Promise<PrivateOperationDescriptor> {
  const descriptor = store.getPrivateOperationDescriptor
    ? await store.getPrivateOperationDescriptor(workflowRunId, step.id)
    : parsePrivateOperationDescriptor(
        (
          await store.listWorkflowEvents?.(
            workflowRunId,
            DEFAULT_OPERATION_LOOKUP_CAPS.maxRecords + 1,
          )
        )?.find(
          (event) =>
            event.eventType === "private_operation_descriptor" &&
            event.stepId === step.id,
        )?.payload,
      );
  if (
    descriptor.workflowRunId !== workflowRunId ||
    descriptor.workflowId !== workflow.id ||
    descriptor.workflowDefinitionHash !== workflowDefinitionHash(workflow) ||
    descriptor.entityRevision !== workflow.updatedAt ||
    descriptor.stepId !== step.id
  ) {
    throw new ValidationError(
      `private operation descriptor binding mismatch for step ${step.id}`,
    );
  }
  return descriptor;
}

async function operationStateForStep(
  store: WorkflowExecutionStore,
  descriptor: PrivateOperationDescriptor,
): Promise<ReturnType<typeof lookupOperationReceiptState>> {
  if (store.getPrivateOperationState) {
    return await store.getPrivateOperationState(
      descriptor.workflowRunId,
      descriptor.stepId,
    );
  }
  if (!store.listWorkflowEvents) {
    return { descriptor };
  }
  const events = await store.listWorkflowEvents(
    descriptor.workflowRunId,
    DEFAULT_OPERATION_LOOKUP_CAPS.maxRecords + 1,
  );
  return lookupOperationReceiptState(events, {
    workflowRunId: descriptor.workflowRunId,
    stepId: descriptor.stepId,
    authority: descriptor.authority,
    operationId: descriptor.operationId,
  });
}

async function appendImmutableOperationEvent(
  store: WorkflowExecutionStore,
  descriptor: PrivateOperationDescriptor,
  eventType: "private_operation_admitted" | "private_operation_terminal",
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    await store.appendWorkflowEvent(
      descriptor.workflowRunId,
      eventType,
      descriptor.stepId,
      payload,
    );
  } catch (error) {
    if (
      !(error instanceof DuplicateWorkflowEventError) ||
      !store.listWorkflowEvents
    )
      throw error;
    const state = await operationStateForStep(store, descriptor);
    const existing =
      eventType === "private_operation_admitted"
        ? state.admission
        : state.terminal;
    if (JSON.stringify(existing) !== JSON.stringify(payload)) throw error;
  }
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
  if (explicit !== undefined)
    return explicit.filter((code) => Number.isInteger(code));
  return GATE_STEP_PATTERN.test(step.name ? `${step.id} ${step.name}` : step.id)
    ? DEFAULT_BLOCKED_EXIT_CODES
    : [];
}

type WorkflowStepResult = Omit<ExecutorResult, "status"> & {
  status: ExecutorResult["status"] | "cancelled" | "skipped";
};

async function finalizeWorkflowStepResult(
  store: WorkflowExecutionStore,
  workflowRunId: string,
  step: WorkflowStep,
  result: WorkflowStepResult,
  opts: Pick<ExecuteWorkflowOptions, "daemonLeaseId">,
): Promise<WorkflowStepResult["status"]> {
  const blockedExit =
    result.status === "failed" &&
    result.exitCode !== undefined &&
    blockedExitCodesForStep(step).includes(result.exitCode);
  if (blockedExit) {
    await store.finalizeWorkflowStepRun(
      workflowRunId,
      step.id,
      {
        status: "skipped",
        finishedAt: result.finishedAt,
        durationMs: result.durationMs,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        error: `${BLOCKED_STEP_ERROR_PREFIX} step ${step.id} exited with blocked exit code ${result.exitCode}`,
      },
      {
        daemonLeaseId: opts.daemonLeaseId,
      },
    );
    return "skipped";
  }
  await store.finalizeWorkflowStepRun(
    workflowRunId,
    step.id,
    {
      status: result.status,
      finishedAt: result.finishedAt,
      durationMs: result.durationMs,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      error: result.error,
    },
    {
      daemonLeaseId: opts.daemonLeaseId,
    },
  );
  return result.status;
}

function targetWithStepAccount(
  step: WorkflowStep,
  goalNodePrompt?: string,
): ExecutableTarget {
  const account = step.account ?? step.target.account;
  const timeoutMs =
    step.timeoutMs !== undefined ? step.timeoutMs : step.target.timeoutMs;
  const target =
    !account && timeoutMs === step.target.timeoutMs
      ? step.target
      : ({ ...step.target, account, timeoutMs } as ExecutableTarget);
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
    status === "succeeded"
      ? "succeeded"
      : status === "timed_out"
        ? "timed_out"
        : "failed";
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
  store: WorkflowExecutionStore,
  workflow: WorkflowSpec,
  opts: ExecuteWorkflowOptions = {},
): Promise<ExecutorResult> {
  if (workflow.goal) {
    const goalSpec = workflow.goal;
    const workflowWithoutGoal: WorkflowSpec = { ...workflow, goal: undefined };
    return runGoal(store, goalSpec, {
      ...opts,
      model: opts.goalModel,
      context: goalExecutionContext({
        loop: opts.loop,
        loopRun: opts.loopRun,
        scheduledFor: opts.scheduledFor,
        workflow,
      }),
      executeNode: async (node) =>
        executeWorkflow(store, workflowWithoutGoal, {
          ...opts,
          env: withGoalNodeEnv(opts.env, node),
          goalNodePrompt: iterationPrompt(goalSpec, node),
          idempotencyKey: `${opts.idempotencyKey ?? workflow.id}:goal:${node.key}`,
        }),
    });
  }
  const run = await store.createWorkflowRun({
    workflow,
    loop: opts.loop,
    loopRun: opts.loopRun,
    scheduledFor: opts.scheduledFor,
    idempotencyKey: opts.idempotencyKey,
    daemonLeaseId: opts.daemonLeaseId,
  });
  const startedAt = run.startedAt ?? nowIso();
  if (
    run.status === "succeeded" ||
    run.status === "failed" ||
    run.status === "timed_out" ||
    run.status === "cancelled"
  ) {
    return workflowResult(
      run,
      run.status,
      startedAt,
      run.finishedAt ?? nowIso(),
      await store.listWorkflowStepRuns(run.id),
      run.error,
    );
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
  const resumedRunningSteps = (await store.listWorkflowStepRuns(run.id)).filter(
    (step) => step.status === "running",
  );
  const reconciledTerminalResults = new Map<string, WorkflowStepResult>();
  for (const resumedStep of resumedRunningSteps) {
    const workflowStep = workflow.steps.find(
      (step) => step.id === resumedStep.stepId,
    );
    if (!workflowStep)
      throw new ValidationError(
        `workflow step missing during resume: ${resumedStep.stepId}`,
      );
    const descriptor = await operationDescriptorForStep(
      store,
      workflow,
      run.id,
      workflowStep,
    );
    const operation = await operationStateForStep(store, descriptor);
    if (operation.terminal) {
      const finishedAt = nowIso();
      const terminalResult: WorkflowStepResult = {
        status: operation.terminal.state,
        startedAt: resumedStep.startedAt ?? finishedAt,
        finishedAt,
        durationMs: operation.terminal.durationMs ?? 0,
        stdout: "",
        stderr: "",
        exitCode: operation.terminal.exitCode,
        error:
          operation.terminal.state === "succeeded"
            ? undefined
            : `reconciled from immutable operation receipt ${operation.terminal.receiptId}`,
      };
      const status = await finalizeWorkflowStepResult(
        store,
        run.id,
        workflowStep,
        terminalResult,
        opts,
      );
      reconciledTerminalResults.set(resumedStep.stepId, {
        ...terminalResult,
        status,
      });
      continue;
    }
    if (operation.admission) {
      const error = `operation outcome uncertain after admission receipt ${operation.admission.receiptId}; reconciliation required`;
      await store.finalizeWorkflowStepRun(
        run.id,
        resumedStep.stepId,
        {
          status: "failed",
          finishedAt: nowIso(),
          durationMs: 0,
          stdout: "",
          stderr: "",
          error,
        },
        { daemonLeaseId: opts.daemonLeaseId },
      );
      const finalRun = await store.finalizeWorkflowRun(
        run.id,
        "failed",
        {
          finishedAt: nowIso(),
          error,
        },
        { daemonLeaseId: opts.daemonLeaseId },
      );
      return workflowResult(
        finalRun,
        "failed",
        startedAt,
        finalRun.finishedAt ?? nowIso(),
        await store.listWorkflowStepRuns(run.id),
        error,
      );
    }
  }
  const unreconciledRunningSteps = (
    await store.listWorkflowStepRuns(run.id)
  ).filter((step) => step.status === "running");
  if (
    unreconciledRunningSteps.length > 0 &&
    unreconciledRunningSteps.every((step) => step.pid !== undefined)
  ) {
    try {
      await store.recoverWorkflowRun(
        run.id,
        "workflow run resumed after lease takeover",
      );
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
      if (await store.isWorkflowRunTerminal(run.id)) {
        terminalStatus = (await store.requireWorkflowRun(run.id)).status;
        blockingError = "workflow run was cancelled";
        break;
      }
      const pendingTimeout = opts.signal?.aborted
        ? opts.signalTimeoutMessage?.()
        : undefined;
      if (pendingTimeout) {
        terminalStatus = "timed_out";
        blockingError = pendingTimeout;
        break;
      }
      const existing = await store.getWorkflowStepRun(run.id, step.id);
      const reconciledTerminal = reconciledTerminalResults.get(step.id);
      if (reconciledTerminal) {
        if (
          reconciledTerminal.status === "succeeded" ||
          reconciledTerminal.status === "skipped"
        )
          continue;
        if (reconciledTerminal.status === "cancelled") {
          terminalStatus = "cancelled";
          blockingError = `step ${step.id} cancelled`;
          break;
        }
        if (!step.continueOnFailure) {
          terminalStatus = reconciledTerminal.status;
          blockingError = `step ${step.id} ${reconciledTerminal.status}${reconciledTerminal.error ? `: ${reconciledTerminal.error}` : ""}`;
          break;
        }
        continue;
      }
      if (
        existing?.status === "succeeded" ||
        existing?.status === "skipped" ||
        existing?.status === "cancelled"
      )
        continue;

      let blockedBy: string | undefined;
      for (const dependencyId of step.dependsOn ?? []) {
        const dependencyRun = await store.getWorkflowStepRun(
          run.id,
          dependencyId,
        );
        const dependencyStep = byId.get(dependencyId);
        if (dependencyRun?.status === "succeeded") continue;
        if (!dependencyStep?.continueOnFailure) {
          blockedBy = dependencyId;
          break;
        }
      }
      if (blockedBy) {
        opts.beforePersist?.();
        if (
          isBlockedStepRun(await store.getWorkflowStepRun(run.id, blockedBy))
        ) {
          // Upstream gate blocked by policy: skip dependents without failing the workflow.
          await store.skipWorkflowStepRun(
            run.id,
            step.id,
            `${BLOCKED_STEP_ERROR_PREFIX} upstream step ${blockedBy} was blocked`,
            {
              daemonLeaseId: opts.daemonLeaseId,
            },
          );
          continue;
        }
        await store.skipWorkflowStepRun(
          run.id,
          step.id,
          `dependency did not succeed: ${blockedBy}`,
          { daemonLeaseId: opts.daemonLeaseId },
        );
        blockingError ??= `step ${step.id} blocked by dependency ${blockedBy}`;
        terminalStatus = "failed";
        continue;
      }

      opts.beforePersist?.();
      const startedStep = await store.startWorkflowStepRun(run.id, step.id, {
        daemonLeaseId: opts.daemonLeaseId,
      });
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
      const operationDescriptor = await operationDescriptorForStep(
        store,
        workflow,
        run.id,
        step,
      );
      await appendImmutableOperationEvent(
        store,
        operationDescriptor,
        "private_operation_admitted",
        operationAdmissionReceipt(operationDescriptor) as unknown as Record<
          string,
          unknown
        >,
      );
      let result: ExecutorResult;
      const controller = new AbortController();
      const externalAbort = (): void => controller.abort();
      const pendingPersists: Promise<void>[] = [];
      const persistLater = (write: MaybePromise<unknown>): void => {
        pendingPersists.push(Promise.resolve(write).then(() => undefined));
      };
      if (opts.signal?.aborted) controller.abort();
      opts.signal?.addEventListener("abort", externalAbort, { once: true });
      const cancelTimer = setInterval(() => {
        void Promise.resolve(store.getWorkflowRun(run.id)).then((current) => {
          if (current?.status === "cancelled") controller.abort();
        });
      }, opts.cancelPollMs ?? 500);
      cancelTimer.unref();
      try {
        if (
          operationDescriptor.descriptorDigest !==
          privateOperationDescriptorDigest(step.target)
        ) {
          throw new ValidationError(
            `private operation descriptor target mismatch for step ${step.id}`,
          );
        }
        const executionTarget = targetWithStepAccount(
          step,
          step.goal ? undefined : opts.goalNodePrompt,
        );
        if (step.goal) {
          result = await runGoal(store, step.goal, {
            ...opts,
            model: opts.goalModel,
            target: executionTarget,
            signal: controller.signal,
            context: stepContext,
          });
        } else {
          result = await executeTarget(
            executionTarget,
            executionMetadata(stepContext),
            {
              ...opts,
              machine: opts.machine ?? opts.loop?.machine,
              signal: controller.signal,
              onAgentProgress: (progress) => {
                const stdout = JSON.stringify(
                  { agentProgress: progress },
                  null,
                  2,
                );
                opts.beforePersist?.();
                persistLater(
                  store.recordWorkflowStepProgress(
                    run.id,
                    step.id,
                    {
                      stdout,
                      payload: progress as unknown as Record<string, unknown>,
                    },
                    {
                      daemonLeaseId: opts.daemonLeaseId,
                    },
                  ),
                );
                opts.onAgentProgress?.(progress);
              },
              onSpawn: (pid) => {
                opts.beforePersist?.();
                persistLater(
                  store.markWorkflowStepPid(run.id, step.id, pid, {
                    daemonLeaseId: opts.daemonLeaseId,
                  }),
                );
                opts.onSpawn?.(pid);
              },
            },
          );
        }
        await Promise.all(pendingPersists);
      } catch (error) {
        const finishedAt = nowIso();
        result = {
          status: "failed",
          stdout: "",
          stderr: "",
          error: error instanceof Error ? error.message : String(error),
          startedAt: startedStep.startedAt ?? finishedAt,
          finishedAt,
          durationMs:
            new Date(finishedAt).getTime() -
            new Date(startedStep.startedAt ?? finishedAt).getTime(),
        };
      } finally {
        clearInterval(cancelTimer);
        opts.signal?.removeEventListener("abort", externalAbort);
      }
      const timeoutMessage = opts.signal?.aborted
        ? opts.signalTimeoutMessage?.()
        : undefined;
      if (timeoutMessage && result.status === "failed") {
        result = { ...result, status: "timed_out", error: timeoutMessage };
      }
      await appendImmutableOperationEvent(
        store,
        operationDescriptor,
        "private_operation_terminal",
        operationTerminalReceipt(
          operationDescriptor,
          result,
        ) as unknown as Record<string, unknown>,
      );
      if (await store.isWorkflowRunTerminal(run.id)) {
        terminalStatus = (await store.requireWorkflowRun(run.id)).status;
        blockingError = "workflow run was cancelled";
        break;
      }
      opts.beforePersist?.();
      const finalizedStatus = await finalizeWorkflowStepResult(
        store,
        run.id,
        step,
        result,
        opts,
      );
      if (finalizedStatus === "skipped") continue;
      if (finalizedStatus !== "succeeded" && !step.continueOnFailure) {
        terminalStatus = finalizedStatus;
        blockingError = `step ${step.id} ${finalizedStatus}${result.error ? `: ${result.error}` : ""}`;
        break;
      }
    }

    if (terminalStatus !== "succeeded") {
      for (const step of ordered) {
        const existing = await store.getWorkflowStepRun(run.id, step.id);
        if (existing?.status === "pending" || existing?.status === "running") {
          await store.skipWorkflowStepRun(
            run.id,
            step.id,
            blockingError ?? "workflow stopped before step could run",
            {
              daemonLeaseId: opts.daemonLeaseId,
            },
          );
        }
      }
    }

    const finishedAt = nowIso();
    if (await store.isWorkflowRunTerminal(run.id)) {
      const terminalRun = await store.requireWorkflowRun(run.id);
      return workflowResult(
        terminalRun,
        terminalRun.status,
        startedAt,
        terminalRun.finishedAt ?? finishedAt,
        await store.listWorkflowStepRuns(run.id),
        terminalRun.error ?? blockingError,
      );
    }
    opts.beforePersist?.();
    const finalRun = await store.finalizeWorkflowRun(
      run.id,
      terminalStatus,
      {
        finishedAt,
        durationMs:
          new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
        error: blockingError,
      },
      {
        daemonLeaseId: opts.daemonLeaseId,
      },
    );
    return workflowResult(
      finalRun,
      terminalStatus,
      startedAt,
      finishedAt,
      await store.listWorkflowStepRuns(run.id),
      blockingError,
    );
  } catch (error) {
    // Finding (3): any unexpected throw inside the step loop (SQLITE_BUSY past
    // busy_timeout, a non-claimable step left "running" by a lease steal, etc.)
    // must not leave workflow_run stuck "running" forever. A genuinely lost
    // daemon lease is re-raised so the daemon's lease-lost handling stops it;
    // everything else finalizes the workflow run as failed (best-effort — the
    // daemon-lease fence still applies, so a lost lease no-ops and lets the new
    // owner finalize) and returns a failed result.
    if (
      opts.daemonLeaseId &&
      error instanceof Error &&
      error.message === "daemon lease lost"
    )
      throw error;
    // A "not claimable" step means a peer executor owns it (a concurrent
    // idempotent run, or a resume we deliberately declined to recover because a
    // pid was missing/alive). Propagate without finalizing so the owning
    // executor still drives the shared workflow run to completion — finalizing
    // here would sabotage a live peer's run. Match only the step variant, not
    // the "workflow work item is not claimable" error from createWorkflowRun.
    if (
      error instanceof Error &&
      error.message.includes("workflow step is not claimable")
    )
      throw error;
    const message = error instanceof Error ? error.message : String(error);
    const finishedAt = nowIso();
    try {
      if (!(await store.isWorkflowRunTerminal(run.id))) {
        await store.finalizeWorkflowRun(
          run.id,
          "failed",
          {
            finishedAt,
            durationMs:
              new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
            error: message,
          },
          {
            daemonLeaseId: opts.daemonLeaseId,
          },
        );
      }
    } catch {
      /* best-effort finalize; surface the original failure below regardless */
    }
    const current = (await store.getWorkflowRun(run.id)) ?? run;
    const resultStatus: WorkflowRunStatus =
      current.status === "running" ? "failed" : current.status;
    return workflowResult(
      current,
      resultStatus,
      startedAt,
      finishedAt,
      await store.listWorkflowStepRuns(run.id),
      current.error ?? message,
    );
  }
}

export function preflightWorkflow(
  workflow: WorkflowSpec,
  opts: ExecuteOptions = {},
): ReturnType<typeof preflightTarget>[] {
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

function preflightFailureResult(
  error: unknown,
  startedAt = nowIso(),
): ExecutorResult {
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
  store: WorkflowExecutionStore,
  loop: Loop,
  run: LoopRun,
  opts: ExecuteOptions = {},
): Promise<ExecutorResult> {
  // ── the bundle digest gate ────────────────────────────────────────────────
  //
  // BEFORE the goal/workflow branches, because this function is the single
  // door every production entry point comes through — the daemon, the
  // scheduler and the remote runner all call it — and both branches below used
  // to route around `executeLoop`, which was the only place the gate lived. A
  // bundled loop carrying a `goal` therefore ran whatever was in `scripts/`
  // tick after tick with no digest verification, no drift refusal and no
  // `bundle` block on its receipt; a `workflow` target skipped it the same
  // way. That is reachable through the feature's own surface rather than by
  // hand-editing a row: `applyDefinitionToLoop` writes `goal` onto the loop
  // straight out of the bundle's own loop.json, so a pushed bundle could move
  // its own loop into the ungated path.
  //
  // Gating here covers all three shapes at once. For a command target the
  // decision also carries the bundle-root-resolved command and cwd, which is
  // what the goal path must execute — `runGoal` builds each node's target from
  // the one it is given, so handing it the RAW stored target would resolve
  // `scripts/run.sh` against $PWD.
  const bundled = applyBundleExecution(loop, opts);
  if ("refusal" in bundled) return bundleRefusalResult(bundled.refusal);
  // A bundled run's receipt answers "what code ran here?" on every path, not
  // only the plain-command one.
  const stampBundle = (result: ExecutorResult): ExecutorResult =>
    bundled.bundle ? { ...result, bundle: bundled.bundle } : result;
  const target = bundled.target;

  if (loop.target.type !== "workflow") {
    if (loop.goal && target.preflight?.beforeRun) {
      const startedAt = nowIso();
      try {
        preflightTarget(
          target,
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
      return stampBundle(
        await runGoal(store, loop.goal, {
          ...opts,
          model: opts.goalModel,
          target,
          context: goalExecutionContext({ loop, loopRun: run }),
        }),
      );
    }
    // The verdict is handed down so the tree is verified once per run, not once
    // per layer; `executeLoop` stamps the receipt itself.
    return executeLoop(loop, run, opts, bundled);
  }
  const workflow = await store.requireWorkflow(loop.target.workflowId);
  if (loop.target.preflight?.beforeRun) {
    const startedAt = nowIso();
    try {
      preflightWorkflow(workflow, {
        ...opts,
        machine: opts.machine ?? loop.machine,
      });
    } catch (error) {
      return preflightFailureResult(error, startedAt);
    }
  }
  if (loop.goal) {
    const loopGoal = loop.goal;
    const workflowForLoopGoal: WorkflowSpec = workflow.goal
      ? { ...workflow, goal: undefined }
      : workflow;
    return stampBundle(
      await runGoal(store, loopGoal, {
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
      }),
    );
  }
  const workflowTimeoutMs =
    typeof loop.target.timeoutMs === "number"
      ? loop.target.timeoutMs
      : undefined;
  const controller =
    workflowTimeoutMs !== undefined ? new AbortController() : undefined;
  let workflowTimedOut = false;
  const externalAbort = (): void => controller?.abort();
  if (controller && opts.signal?.aborted) controller.abort();
  if (controller)
    opts.signal?.addEventListener("abort", externalAbort, { once: true });
  const timer = controller
    ? setTimeout(() => {
        workflowTimedOut = true;
        controller.abort();
      }, workflowTimeoutMs)
    : undefined;
  timer?.unref();
  try {
    return stampBundle(
      await executeWorkflow(store, workflow, {
        ...opts,
        signal: controller?.signal ?? opts.signal,
        signalTimeoutMessage: () =>
          workflowTimedOut && loop.target.type === "workflow"
            ? `workflow timed out after ${workflowTimeoutMs}ms`
            : undefined,
        loop,
        loopRun: run,
        scheduledFor: run.scheduledFor,
        idempotencyKey: `${loop.id}:${run.scheduledFor}:attempt:${run.attempt}`,
      }),
    );
  } finally {
    if (timer) clearTimeout(timer);
    if (controller) opts.signal?.removeEventListener("abort", externalAbort);
  }
}
