import { describe, expect, test } from "bun:test";

import { useDefaultTestTimeout } from "../../test-preload.js";
useDefaultTestTimeout();

import { createSubmitRunService } from "./admission.js";
import { clientTokenFor } from "./dispatchers/ecs.js";
import { createImageProfileRegistry } from "./image-profile.js";
import { createReceiptService } from "./receipts.js";
import { MemoryRunExecutionStore } from "./storage.js";
import type { AttemptRecord, FrozenAdmission } from "./types.js";

const PROFILES = createImageProfileRegistry({
  runtimes: [{ runtime: "bun", version: "1.3.14", imageDigest: "sha256:" + "a".repeat(64) }],
  dependencyLayers: {},
});

async function admittedWithAttempt(store: MemoryRunExecutionStore, key: string): Promise<{ admission: FrozenAdmission; attempt: AttemptRecord }> {
  const service = createSubmitRunService({ store, imageProfiles: PROFILES });
  const { run } = await service.submit({
    tenantId: "tenant-receipt-test",
    skillId: "pdf-generate",
    skillVersion: "1.0.0",
    bundleDigest: "sha256:" + "d".repeat(64),
    input: {},
    idempotencyKey: key,
    runtime: "bun",
  });
  const attempt = await store.createAttempt({ runId: run.runId, attemptNumber: 1 });
  return { admission: run, attempt };
}

describe("per-attempt receipts", () => {
  test("launch receipt freezes digests, policy, and token; the launch fields never change on finalize", async () => {
    const store = new MemoryRunExecutionStore();
    const receipts = createReceiptService(store);
    const { admission, attempt } = await admittedWithAttempt(store, "receipt-freeze");

    const launch = await receipts.recordLaunch({
      admission,
      attempt: { ...attempt, clientToken: clientTokenFor(admission.runId, attempt.attemptId), requestDigest: "reqdigest".padEnd(64, "0"), startedBy: "skills-exec/test/a1" },
      taskId: null,
      launchedAt: "2026-08-14T00:00:00.000Z",
    });
    expect(launch.bundleDigest).toBe(admission.bundleDigest);
    expect(launch.runtimeImageDigest).toBe(admission.runtimeImageDigest);
    expect(launch.policy.egress).toBe("deny");
    expect(launch.exitCode).toBeNull();
    expect(launch.status).toBeNull();

    const finalized = await receipts.finalize({
      runId: admission.runId,
      attemptId: attempt.attemptId,
      status: "succeeded",
      exitCode: 0,
      completedAt: "2026-08-14T00:01:00.000Z",
      artifactPointers: ["artifacts/run_1/out.json"],
      logPointers: ["logs/run_1/stdout.log"],
      costCents: 2,
    });
    expect(finalized.receipt?.status).toBe("succeeded");
    expect(finalized.receipt?.exitCode).toBe(0);
    // The frozen half is untouched by finalization.
    expect(finalized.receipt?.bundleDigest).toBe(admission.bundleDigest);
    expect(finalized.receipt?.clientToken).toBe(launch.clientToken);
    expect(finalized.receipt?.policy).toEqual(admission.policy);
  });

  test("the terminal receipt finalizes the run row", async () => {
    const store = new MemoryRunExecutionStore();
    const receipts = createReceiptService(store);
    const { admission, attempt } = await admittedWithAttempt(store, "receipt-terminal");

    await receipts.recordLaunch({
      admission,
      attempt: { ...attempt, clientToken: clientTokenFor(admission.runId, attempt.attemptId), requestDigest: "reqdigest".padEnd(64, "0"), startedBy: "skills-exec/test/a1" },
      taskId: "arn:aws:ecs:us-east-1:mock-account:task/skills-exec-test",
      launchedAt: "2026-08-14T00:00:00.000Z",
    });
    await receipts.finalize({
      runId: admission.runId,
      attemptId: attempt.attemptId,
      status: "failed",
      exitCode: 7,
      completedAt: "2026-08-14T00:02:00.000Z",
    });

    const run = await store.getRun(admission.runId);
    expect(run?.status).toBe("failed");
    expect(run?.terminalReceiptId).toBe(attempt.attemptId);
    const attempts = await store.listAttempts(admission.runId);
    expect(attempts[0]!.status).toBe("terminal");
  });

  test("finalizing without a launch receipt fails closed", async () => {
    const store = new MemoryRunExecutionStore();
    const receipts = createReceiptService(store);
    const { admission, attempt } = await admittedWithAttempt(store, "receipt-no-launch");

    await expect(
      receipts.finalize({
        runId: admission.runId,
        attemptId: attempt.attemptId,
        status: "failed",
        exitCode: 1,
        completedAt: "2026-08-14T00:03:00.000Z",
      }),
    ).rejects.toThrow(/no launch receipt/);
  });
});
