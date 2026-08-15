/**
 * ECS dispatcher adapter.
 *
 * Implements the sdk `Dispatcher` interface (submit/cancel) with the launch
 * machinery the interface seam leaves to this module:
 *
 *  1. CAS-claim the next attempt's `attempt_id` + `lease_generation`
 *     (stale generation rejected),
 *  2. persist the launch intent (clientToken, startedBy, request digest)
 *     BEFORE calling ECS,
 *  3. call RunTask with a deterministic clientToken derived from
 *     (run_id, attempt_id) and an immutable request digest,
 *  4. on a lost RunTask response, reconcile the SAME token — list tasks by
 *     startedBy, describe them — before any new attempt; a new attempt is
 *     forbidden until the previous launch is proven absent or terminal.
 *
 * The AWS SDK is never called from tests: the `EcsRunTaskClient` interface is
 * the seam, `createAwsEcsClient` is the only place the real SDK is imported,
 * and every test injects a mock client.
 *
 * Nothing here names a concrete cluster, task definition, subnet, or account:
 * all infrastructure identifiers come from configuration (R4).
 */

import { createHash } from "node:crypto";
import type { DispatchResult, Dispatcher } from "../../dispatcher.js";
import type { RunExecutionStore } from "../storage.js";
import type { AttemptRecord, FrozenAdmission } from "../types.js";
import { canonicalJson } from "../types.js";
import { createRunStateMachine, type RunStateMachine } from "../state-machine.js";
import { createReceiptService, type ReceiptService } from "../receipts.js";
import { ECSClient, DescribeTasksCommand, ListTasksCommand, RunTaskCommand, StopTaskCommand } from "@aws-sdk/client-ecs";

/** ClientToken bound: ECS RunTask accepts up to 32 ASCII characters. */
export const CLIENT_TOKEN_BYTES = 16;

export interface EcsTaskState {
  taskArn: string;
  lastStatus: string;
  /** Set when the task reached a terminal status. */
  stopCode?: string | null;
  exitCode?: number | null;
}

export interface EcsRunTaskInput {
  cluster: string;
  taskDefinition: string;
  containerName: string;
  clientToken: string;
  startedBy: string;
  launchType: "FARGATE";
  cpu: string;
  memory: string;
  subnets: string[];
  securityGroups: string[];
  environment: { name: string; value: string }[];
}

export interface EcsRunTaskResult {
  taskArn: string;
}

/** The seam every test mocks; the real implementation lives in createAwsEcsClient. */
export interface EcsRunTaskClient {
  runTask(input: EcsRunTaskInput): Promise<EcsRunTaskResult>;
  /** Task arns launched with a given startedBy token. */
  listTasksByStartedBy(startedBy: string): Promise<string[]>;
  describeTasks(taskArns: string[]): Promise<EcsTaskState[]>;
  stopTask(taskArn: string): Promise<void>;
}

export interface EcsDispatcherConfig {
  cluster: string;
  taskDefinition: string;
  containerName: string;
  subnets: string[];
  securityGroups: string[];
  region: string;
}

export interface EcsDispatcherOptions {
  store: RunExecutionStore;
  stateMachine?: RunStateMachine;
  receipts?: ReceiptService;
  /** Claim identity; defaults to "dispatcher". */
  workerId?: string;
  now?: () => Date;
}

/** Terminal ECS task statuses, per the ECS task lifecycle. */
const TERMINAL_TASK_STATUSES = new Set(["STOPPED"]);

export type LaunchOutcome =
  | { kind: "launched"; attemptId: string; taskId: string }
  | { kind: "already-launched"; attemptId: string; taskId: string }
  | { kind: "previous-terminal"; attemptId: string }
  | { kind: "ambiguous"; attemptId: string }
  | { kind: "launch-failed-absent"; attemptId: string }
  | { kind: "claim-refused"; attemptId: string; reason: string }
  | { kind: "no-admission" }
  | { kind: "run-terminal"; status: string };

/**
 * Deterministic ECS clientToken derived from (run_id, attempt_id). Same input
 * always yields the same token, so a retried or reconciled launch is
 * idempotent from ECS's point of view.
 */
export function clientTokenFor(runId: string, attemptId: string): string {
  return createHash("sha256").update(`${runId}\u0000${attemptId}`).digest("hex").slice(0, CLIENT_TOKEN_BYTES * 2);
}

/** startedBy token, the durable handle reconciliation lists tasks by. */
export function startedByFor(runId: string, attemptNumber: number): string {
  return `skills-exec/${runId}/a${attemptNumber}`;
}

