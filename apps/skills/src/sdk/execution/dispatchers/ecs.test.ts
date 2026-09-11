import { describe, expect, test } from "bun:test";

import { useDefaultTestTimeout } from "../../../test-preload.js";
useDefaultTestTimeout();

import { createSubmitRunService } from "../admission.js";
import { createImageProfileRegistry } from "../image-profile.js";
import { MemoryRunExecutionStore } from "../storage.js";
import { createReceiptService } from "../receipts.js";
import type { FrozenAdmission } from "../types.js";
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

async function admittedRun(store: MemoryRunExecutionStore, key: string): Promise<FrozenAdmission> {
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
  return run;
}

async function admittedRunId(store: MemoryRunExecutionStore, key: string): Promise<string> {
  return (await admittedRun(store, key)).runId;
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

  test("lost RunTask response + failing reconcile probe returns ambiguous and never mints a new attempt", async () => {
    const store = new MemoryRunExecutionStore();
    // The task DID launch server-side, but the RunTask response is lost AND
    // the reconcile probe fails: the previous launch stays unknown. A second
    // attempt with a different clientToken would risk a second ECS task.
    const client = new MockEcsClient(async (input) => {
      const taskArn = `arn:aws:ecs:${CONFIG.region}:mock-account:task/${input.startedBy}`;
      client.launchedTasks.set(taskArn, { taskArn, lastStatus: "RUNNING" });
      throw new Error("socket hang up");
    });
    client.listTasksByStartedBy = async () => {
      throw new Error("reconcile probe failed");
    };
    const dispatcher = makeDispatcher(store, client);
    const runId = await admittedRunId(store, "ecs-lost-ambiguous");

    // First call: response lost; the in-call reconcile probe also fails.
    expect((await dispatcher.launchAttempt(runId)).kind).toBe("ambiguous");
    // Second call: the previous attempt is ambiguous; the probe fails again.
    // The ambiguous result must be returned as-is — no fall-through mint.
    const second = await dispatcher.launchAttempt(runId);
    expect(second.kind).toBe("ambiguous");

    expect(client.runTaskCalls).toHaveLength(1);
    const attempts = await store.listAttempts(runId);
    expect(attempts).toHaveLength(1);
    // The unknown launch stays recorded as ambiguous, never silently absent.
    expect(attempts[0]!.launchState).toBe("ambiguous");
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
    expect((await dispatcher.launchAttempt(runId)).kind).toBe("previous-terminal");
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
    const run = await admittedRun(store, "ecs-submit");
    const submitted = await dispatcher.submit(run);
    expect(submitted.accepted).toBe(true);
    expect(submitted.target).toBeTruthy();

    const cancelled = await dispatcher.cancel(run.runId);
    expect(cancelled.accepted).toBe(true);
  });

  test("no admission record fails closed", async () => {
    const store = new MemoryRunExecutionStore();
    const dispatcher = makeDispatcher(store, new MockEcsClient());
    const outcome = await dispatcher.launchAttempt("run_does_not_exist");
    expect(outcome.kind).toBe("no-admission");
  });
});


