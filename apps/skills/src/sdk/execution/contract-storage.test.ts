import { useDefaultTestTimeout } from "../../test-preload.js";
useDefaultTestTimeout();
import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SqliteRunExecutionStore } from "./storage.js";
import { createSubmitRunService } from "./admission.js";
import { createReceiptService } from "./receipts.js";
import { createImageProfileRegistry } from "./image-profile.js";

test("older SDK database upgrades without rewriting PDF history and persists pure contract across restart", async () => {
  const root = mkdtempSync(join(tmpdir(), "skills-contract-storage-"));
  const path = join(root, "execution.db");
  let store = new SqliteRunExecutionStore(path);
  const imageProfiles = createImageProfileRegistry({ runtimes: [{ runtime: "bun", version: "1.3.14", imageDigest: "sha256:" + "a".repeat(64) }], dependencyLayers: {} });
  const base = { tenantId: "synthetic", skillId: "pdf-generate", skillVersion: "1.0.0", bundleDigest: "b".repeat(64), input: { content: "synthetic" }, runtime: "bun" as const, idempotencyKey: "old-pdf" };
  try {
    const legacy = await createSubmitRunService({ store, imageProfiles }).submit(base);
    await store.close();
    // Model the shipped pre-contract schema, retaining an actual historical row.
    const old = new Database(path);
    old.run("ALTER TABLE execution_runs DROP COLUMN execution_contract_json");
    old.run("ALTER TABLE execution_receipts DROP COLUMN execution_contract_json");
    old.close();
    store = new SqliteRunExecutionStore(path);
    expect((await store.getRun(legacy.run.runId))!.admission).toEqual(legacy.run);
    const contract = { id: "regex-test.v1" as const, descriptorDigest: "c".repeat(64), entrypoint: "src/index.ts", entrypointDigest: "d".repeat(64) };
    const pure = await createSubmitRunService({ store, imageProfiles }).submit({ ...base, skillId: "synthetic-pure", idempotencyKey: "new-pure", executionContract: contract });
    const attempt = await store.createAttempt({ runId: pure.run.runId, attemptNumber: 1 });
    await createReceiptService(store).recordLaunch({ admission: pure.run, attempt, taskId: "synthetic-task", launchedAt: new Date().toISOString() });
    await store.close();
    store = new SqliteRunExecutionStore(path);
    expect((await store.getRun(pure.run.runId))!.admission.executionContract).toEqual(contract);
    expect((await store.getReceipt(pure.run.runId, attempt.attemptId))!.executionContract).toEqual(contract);
    expect((await store.getRun(legacy.run.runId))!.admission).toEqual(legacy.run);
  } finally { await store.close(); rmSync(root, { recursive: true, force: true }); }
});