/** Immutable digest of the frozen request this attempt launches. */
export function requestDigestFor(admission: FrozenAdmission, attemptId: string): string {
  return createHash("sha256")
    .update(canonicalJson({ admission, attemptId }))
    .digest("hex");
}

export class EcsDispatcher implements Dispatcher {
  private readonly store: RunExecutionStore;
  private readonly stateMachine: RunStateMachine;
  private readonly receipts: ReceiptService;
  private readonly workerId: string;
  private readonly now: () => Date;

  constructor(
    private readonly config: EcsDispatcherConfig,
    private readonly client: EcsRunTaskClient,
    options: EcsDispatcherOptions,
  ) {
    this.store = options.store;
    this.stateMachine = options.stateMachine ?? createRunStateMachine(options.store);
    this.receipts = options.receipts ?? createReceiptService(options.store);
    this.workerId = options.workerId ?? "dispatcher";
    this.now = options.now ?? (() => new Date());
  }

  /** sdk Dispatcher surface: submit an ADMITTED run (execution domain) to the launch machinery. */
  async submit(run: FrozenAdmission): Promise<DispatchResult> {
    const outcome = await this.launchAttempt(run.runId);
    switch (outcome.kind) {
      case "launched":
      case "already-launched":
        return { accepted: true, target: outcome.taskId, detail: outcome.kind };
      case "previous-terminal":
        return { accepted: true, detail: `previous launch ${outcome.attemptId} already terminal` };
      case "ambiguous":
        return { accepted: false, detail: `launch response lost for ${outcome.attemptId}; reconcile before retrying` };
      case "launch-failed-absent":
        return { accepted: false, detail: `launch failed for ${outcome.attemptId}; reconciled absent, retry permitted` };
      case "claim-refused":
        return { accepted: false, detail: `claim refused for ${outcome.attemptId}: ${outcome.reason}` };
      case "no-admission":
        return { accepted: false, detail: `no admission record for run` };
      case "run-terminal":
        return { accepted: false, detail: `run already ${outcome.status}` };
    }
  }

  /** sdk Dispatcher surface: fence the current generation and stop the task. */
  async cancel(runId: string): Promise<DispatchResult> {
    const run = await this.store.getRun(runId);
    if (!run) return { accepted: false, detail: "no such run" };
    if (run.status === "cancelled") return { accepted: true, detail: "already cancelled" };
    if (run.status === "succeeded" || run.status === "failed") {
      return { accepted: false, detail: `run already ${run.status}` };
    }
    const attempts = await this.store.listAttempts(runId);
    const current = attempts[attempts.length - 1];
    if (!current) {
      const cancelled = await this.stateMachine.cancel(runId);
      return cancelled.ok ? { accepted: true, detail: "cancelled (no attempt launched)" } : { accepted: false, detail: cancelled.reason };
    }
    const taskArn = await this.resolveTaskArn(run.admission, current);
    if (taskArn) {
      try {
        await this.client.stopTask(taskArn);
      } catch {
        // Stop raced the task to a terminal state; reconciliation at read time
        // is authoritative.
      }
    }
    const cancelled = await this.stateMachine.cancel(runId);
    if (!cancelled.ok) return { accepted: false, detail: cancelled.reason };
    await this.writeCancellationReceipt(run.admission, current, taskArn);
    return { accepted: true, target: taskArn ?? undefined, detail: "cancelled and fenced" };
  }