describe("ECS terminal authority", () => {
  for (const probe of ["empty", "wrong-arn", "unknown", "mixed", "throws"] as const) {
    test(`known task ${probe} description cannot prove terminal or permit another launch`, async () => {
      const store = new MemoryRunExecutionStore(), client = new MockEcsClient(), dispatcher = makeDispatcher(store, client);
      const runId = await admittedRunId(store, `terminal-${probe}`);
      const launched = await dispatcher.launchAttempt(runId); expect(launched.kind).toBe("launched");
      if (launched.kind !== "launched") return;
      client.describeTasks = async () => {
        if (probe === "throws") throw Error("owned describe failure");
        if (probe === "empty") return [];
        if (probe === "wrong-arn") return [{ taskArn: "unrelated-task", lastStatus: "STOPPED" }];
        if (probe === "mixed") return [{ taskArn: launched.taskId, lastStatus: "STOPPED" }, { taskArn: "unrelated-task", lastStatus: "STOPPED" }];
        return [{ taskArn: launched.taskId, lastStatus: "UNKNOWN" }];
      };
      expect((await dispatcher.launchAttempt(runId)).kind).toBe("ambiguous");
      expect((await dispatcher.launchAttempt(runId)).kind).toBe("ambiguous");
      expect(client.runTaskCalls).toHaveLength(1); expect(await store.listAttempts(runId)).toHaveLength(1);
      expect((await store.listAttempts(runId))[0]!.launchState).toBe("launched");
    });
  }
  for (const stop of ["throws", "acknowledged-running", "missing-description"] as const) {
    test(`cancel with ${stop} cannot finalize a receipt before STOPPED proof`, async () => {
      const store = new MemoryRunExecutionStore(), client = new MockEcsClient(), dispatcher = makeDispatcher(store, client);
      const runId = await admittedRunId(store, `cancel-${stop}`); await dispatcher.launchAttempt(runId);
      client.stopTask = async taskArn => { client.stopTaskCalls.push(taskArn); if (stop === "throws") throw Error("owned stop failure"); };
      if (stop === "missing-description") client.describeTasks = async () => [];
      expect((await dispatcher.cancel(runId)).accepted).toBe(false);
      expect((await store.getRun(runId))?.status).not.toBe("cancelled");
      const attempt = (await store.listAttempts(runId))[0]!;
      expect((await store.getReceipt(runId, attempt.attemptId))?.status).not.toBe("cancelled");
      expect((await dispatcher.launchAttempt(runId)).kind).not.toBe("launched");
      expect(client.runTaskCalls).toHaveLength(1);
    });
  }
  test("lost launch plus empty listing remains ambiguous and cancellation cannot settle it", async () => {
    const store = new MemoryRunExecutionStore();
    const client = new MockEcsClient(async () => { throw Error("owned lost launch"); });
    const dispatcher = makeDispatcher(store, client), runId = await admittedRunId(store, "lost-empty-unknown");
    expect((await dispatcher.launchAttempt(runId)).kind).toBe("ambiguous");
    expect((await dispatcher.launchAttempt(runId)).kind).toBe("ambiguous");
    expect((await dispatcher.cancel(runId)).accepted).toBe(false);
    expect(client.runTaskCalls).toHaveLength(1); expect(await store.listAttempts(runId)).toHaveLength(1);
  });
});


test("a lost stop response is accepted only when the exact task subsequently proves STOPPED", async () => {
  const store = new MemoryRunExecutionStore(), client = new MockEcsClient(), dispatcher = makeDispatcher(store, client);
  const runId = await admittedRunId(store, "lost-stop-confirmed"); await dispatcher.launchAttempt(runId);
  client.stopTask = async taskArn => {
    client.stopTaskCalls.push(taskArn); client.launchedTasks.set(taskArn, { taskArn, lastStatus: "STOPPED" });
    throw Error("owned lost stop response");
  };
  expect((await dispatcher.cancel(runId)).accepted).toBe(true);
  expect((await store.getRun(runId))?.status).toBe("cancelled");
  const attempt = (await store.listAttempts(runId))[0]!;
  expect((await store.getReceipt(runId, attempt.attemptId))?.status).toBe("cancelled");
});

test("pending cancellation can be reconciled after the task later stops without launching again", async () => {
  const store = new MemoryRunExecutionStore(), client = new MockEcsClient(), dispatcher = makeDispatcher(store, client);
  const runId = await admittedRunId(store, "stop-later"); const launched = await dispatcher.launchAttempt(runId);
  if (launched.kind !== "launched") throw Error("expected owned launch");
  client.stopTask = async taskArn => { client.stopTaskCalls.push(taskArn); };
  expect((await dispatcher.cancel(runId)).accepted).toBe(false);
  client.launchedTasks.set(launched.taskId, { taskArn: launched.taskId, lastStatus: "STOPPED" });
  expect((await dispatcher.cancel(runId)).accepted).toBe(true);
  expect(client.runTaskCalls).toHaveLength(1); expect(client.stopTaskCalls).toHaveLength(1);
});


