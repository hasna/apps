import { useDefaultTestTimeout } from "../test-preload.js";
useDefaultTestTimeout();
import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { RuntimeExecutionStore } from "./runtime-store.js";
import type { FrozenAdmission } from "../sdk/execution/types.js";
const adminUrl = process.env.HASNA_SKILLS_TEST_DATABASE_URL;
(adminUrl ? test : test.skip)(
  "runtime Postgres shares idempotent admissions, quotas, generation claims and terminal fences across connections",
  async () => {
    const { SQL } = await import("bun");
    const admin = new SQL(adminUrl!);
    const database = "skills_runtime_test_" + randomUUID().replace(/-/g, "");
    const url = new URL(adminUrl!);
    url.pathname = "/" + database;
    const stores: RuntimeExecutionStore[] = [];
    try {
      await admin.unsafe(`CREATE DATABASE "${database}"`);
      const schema = new SQL(url.toString());
      try {
        await schema.unsafe(
          readFileSync(
            resolve(
              import.meta.dir,
              "../../migrations/postgres/0008_skill_runtime.sql",
            ),
            "utf8",
          ),
        );
      } finally {
        await schema.close();
      }
      stores.push(
        await RuntimeExecutionStore.open(url.toString()),
        await RuntimeExecutionStore.open(url.toString()),
      );
      const admission: FrozenAdmission = {
        contractVersion: 1,
        runId: "run_postgres_one",
        tenantId: "tenant-one",
        skillId: "pdf-generate",
        skillVersion: "1.0.0",
        bundleDigest: "a".repeat(64),
        runtimeImageDigest: "sha256:" + "b".repeat(64),
        dependencyLayerTag: null,
        inputDigest: "c".repeat(64),
        runtime: "bun",
        policy: { egress: "deny", egressAllowlist: [], networkByteCap: 0 },
        limits: {
          maxDurationMs: 60000,
          maxMemoryMb: 512,
          maxCpuUnits: 256,
          maxArtifactsBytes: 2000000,
          maxConcurrency: 1,
        },
        idempotencyKey: "same-key",
        createdAt: new Date().toISOString(),
      };
      const admitted = await Promise.all(
        stores.map((store, i) =>
          store.admit({ ...admission, runId: "run_postgres_" + i }),
        ),
      );
      expect(admitted[0]!.admission.runId).toBe(admitted[1]!.admission.runId);
      await expect(
        stores[1]!.admit({
          ...admission,
          runId: "run_quota_refused",
          idempotencyKey: "different-key",
        }),
      ).rejects.toThrow("concurrency");
      const id = admitted[0]!.admission.runId,
        attempt = await stores[0]!.createAttempt({
          runId: id,
          attemptNumber: 1,
        });
      const claims = await Promise.all(
        stores.map((store, i) =>
          store.claimAttempt({
            runId: id,
            attemptId: attempt.attemptId,
            expectedLeaseGeneration: 0,
            workerId: "worker-" + i,
          }),
        ),
      );
      expect(claims.filter((c) => c.ok)).toHaveLength(1);
      expect(claims.filter((c) => !c.ok)).toHaveLength(1);
      await stores[0]!.setRunStatus(id, "cancelled");
      await expect(stores[1]!.setRunStatus(id, "succeeded")).rejects.toThrow(
        "immutable",
      );
      expect((await stores[1]!.getRun(id))!.status).toBe("cancelled");
    } finally {
      for (const store of stores) await store.close();
      await admin.unsafe(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
      await admin.close();
    }
  },
);