  /**
   * Launch the next attempt of a run.
   *
   * A previous attempt whose launch outcome is unknown (launching / ambiguous /
   * launched) is reconciled FIRST. Only when the previous launch is proven
   * absent or terminal is a new attempt minted and claimed.
   */
  async launchAttempt(runId: string): Promise<LaunchOutcome> {
    const run = await this.store.getRun(runId);
    if (!run) return { kind: "no-admission" };
    if (run.status === "succeeded" || run.status === "failed" || run.status === "cancelled") {
      return { kind: "run-terminal", status: run.status };
    }

    const attempts = await this.store.listAttempts(runId);
    const previous = attempts[attempts.length - 1];
    if (previous && previous.status !== "terminal" && !isProvenAbsentOrTerminal(previous.launchState)) {
      const reconciled = await this.reconcile(run.admission, previous);
      if (reconciled.kind === "already-launched" || reconciled.kind === "previous-terminal") {
        return reconciled;
      }
      if (reconciled.kind === "ambiguous") {
        // The reconcile probe failed: the launch is still unknown, and a new
        // attempt with a different clientToken could start a second ECS task.
        return reconciled;
      }
      // Proven absent: fall through to mint a new attempt.
    }

    const attemptNumber = previous ? previous.attemptNumber + 1 : 1;
    const attempt = await this.store.createAttempt({ runId, attemptNumber });
    const claimed = await this.stateMachine.claim({
      runId,
      attemptId: attempt.attemptId,
      workerId: this.workerId,
      expectedLeaseGeneration: 0,
    });
    if (!claimed.ok) {
      return { kind: "claim-refused", attemptId: attempt.attemptId, reason: claimed.reason };
    }

    const clientToken = clientTokenFor(runId, attempt.attemptId);
    const startedBy = startedByFor(runId, attemptNumber);
    const requestDigest = requestDigestFor(run.admission, attempt.attemptId);

    const intent = await this.store.recordLaunchIntent({
      runId,
      attemptId: attempt.attemptId,
      clientToken,
      requestDigest,
      startedBy,
    });
    if (!intent.ok) return { kind: "claim-refused", attemptId: attempt.attemptId, reason: intent.reason };

    await this.receipts.recordLaunch({
      admission: run.admission,
      attempt: intent.attempt,
      taskId: null,
      launchedAt: this.now().toISOString(),
    });

    let result: EcsRunTaskResult;
    try {
      result = await this.client.runTask(this.runTaskInput(run.admission, intent.attempt, clientToken, startedBy, requestDigest));
    } catch {
      await this.store.recordLaunchState({ runId, attemptId: attempt.attemptId, launchState: "ambiguous" });
      const reconciled = await this.reconcile(run.admission, intent.attempt);
      if (reconciled.kind === "already-launched") return reconciled;
      return reconciled.kind === "previous-terminal"
        ? reconciled
        : { kind: "launch-failed-absent", attemptId: attempt.attemptId };
    }

    await this.store.recordLaunchState({ runId, attemptId: attempt.attemptId, launchState: "launched", taskId: result.taskArn });
    return { kind: "launched", attemptId: attempt.attemptId, taskId: result.taskArn };
  }

  /** Reconcile an attempt whose launch outcome is unknown. */
  async reconcile(admission: FrozenAdmission, attempt: AttemptRecord): Promise<LaunchOutcome> {
    // A known taskId is described directly: ECS ListTasks omits STOPPED tasks,
    // so the list-by-token probe alone cannot tell "absent" from "terminal".
    if (attempt.taskId) {
      let states: EcsTaskState[];
      try {
        states = await this.client.describeTasks([attempt.taskId]);
      } catch {
        return { kind: "ambiguous", attemptId: attempt.attemptId };
      }
      const live = states.filter((state) => !TERMINAL_TASK_STATUSES.has(state.lastStatus));
      if (live.length > 0) {
        return { kind: "already-launched", attemptId: attempt.attemptId, taskId: attempt.taskId };
      }
      await this.store.recordLaunchState({ runId: admission.runId, attemptId: attempt.attemptId, launchState: "terminal" });
      return { kind: "previous-terminal", attemptId: attempt.attemptId };
    }
    const token = attempt.startedBy;
    if (!token) {
      await this.store.recordLaunchState({ runId: admission.runId, attemptId: attempt.attemptId, launchState: "absent" });
      return { kind: "launch-failed-absent", attemptId: attempt.attemptId };
    }
    let taskArns: string[];
    try {
      taskArns = await this.client.listTasksByStartedBy(token);
    } catch {
      // The reconcile probe itself failed: the launch is still unknown, and a
      // new attempt stays forbidden.
      return { kind: "ambiguous", attemptId: attempt.attemptId };
    }
    if (taskArns.length === 0) {
      await this.store.recordLaunchState({ runId: admission.runId, attemptId: attempt.attemptId, launchState: "absent" });
      return { kind: "launch-failed-absent", attemptId: attempt.attemptId };
    }
    let states: EcsTaskState[];
    try {
      states = await this.client.describeTasks(taskArns);
    } catch {
      return { kind: "ambiguous", attemptId: attempt.attemptId };
    }
    const live = states.filter((state) => !TERMINAL_TASK_STATUSES.has(state.lastStatus));
    if (live.length > 0) {
      const taskId = live[0]!.taskArn;
      await this.store.recordLaunchState({ runId: admission.runId, attemptId: attempt.attemptId, launchState: "launched", taskId });
      return { kind: "already-launched", attemptId: attempt.attemptId, taskId };
    }
    await this.store.recordLaunchState({ runId: admission.runId, attemptId: attempt.attemptId, launchState: "terminal", taskId: taskArns[0] });
    return { kind: "previous-terminal", attemptId: attempt.attemptId };
  }