for (const matches of [["owned-task", "unexpected-task"], ["owned-task", "owned-task"]]) {
  test("ambiguous task listings cannot select a convenient terminal match", async () => {
    const store = new MemoryRunExecutionStore(), client = new MockEcsClient(async () => { throw Error("owned lost launch"); });
    client.listTasksByStartedBy = async () => matches;
    client.describeTasks = async arns => arns.map(taskArn => ({ taskArn, lastStatus: "STOPPED" }));
    const dispatcher = makeDispatcher(store, client), runId = await admittedRunId(store, "multiple-list-" + matches.join("-"));
    expect((await dispatcher.launchAttempt(runId)).kind).toBe("ambiguous");
    expect((await dispatcher.cancel(runId)).accepted).toBe(false);
    expect((await dispatcher.launchAttempt(runId)).kind).toBe("ambiguous");
    expect(client.runTaskCalls).toHaveLength(1);
  });
}

test("eventually visible lost launch reconciles the original attempt without a replacement", async () => {
  const store = new MemoryRunExecutionStore(), client = new MockEcsClient(async () => { throw Error("owned lost launch"); });
  const dispatcher = makeDispatcher(store, client), runId = await admittedRunId(store, "eventual-visibility");
  expect((await dispatcher.launchAttempt(runId)).kind).toBe("ambiguous");
  const original = (await store.listAttempts(runId))[0]!;
  const taskArn = `owned-task/${original.startedBy}`;
  client.launchedTasks.set(taskArn, { taskArn, lastStatus: "RUNNING" });
  expect(await dispatcher.launchAttempt(runId)).toMatchObject({ kind: "already-launched", attemptId: original.attemptId, taskId: taskArn });
  expect(client.runTaskCalls).toHaveLength(1); expect(await store.listAttempts(runId)).toHaveLength(1);
});


test("a historical terminal marker cannot replace a missing physical task observation", async () => {
  const store = new MemoryRunExecutionStore(), client = new MockEcsClient(), dispatcher = makeDispatcher(store, client);
  const runId = await admittedRunId(store, "historic-terminal"); await dispatcher.launchAttempt(runId);
  const attempt = (await store.listAttempts(runId))[0]!;
  await store.recordLaunchState({ runId, attemptId: attempt.attemptId, launchState: "terminal" });
  client.describeTasks = async () => [];
  expect((await dispatcher.launchAttempt(runId)).kind).toBe("ambiguous");
  expect((await dispatcher.cancel(runId)).accepted).toBe(false);
  expect(client.runTaskCalls).toHaveLength(1);
});

test("historical cancelled state still requires physical stop proof before idempotent acceptance", async () => {
  const store = new MemoryRunExecutionStore(), client = new MockEcsClient(), dispatcher = makeDispatcher(store, client);
  const runId = await admittedRunId(store, "historical-cancelled"); const launched = await dispatcher.launchAttempt(runId);
  if (launched.kind !== "launched") throw Error("expected owned task");
  await store.setRunStatus(runId, "cancelled");
  client.stopTask = async () => { throw Error("owned stop failure"); };
  const attempt = (await store.listAttempts(runId))[0]!, before = await store.getReceipt(runId, attempt.attemptId);
  expect((await dispatcher.cancel(runId)).accepted).toBe(false);
  expect(await store.getReceipt(runId, attempt.attemptId)).toEqual(before);
  client.launchedTasks.set(launched.taskId, { taskArn: launched.taskId, lastStatus: "STOPPED" });
  expect((await dispatcher.cancel(runId)).accepted).toBe(true);
  const terminal = await store.getReceipt(runId, attempt.attemptId);
  expect(terminal?.status).toBe("cancelled");
  expect((await dispatcher.cancel(runId)).accepted).toBe(true);
  expect(await store.getReceipt(runId, attempt.attemptId)).toEqual(terminal);
  expect(client.runTaskCalls).toHaveLength(1);
});


