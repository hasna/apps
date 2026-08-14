import { describe, expect, test } from "bun:test";

import { useDefaultTestTimeout } from "../../../test-preload.js";
useDefaultTestTimeout();

import { createSubmitRunService } from "../admission.js";
import { createImageProfileRegistry } from "../image-profile.js";
import { MemoryRunExecutionStore } from "../storage.js";
import { EcsDispatcher, clientTokenFor, startedByFor, type EcsRunTaskClient, type EcsRunTaskInput, type EcsTaskState } from "./ecs.js";

const PROFILES = createImageProfileRegistry({
  runtimes: [{ runtime: "bun", version: "1.3.14", imageDigest: "sha256:" + "a".repeat(64) }],
  dependencyLayers: {},
});

const CONFIG = {
  cluster: "ecs-test-cluster",
  taskDefinition: "ecs-test-taskdef",
  containerName: "skills-executor",
  subnets: ["subnet-mock-1"],
  securityGroups: ["sg-mock-1"],
  region: "us-east-1",
};

class MockEcsClient implements EcsRunTaskClient {
  runTaskCalls: EcsRunTaskInput[] = [];
  stopTaskCalls: string[] = [];
  launchedTasks = new Map<string, EcsTaskState>();

  constructor(
    private readonly runTaskImpl: (input: EcsRunTaskInput) => Promise<{ taskArn: string }> = async (input) => {
      const taskArn = `arn:aws:ecs:${CONFIG.region}:mock-account:task/${input.startedBy}`;
      this.launchedTasks.set(taskArn, { taskArn, lastStatus: "RUNNING" });
      return { taskArn };
    },
  ) {}

  async runTask(input: EcsRunTaskInput): Promise<{ taskArn: string }> {
    this.runTaskCalls.push(input);
    return this.runTaskImpl(input);
  }

  async listTasksByStartedBy(startedBy: string): Promise<string[]> {
    return Array.from(this.launchedTasks.keys()).filter((arn) => arn.includes(startedBy));
  }

  async describeTasks(taskArns: string[]): Promise<EcsTaskState[]> {
    return taskArns.map((arn) => this.launchedTasks.get(arn) ?? { taskArn: arn, lastStatus: "UNKNOWN" });
  }

  async stopTask(taskArn: string): Promise<void> {
    this.stopTaskCalls.push(taskArn);
    const state = this.launchedTasks.get(taskArn);
    if (state) this.launchedTasks.set(taskArn, { ...state, lastStatus: "STOPPED", stopCode: "UserInitiated" });
  }
}

async function admittedRunId(store: MemoryRunExecutionStore, key: string): Promise<string> {
  const service = createSubmitRunService({ store, imageProfiles: PROFILES });
  const { run } = await service.submit({
    tenantId: "tenant-ecs-test",
    skillId: "pdf-generate",
    skillVersion: "1.0.0",
    bundleDigest: "sha256:" + "d".repeat(64),
    input: {},
    idempotencyKey: key,
    runtime: "bun",
  });
  return run.runId;
}

function makeDispatcher(store: MemoryRunExecutionStore, client: EcsRunTaskClient): EcsDispatcher {
  return new EcsDispatcher(CONFIG, client, { store, workerId: "dispatcher-test" });
}