  /** Resolve the task arn for the current attempt, reconciling if needed. */
  private async resolveTaskArn(admission: FrozenAdmission, attempt: AttemptRecord): Promise<string | null> {
    if (attempt.taskId) return attempt.taskId;
    if (attempt.launchState === "launching" || attempt.launchState === "ambiguous") {
      const outcome = await this.reconcile(admission, attempt);
      if (outcome.kind === "already-launched") return outcome.taskId;
    }
    return null;
  }

  private runTaskInput(
    admission: FrozenAdmission,
    attempt: AttemptRecord,
    clientToken: string,
    startedBy: string,
    requestDigest: string,
  ): EcsRunTaskInput {
    const limits = admission.limits;
    const cpuUnits = Math.max(256, Math.round(limits.maxCpuUnits / 256) * 256);
    return {
      cluster: this.config.cluster,
      taskDefinition: this.config.taskDefinition,
      containerName: this.config.containerName,
      clientToken,
      startedBy,
      launchType: "FARGATE",
      cpu: String(cpuUnits),
      memory: String(Math.max(512, limits.maxMemoryMb)),
      subnets: this.config.subnets,
      securityGroups: this.config.securityGroups,
      environment: [
        { name: "SKILLS_RUN_ID", value: admission.runId },
        { name: "SKILLS_ATTEMPT_ID", value: attempt.attemptId },
        { name: "SKILLS_BUNDLE_DIGEST", value: admission.bundleDigest },
        { name: "SKILLS_INPUT_DIGEST", value: admission.inputDigest },
        { name: "SKILLS_REQUEST_DIGEST", value: requestDigest },
        { name: "SKILLS_RUNTIME_IMAGE_DIGEST", value: admission.runtimeImageDigest },
      ],
    };
  }

  private async writeCancellationReceipt(admission: FrozenAdmission, attempt: AttemptRecord, taskArn: string | null): Promise<void> {
    const launch = await this.receipts.get(admission.runId, attempt.attemptId);
    if (!launch) {
      await this.receipts.recordLaunch({
        admission,
        attempt: { ...attempt, clientToken: attempt.clientToken ?? clientTokenFor(admission.runId, attempt.attemptId), requestDigest: attempt.requestDigest ?? "", startedBy: attempt.startedBy ?? "" },
        taskId: taskArn,
        launchedAt: this.now().toISOString(),
      });
    }
    await this.receipts.finalize({
      runId: admission.runId,
      attemptId: attempt.attemptId,
      status: "cancelled",
      exitCode: null,
      completedAt: this.now().toISOString(),
    });
  }
}

function isProvenAbsentOrTerminal(launchState: AttemptRecord["launchState"]): boolean {
  return launchState === "absent" || launchState === "terminal";
}

/**
 * The one place the real AWS SDK is wired in. Returns a client bound to the
 * configured region; credentials resolve through the standard SDK chain.
 * Tests never construct this — they inject a mock `EcsRunTaskClient`.
 */
export function createAwsEcsClient(region: string): EcsRunTaskClient {
  const client = new ECSClient({ region });

  return {
    async runTask(input) {
      const response = await client.send(
        new RunTaskCommand({
          cluster: input.cluster,
          taskDefinition: input.taskDefinition,
          launchType: input.launchType,
          clientToken: input.clientToken,
          startedBy: input.startedBy,
          networkConfiguration: {
            awsvpcConfiguration: {
              subnets: input.subnets,
              securityGroups: input.securityGroups,
              assignPublicIp: "DISABLED",
            },
          },
          overrides: {
            containerOverrides: [
              {
                name: input.containerName,
                environment: input.environment,
                cpu: Number(input.cpu),
                memory: Number(input.memory),
              },
            ],
          },
        }),
      );
      const taskArn = response.tasks?.[0]?.taskArn ?? null;
      if (!taskArn) {
        const failure = response.failures?.[0];
        throw new Error(`RunTask refused: ${failure?.reason ?? "no task and no failure detail"}`);
      }
      return { taskArn };
    },

    async listTasksByStartedBy(startedBy) {
      const response = await client.send(new ListTasksCommand({ startedBy }));
      return response.taskArns ?? [];
    },

    async describeTasks(taskArns) {
      const response = await client.send(new DescribeTasksCommand({ tasks: taskArns }));
      return (response.tasks ?? []).map((task) => ({
        taskArn: task.taskArn ?? "",
        lastStatus: task.lastStatus ?? "UNKNOWN",
        stopCode: task.stopCode ?? null,
        exitCode: task.containers?.[0]?.exitCode ?? null,
      }));
    },

    async stopTask(taskArn) {
      await client.send(new StopTaskCommand({ task: taskArn }));
    },
  };
}
