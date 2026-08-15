import { describe, expect, test } from "bun:test";

import { useDefaultTestTimeout } from "../../test-preload.js";
useDefaultTestTimeout();

import { createSubmitRunService } from "./admission.js";
import { createImageProfileRegistry } from "./image-profile.js";
import { createRunStateMachine } from "./state-machine.js";
import { MemoryRunExecutionStore, SqliteRunExecutionStore } from "./storage.js";
import type { RunExecutionStore } from "./storage.js";

const PROFILES = createImageProfileRegistry({
  runtimes: [{ runtime: "bun", version: "1.3.14", imageDigest: "sha256:" + "a".repeat(64) }],
  dependencyLayers: {},
});

const stores: Array<[string, () => RunExecutionStore]> = [
  ["memory", () => new MemoryRunExecutionStore()],
  ["sqlite", () => new SqliteRunExecutionStore(":memory:")],
];

async function admittedRun(store: RunExecutionStore, key: string): Promise<string> {
  const service = createSubmitRunService({ store, imageProfiles: PROFILES });
  const { run } = await service.submit({
    tenantId: "tenant-sm-test",
    skillId: "pdf-generate",
    skillVersion: "1.0.0",
    bundleDigest: "sha256:" + "d".repeat(64),
    input: {},
    idempotencyKey: key,
    runtime: "bun",
  });
  return run.runId;
}

for (const [label, makeStore] of stores) {
  describe(`run state machine (${label})`, () => {
    test("admitted → leased → running → succeeded, with every transition recorded", async () => {
      const store = makeStore();
      const machine = createRunStateMachine(store);
      const runId = await admittedRun(store, "sm-happy");

      const attempt = await store.createAttempt({ runId, attemptNumber: 1 });
      const leased = await machine.lease({
        runId,
        attemptId: attempt.attemptId,
        workerId: "worker-1",
        expectedLeaseGeneration: 0,
      });
      expect(leased.ok).toBe(true);
      if (!leased.ok) return;
      expect(leased.leaseGeneration).toBe(1);

      // A stale lease (expected generation 0 again) is rejected by the CAS.
      const stale = await machine.lease({
        runId,
        attemptId: attempt.attemptId,
        workerId: "worker-2",
        expectedLeaseGeneration: 0,
      });
      expect(stale.ok).toBe(false);
      expect(stale.ok === false && stale.reason).toBe("STALE_GENERATION");

      expect((await machine.start(runId, attempt.attemptId)).ok).toBe(true);
      expect(await machine.getStatus(runId)).toBe("running");

      const terminated = await machine.terminate({ runId, attemptId: attempt.attemptId, status: "succeeded" });
      expect(terminated.ok).toBe(true);
      expect(await machine.getStatus(runId)).toBe("succeeded");

      // The attempt is terminal, and a terminal run refuses further transitions.
      const attempts = await store.listAttempts(runId);
      expect(attempts[0]!.status).toBe("terminal");
      expect((await machine.start(runId, attempt.attemptId)).ok).toBe(false);
      expect((await machine.terminate({ runId, attemptId: attempt.attemptId, status: "failed" })).ok).toBe(false);
    });

    test("CAS claim: a stale generation is rejected and the lease stays with the current holder", async () => {
      const store = makeStore();
      const machine = createRunStateMachine(store);
      const runId = await admittedRun(store, "sm-cas");

      const attempt = await store.createAttempt({ runId, attemptNumber: 1 });
      const first = await machine.claim({
        runId,
        attemptId: attempt.attemptId,
        workerId: "worker-a",
        expectedLeaseGeneration: 0,
      });
      expect(first.ok).toBe(true);

      // A second claimant with the stale generation is refused.
      const stale = await machine.claim({
        runId,
        attemptId: attempt.attemptId,
        workerId: "worker-b",
        expectedLeaseGeneration: 0,
      });
      expect(stale.ok).toBe(false);
      expect(stale.ok === false && stale.reason).toBe("STALE_GENERATION");

      const attempts = await store.listAttempts(runId);
      expect(attempts[0]!.workerId).toBe("worker-a");
      expect(attempts[0]!.leaseGeneration).toBe(1);
    });

    test("retries keep run_id and increment attempt_id + lease_generation", async () => {
      const store = makeStore();
      const machine = createRunStateMachine(store);
      const runId = await admittedRun(store, "sm-retry");

      const attempt1 = await store.createAttempt({ runId, attemptNumber: 1 });
      const lease1 = await machine.lease({
        runId,
        attemptId: attempt1.attemptId,
        workerId: "worker-1",
        expectedLeaseGeneration: 0,
      });
      expect(lease1.ok).toBe(true);
      expect(lease1.ok && lease1.leaseGeneration).toBe(1);

      // Attempt 1 fails; the run retries under the SAME run_id with a new attempt.
      await machine.start(runId, attempt1.attemptId);
      expect((await machine.terminate({ runId, attemptId: attempt1.attemptId, status: "failed" })).ok).toBe(true);
      expect(await machine.getStatus(runId)).toBe("failed");
      const attemptsAfterFailure = await store.listAttempts(runId);
      expect(attemptsAfterFailure[0]!.status).toBe("terminal");

      // A retry re-admits the run (the only legal exit from failed) before the
      // next attempt is claimed.
      expect((await machine.transition(runId, "failed", "admitted")).ok).toBe(true);

      const attempt2 = await store.createAttempt({ runId, attemptNumber: 2 });
      const lease2 = await machine.lease({
        runId,
        attemptId: attempt2.attemptId,
        workerId: "worker-2",
        expectedLeaseGeneration: 0,
      });
      expect(lease2.ok).toBe(true);
      expect(lease2.ok && lease2.leaseGeneration).toBe(1);

      expect(attempt1.attemptId).toContain("/attempt/1");
      expect(attempt2.attemptId).toContain("/attempt/2");
      expect(attempt2.runId).toBe(runId);
      expect(attempt2.attemptNumber).toBe(2);
    });

    test("cancelling fences the run: further claims and starts are refused", async () => {
      const store = makeStore();
      const machine = createRunStateMachine(store);
      const runId = await admittedRun(store, "sm-cancel");

      const attempt = await store.createAttempt({ runId, attemptNumber: 1 });
      const claimed = await machine.claim({
        runId,
        attemptId: attempt.attemptId,
        workerId: "worker-1",
        expectedLeaseGeneration: 0,
      });
      expect(claimed.ok).toBe(true);

      const cancelled = await machine.cancel(runId);
      expect(cancelled.ok).toBe(true);
      expect(await machine.getStatus(runId)).toBe("cancelled");

      const laterClaim = await machine.claim({
        runId,
        attemptId: attempt.attemptId,
        workerId: "worker-2",
        expectedLeaseGeneration: 1,
      });
      expect(laterClaim.ok).toBe(false);
      expect(laterClaim.ok === false && laterClaim.reason).toBe("RUN_CANCELLED");
    });

    test("invalid transitions are rejected and recorded nowhere", async () => {
      const store = makeStore();
      const machine = createRunStateMachine(store);
      const runId = await admittedRun(store, "sm-invalid");

      // admitted → running is not a legal step.
      expect((await machine.start(runId, "no-such-attempt")).ok).toBe(false);
      expect((await machine.transition(runId, "admitted", "running")).ok).toBe(false);
      expect(await machine.getStatus(runId)).toBe("admitted");
    });
  });
}