test("failed cancellation receipt persistence repairs on retry and preserves terminal fields thereafter", async () => {
  const store = new MemoryRunExecutionStore(), client = new MockEcsClient(), receipts = createReceiptService(store);
  let failures = 1, finalizes = 0;
  const dispatcher = new EcsDispatcher(CONFIG, client, { store, receipts: { ...receipts, async finalize(input) {
    finalizes++; if (failures-- > 0) throw Error("owned receipt write failure"); return receipts.finalize(input);
  } } });
  const runId = await admittedRunId(store, "receipt-retry"); await dispatcher.launchAttempt(runId);
  const attempt = (await store.listAttempts(runId))[0]!;
  expect((await dispatcher.cancel(runId)).accepted).toBe(false);
  expect((await store.getRun(runId))?.status).toBe("cancelled");
  expect((await store.getReceipt(runId, attempt.attemptId))?.status).toBe(null);
  expect((await dispatcher.cancel(runId)).accepted).toBe(true);
  const terminal = await store.getReceipt(runId, attempt.attemptId);
  expect(terminal?.status).toBe("cancelled"); expect(terminal?.completedAt).toBeTruthy();
  expect((await store.getRun(runId))?.terminalReceiptId).toBe(attempt.attemptId);
  expect((await dispatcher.cancel(runId)).accepted).toBe(true);
  expect(await store.getReceipt(runId, attempt.attemptId)).toEqual(terminal); expect(finalizes).toBe(2);
});

for (const outcome of ["succeeded", "failed"] as const) {
  test(`contradictory ${outcome} receipt is preserved and cancellation is refused`, async () => {
    const store = new MemoryRunExecutionStore(), client = new MockEcsClient(), dispatcher = makeDispatcher(store, client);
    const runId = await admittedRunId(store, `contradictory-${outcome}`); await dispatcher.launchAttempt(runId);
    const attempt = (await store.listAttempts(runId))[0]!, receipt = (await store.getReceipt(runId, attempt.attemptId))!;
    const terminal = { ...receipt, status: outcome, completedAt: "2026-09-08T12:00:00.000Z", exitCode: 0 };
    await store.writeReceipt(terminal);
    expect((await dispatcher.cancel(runId)).accepted).toBe(false);
    expect(await store.getReceipt(runId, attempt.attemptId)).toEqual(terminal);
    expect(client.stopTaskCalls).toHaveLength(0);
  });
}


test("a persisted cancellation receipt repairs its missing run pointer without changing completedAt", async () => {
  const store = new MemoryRunExecutionStore(), client = new MockEcsClient(), dispatcher = makeDispatcher(store, client);
  const runId = await admittedRunId(store, "receipt-pointer-retry"); await dispatcher.launchAttempt(runId);
  const attempt = (await store.listAttempts(runId))[0]!, finalizeRun = store.finalizeRun.bind(store);
  let failures = 1;
  store.finalizeRun = async (...args) => { if (failures-- > 0) throw Error("owned run pointer loss"); return finalizeRun(...args); };
  expect((await dispatcher.cancel(runId)).accepted).toBe(false);
  const persisted = await store.getReceipt(runId, attempt.attemptId);
  expect(persisted?.status).toBe("cancelled"); expect(persisted?.completedAt).toBeTruthy();
  expect((await store.getRun(runId))?.terminalReceiptId).toBeNull();
  expect((await dispatcher.cancel(runId)).accepted).toBe(true);
  expect(await store.getReceipt(runId, attempt.attemptId)).toEqual(persisted);
  expect((await store.getRun(runId))?.terminalReceiptId).toBe(attempt.attemptId);
});

test("a missing launch receipt cannot be invented during cancellation", async () => {
  const store = new MemoryRunExecutionStore(), client = new MockEcsClient(), receipts = createReceiptService(store);
  const dispatcher = new EcsDispatcher(CONFIG, client, { store, receipts: { ...receipts, get: async () => null } });
  const runId = await admittedRunId(store, "missing-launch-receipt"); await dispatcher.launchAttempt(runId);
  const attempt = (await store.listAttempts(runId))[0]!, before = await store.getReceipt(runId, attempt.attemptId);
  expect((await dispatcher.cancel(runId)).accepted).toBe(false);
  expect(await store.getReceipt(runId, attempt.attemptId)).toEqual(before);
  expect(client.stopTaskCalls).toHaveLength(0);
});