describe("ecs dispatcher", () => {
  test("launch: CAS-claimed attempt, intent persisted before RunTask, deterministic clientToken, receipt written", async () => {
    const store = new MemoryRunExecutionStore();
    const client = new MockEcsClient();
    const dispatcher = makeDispatcher(store, client);
    const runId = await admittedRunId(store, "ecs-launch");

    const outcome = await dispatcher.launchAttempt(runId);
    expect(outcome.kind).toBe("launched");
    if (outcome.kind !== "launched") return;

    // Deterministic token derived from (run_id, attempt_id).
    const attempts = await store.listAttempts(runId);
    expect(attempts).toHaveLength(1);
    const attempt = attempts[0]!;
    expect(client.runTaskCalls).toHaveLength(1);
    expect(client.runTaskCalls[0]!.clientToken).toBe(clientTokenFor(runId, attempt.attemptId));
    expect(client.runTaskCalls[0]!.clientToken).toHaveLength(32);
    expect(client.runTaskCalls[0]!.startedBy).toBe(startedByFor(runId, 1));
    // The request digest is carried in the launch.
    const digestEnv = client.runTaskCalls[0]!.environment.find((entry) => entry.name === "SKILLS_REQUEST_DIGEST");
    expect(digestEnv?.value).toHaveLength(64);
    // Limits map to cpu/memory.
    expect(client.runTaskCalls[0]!.cpu).toBe("256");
    expect(client.runTaskCalls[0]!.memory).toBe("512");

    // Attempt was claimed (CAS) with generation 1 and launched.
    expect(attempt.leaseGeneration).toBe(1);
    expect(attempt.workerId).toBe("dispatcher-test");
    expect(attempt.launchState).toBe("launched");
    expect(attempt.taskId).toBe(outcome.taskId);

    // A launch receipt exists with the frozen digests.
    const receipt = await store.getReceipt(runId, attempt.attemptId);
    expect(receipt).not.toBeNull();
    expect(receipt?.bundleDigest).toBe("sha256:" + "d".repeat(64));
    expect(receipt?.runtimeImageDigest).toBe("sha256:" + "a".repeat(64));
    expect(receipt?.policy.egress).toBe("deny");
    expect(receipt?.clientToken).toBe(clientTokenFor(runId, attempt.attemptId));
  });

  test("lost RunTask response reconciles the SAME token and never double-launches", async () => {
    const store = new MemoryRunExecutionStore();
    // The response is lost, but the task DID launch server-side.
    const client = new MockEcsClient(async (input) => {
      const taskArn = `arn:aws:ecs:${CONFIG.region}:mock-account:task/${input.startedBy}`;
      client.launchedTasks.set(taskArn, { taskArn, lastStatus: "RUNNING" });
      throw new Error("socket hang up");
    });
    const dispatcher = makeDispatcher(store, client);
    const runId = await admittedRunId(store, "ecs-lost");

    const outcome = await dispatcher.launchAttempt(runId);
    // The lost response is reconciled inside launchAttempt: the same token is
    // listed, the live task is found, and the run is NOT re-launched.
    expect(outcome.kind).toBe("already-launched");
    if (outcome.kind !== "already-launched") return;

    expect(client.runTaskCalls).toHaveLength(1);
    expect(client.runTaskCalls[0]!.clientToken).toBe(clientTokenFor(runId, `${runId}/attempt/1`));

    const attempts = await store.listAttempts(runId);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]!.launchState).toBe("launched");
    expect(attempts[0]!.taskId).toBe(outcome.taskId);

    // A second launchAttempt call also reconciles: still one runTask call, one attempt.
    const again = await dispatcher.launchAttempt(runId);
    expect(again.kind).toBe("already-launched");
    expect(client.runTaskCalls).toHaveLength(1);
    expect((await store.listAttempts(runId)).length).toBe(1);
  });

  test("lost response + reconciled ABSENT permits a new attempt with a new token", async () => {
    const store = new MemoryRunExecutionStore();
    const client = new MockEcsClient(async () => {
      throw new Error("socket hang up");
    });
    const dispatcher = makeDispatcher(store, client);
    const runId = await admittedRunId(store, "ecs-lost-absent");

    const first = await dispatcher.launchAttempt(runId);
    // The task never existed: reconcile proves absent.
    expect(first.kind).toBe("launch-failed-absent");
    if (first.kind !== "launch-failed-absent") return;

    const attemptsAfterFirst = await store.listAttempts(runId);
    expect(attemptsAfterFirst[0]!.launchState).toBe("absent");

    // Previous launch proven absent → a new attempt is legal.
    const second = await dispatcher.launchAttempt(runId);
    expect(second.kind).toBe("launch-failed-absent");

    const attempts = await store.listAttempts(runId);
    expect(attempts).toHaveLength(2);
    expect(attempts[0]!.attemptNumber).toBe(1);
    expect(attempts[1]!.attemptNumber).toBe(2);
    // The second attempt carries a DIFFERENT deterministic token.
    expect(client.runTaskCalls[0]!.clientToken).toBe(clientTokenFor(runId, attempts[0]!.attemptId));
    expect(client.runTaskCalls[1]!.clientToken).toBe(clientTokenFor(runId, attempts[1]!.attemptId));
    expect(client.runTaskCalls[0]!.clientToken).not.toBe(client.runTaskCalls[1]!.clientToken);
  });

  test("a previous launch proven TERMINAL blocks a new attempt", async () => {
    const store = new MemoryRunExecutionStore();
    const client = new MockEcsClient(async (input) => {
      const taskArn = `arn:aws:ecs:${CONFIG.region}:mock-account:task/${input.startedBy}`;
      client.launchedTasks.set(taskArn, { taskArn, lastStatus: "STOPPED", stopCode: "EssentialContainerExited", exitCode: 0 });
      return { taskArn };
    });
    const dispatcher = makeDispatcher(store, client);
    const runId = await admittedRunId(store, "ecs-prev-terminal");

    const first = await dispatcher.launchAttempt(runId);
    expect(first.kind).toBe("launched");

    const again = await dispatcher.launchAttempt(runId);
    expect(again.kind).toBe("previous-terminal");
    expect(client.runTaskCalls).toHaveLength(1);
    expect((await store.listAttempts(runId)).length).toBe(1);
  });

  test("cancel stops the task, fences the run, and writes a cancellation receipt", async () => {
    const store = new MemoryRunExecutionStore();
    const client = new MockEcsClient();
    const dispatcher = makeDispatcher(store, client);
    const runId = await admittedRunId(store, "ecs-cancel");

    const launched = await dispatcher.launchAttempt(runId);
    expect(launched.kind).toBe("launched");

    const result = await dispatcher.cancel(runId);
    expect(result.accepted).toBe(true);
    expect(client.stopTaskCalls).toHaveLength(1);
    expect(client.stopTaskCalls[0]).toBe(launched.kind === "launched" ? launched.taskId : "");

    const run = await store.getRun(runId);
    expect(run?.status).toBe("cancelled");

    const attempts = await store.listAttempts(runId);
    const receipt = await store.getReceipt(runId, attempts[0]!.attemptId);
    expect(receipt?.status).toBe("cancelled");

    // A cancelled run refuses new launches.
    const relaunch = await dispatcher.launchAttempt(runId);
    expect(relaunch.kind).toBe("run-terminal");
  });

  test("sdk Dispatcher surface: submit maps to launch, cancel maps to fence", async () => {
    const store = new MemoryRunExecutionStore();
    const client = new MockEcsClient();
    const dispatcher = makeDispatcher(store, client);
    const runId = await admittedRunId(store, "ecs-submit");

    const submitted = await dispatcher.submit({ id: runId } as never);
    expect(submitted.accepted).toBe(true);
    expect(submitted.target).toBeTruthy();

    const cancelled = await dispatcher.cancel(runId);
    expect(cancelled.accepted).toBe(true);
  });

  test("no admission record fails closed", async () => {
    const store = new MemoryRunExecutionStore();
    const dispatcher = makeDispatcher(store, new MockEcsClient());
    const outcome = await dispatcher.launchAttempt("run_does_not_exist");
    expect(outcome.kind).toBe("no-admission");
  });
});
