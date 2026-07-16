import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { randomBytes } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { StaticInstallTicketSigningKeyProvider } from "../src/install-policy";
import { ComputersService } from "../src/service";
import { SQLiteStorage } from "../src/storage";

const directories: string[] = [];
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }); });

interface WorkerResult {
  ok: boolean;
  id?: string;
  message?: string;
  journalMode?: string;
  foreignKeys?: number;
  version?: number;
  fileModes?: number[];
  handled?: number;
  mode?: string;
  code?: string;
  status?: number;
  generation?: number;
  digest?: string;
}

async function runWorkers(work: Array<Record<string, string>>): Promise<WorkerResult[]> {
  const workerPath = new URL("./concurrency-worker.ts", import.meta.url).pathname;
  const children = work.map((item) => {
    const encoded = Buffer.from(JSON.stringify(item)).toString("base64url");
    const child = spawn(process.execPath, [workerPath, encoded], { stdio: ["pipe", "pipe", "pipe"] });
    return observeChild(child);
  });
  try {
    await Promise.all(children.map((child) => child.ready));
    for (const child of children) child.process.stdin.end("GO\n");
    const results = await Promise.all(children.map((child) => child.result));
    await Promise.all(children.map((child) => child.exited));
    return results;
  } finally {
    for (const child of children) if (child.process.exitCode === null) child.process.kill("SIGTERM");
  }
}

function observeChild(process: ChildProcessWithoutNullStreams): {
  process: ChildProcessWithoutNullStreams;
  ready: Promise<void>;
  result: Promise<WorkerResult>;
  exited: Promise<void>;
  checked: Promise<void>;
} {
  let stderr = "";
  process.stderr.setEncoding("utf8");
  process.stderr.on("data", (chunk: string) => { stderr += chunk; });
  let readyResolve!: () => void;
  let readyReject!: (error: Error) => void;
  let resultResolve!: (result: WorkerResult) => void;
  let resultReject!: (error: Error) => void;
  let checkedResolve!: () => void;
  const ready = new Promise<void>((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  const result = new Promise<WorkerResult>((resolve, reject) => { resultResolve = resolve; resultReject = reject; });
  const checked = new Promise<void>((resolve) => { checkedResolve = resolve; });
  const lines = createInterface({ input: process.stdout });
  lines.on("line", (line) => {
    if (line === "READY") readyResolve();
    else if (line === "CHECKED") checkedResolve();
    else {
      try { resultResolve(JSON.parse(line) as WorkerResult); }
      catch { resultReject(new Error("Worker returned malformed output")); }
    }
  });
  process.once("error", (error) => { readyReject(error); resultReject(error); });
  const exited = new Promise<void>((resolve, reject) => {
    process.once("exit", (code) => {
      if (code === 0) resolve();
      else {
        const error = new Error(`Worker exited with ${code ?? "signal"}${stderr === "" ? "" : `: ${stderr.trim()}`}`);
        readyReject(error); resultReject(error); reject(error);
      }
    });
  });
  return { process, ready, result, exited, checked };
}

async function runBarrierWorkers(work: Array<Record<string, string>>): Promise<WorkerResult[]> {
  const workerPath = new URL("./concurrency-worker.ts", import.meta.url).pathname;
  const children = work.map((item) => observeChild(spawn(process.execPath, [workerPath, Buffer.from(JSON.stringify(item)).toString("base64url")], {
    stdio: ["pipe", "pipe", "pipe"],
  })));
  try {
    await Promise.all(children.map((child) => child.ready));
    for (const child of children) child.process.stdin.write("GO\n");
    await Promise.all(children.map((child) => child.checked));
    for (const child of children) child.process.stdin.end("COMMIT\n");
    const results = await Promise.all(children.map((child) => child.result));
    await Promise.all(children.map((child) => child.exited));
    return results;
  } finally {
    for (const child of children) if (child.process.exitCode === null) child.process.kill("SIGTERM");
  }
}

describe("real multi-connection quota concurrency", () => {
  test("concurrent controllers upgrade a shared 0001 database exactly once", async () => {
    const directory = mkdtempSync(join(process.cwd(), ".test-data-upgrade-v1-")); directories.push(directory);
    const database = join(directory, "controller.db"); const legacy = new Database(database);
    legacy.exec(readFileSync("migrations/sqlite/0001_initial.sql", "utf8")); legacy.close();
    const results = await runWorkers(Array.from({ length: 20 }, () => ({ mode: "initialize", database })));
    expect(results.filter((result) => !result.ok)).toEqual([]);
    expect(results.every((result) => result.version === 3 && result.foreignKeys === 1 && result.journalMode === "wal")).toBe(true);
    const storage = new SQLiteStorage(database); try {
      expect(storage.ready()).toBe(true);
      expect((storage.database.query("SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 3").get() as { count: number }).count).toBe(1);
    } finally { storage.close(); }
  });

  test("two synchronized workers allow only the provider-attempt transaction winner to mutate", async () => {
    const directory = mkdtempSync(join(process.cwd(), ".test-data-provider-attempt-")); directories.push(directory);
    const database = join(directory, "controller.db");
    const markerPath = join(directory, "provider-side-effects.log");
    const storage = new SQLiteStorage(database); storage.migrate();
    const service = new ComputersService(storage, { ticketSigningKeyProvider: new StaticInstallTicketSigningKeyProvider(randomBytes(32)) });
    service.createComputer({ tenantId: "tenant_provider_attempt", principalId: "principal_admin", scopes: ["computers:admin"], authMethod: "bearer" }, {
      slug: "provider-attempt", provider: "local_machine", ownerPrincipalId: "principal_owner", idempotencyKey: "provider-attempt-create-001",
    });
    storage.close();

    const results = await runWorkers(Array.from({ length: 2 }, () => ({
      mode: "provider-attempt", database, tenantId: "tenant_provider_attempt", markerPath,
    })));

    expect(results.every((result) => result.ok)).toBe(true);
    expect(results.reduce((sum, result) => sum + (result.handled ?? 0), 0)).toBe(1);
    expect(readFileSync(markerPath, "utf8").trim().split("\n")).toHaveLength(1);
  });

  test("a policy fence committed after worker precheck cannot produce a provider perform claim", async () => {
    const directory = mkdtempSync(join(process.cwd(), ".test-data-provider-policy-fence-")); directories.push(directory);
    const database = join(directory, "controller.db");
    const storage = new SQLiteStorage(database); storage.migrate();
    const service = new ComputersService(storage, { ticketSigningKeyProvider: new StaticInstallTicketSigningKeyProvider(randomBytes(32)) });
    const admin = { tenantId: "tenant_provider_policy_fence", principalId: "principal_admin", scopes: ["computers:admin" as const], authMethod: "bearer" as const };
    const computer = service.createComputer(admin, {
      slug: "provider-policy-fence", provider: "local_machine", ownerPrincipalId: "principal_policy_owner", idempotencyKey: "provider-policy-fence-create",
    });
    const workerPath = new URL("./concurrency-worker.ts", import.meta.url).pathname;
    const work = { mode: "provider-claim-fence", database, tenantId: admin.tenantId, computerId: computer.id };
    const child = observeChild(spawn(process.execPath, [workerPath, Buffer.from(JSON.stringify(work)).toString("base64url")], {
      stdio: ["pipe", "pipe", "pipe"],
    }));
    try {
      await child.ready; child.process.stdin.write("GO\n"); await child.checked;
      service.createInstallPolicy(admin, computer.id, [{ effect: "allow", managers: ["bun"] }]);
      child.process.stdin.end("CLAIM\n");
      expect(await child.result).toMatchObject({ ok: false, code: "policy_generation_mismatch", status: 409 });
      await child.exited;
      expect(storage.getProviderAttempt(admin.tenantId, storage.listOperations(admin.tenantId, computer.id)[0]?.id ?? "missing")).toBeUndefined();
    } finally {
      if (child.process.exitCode === null) child.process.kill("SIGTERM");
      storage.close();
    }
  });

  test("concurrent policy writers replay an exact revision and reject divergent stale generations with 409", async () => {
    const directory = mkdtempSync(join(process.cwd(), ".test-data-policy-cas-")); directories.push(directory);
    const database = join(directory, "controller.db");
    const storage = new SQLiteStorage(database); storage.migrate();
    const service = new ComputersService(storage, { ticketSigningKeyProvider: new StaticInstallTicketSigningKeyProvider(randomBytes(32)) });
    const admin = { tenantId: "tenant_policy_cas", principalId: "principal_admin", scopes: ["computers:admin" as const], authMethod: "bearer" as const };
    const replayComputer = service.createComputer(admin, {
      slug: "policy-cas-replay", provider: "local_machine", ownerPrincipalId: "principal_policy_replay", idempotencyKey: "policy-cas-replay-create",
    });
    const replay = await runBarrierWorkers(Array.from({ length: 2 }, () => ({
      mode: "policy-cas", database, tenantId: admin.tenantId, computerId: replayComputer.id, policyEffect: "allow",
    })));
    expect(replay.every((result) => result.ok && result.generation === 2)).toBe(true);
    expect(new Set(replay.map((result) => result.id)).size).toBe(1);
    expect(new Set(replay.map((result) => result.digest)).size).toBe(1);

    storage.updateComputerStatus(admin.tenantId, replayComputer.id, "deleted");
    const divergentComputer = service.createComputer(admin, {
      slug: "policy-cas-divergent", provider: "local_machine", ownerPrincipalId: "principal_policy_divergent", idempotencyKey: "policy-cas-divergent-create",
    });
    const divergent = await runBarrierWorkers(["allow", "deny"].map((policyEffect) => ({
      mode: "policy-cas", database, tenantId: admin.tenantId, computerId: divergentComputer.id, policyEffect,
    })));
    expect(divergent.filter((result) => result.ok)).toHaveLength(1);
    expect(divergent.filter((result) => !result.ok)).toEqual([expect.objectContaining({ code: "conflict", status: 409 })]);
    expect((storage.database.query("SELECT COUNT(*) AS count FROM install_policy_revisions WHERE tenant_id = ? AND computer_id = ? AND generation = 2")
      .get(admin.tenantId, divergentComputer.id) as { count: number }).count).toBe(1);
    storage.close();
  });

  test("a worker cannot observe a start operation before its home capability is committed", async () => {
    const directory = mkdtempSync(join(process.cwd(), ".test-data-lifecycle-atomic-")); directories.push(directory);
    const database = join(directory, "controller.db");
    const markerPath = join(directory, "binding-paused.log");
    const storage = new SQLiteStorage(database); storage.migrate();
    const service = new ComputersService(storage, { ticketSigningKeyProvider: new StaticInstallTicketSigningKeyProvider(randomBytes(32)) });
    const admin = { tenantId: "tenant_lifecycle_atomic", principalId: "principal_admin", scopes: ["computers:admin" as const], authMethod: "bearer" as const };
    const computer = service.createComputer(admin, {
      slug: "lifecycle-atomic", provider: "local_machine", ownerPrincipalId: "principal_lifecycle_owner", idempotencyKey: "lifecycle-atomic-create",
    });
    const create = storage.listOperations(admin.tenantId, computer.id)[0];
    if (create === undefined) throw new Error("Missing create operation");
    storage.completeProviderOperation(create, storage.beginProviderAttempt(create), {
      kind: "success", resource: { resourceId: "resource_lifecycle_atomic" }, result: { lifecycle: "stopped" },
    });
    storage.acquireHomeLease(admin.tenantId, computer.id, computer.ownerPrincipalId, "controller_lifecycle_atomic", 60, 0);
    storage.close();

    const work = {
      mode: "lifecycle-start", database, tenantId: admin.tenantId, computerId: computer.id,
      markerPath, idempotencyKey: "lifecycle-atomic-start",
    };
    const workerPath = new URL("./concurrency-worker.ts", import.meta.url).pathname;
    const children = Array.from({ length: 20 }, () => observeChild(spawn(process.execPath, [workerPath, Buffer.from(JSON.stringify(work)).toString("base64url")], {
      stdio: ["pipe", "pipe", "pipe"],
    })));
    try {
      await Promise.all(children.map((child) => child.ready));
      for (const child of children) child.process.stdin.end("GO\n");
      const deadline = Date.now() + 10_000;
      while (!existsSync(markerPath) || readFileSync(markerPath, "utf8").trim().split("\n").length < children.length) {
        if (Date.now() >= deadline) throw new Error("Lifecycle writers did not reach the synchronized request");
        await Bun.sleep(10);
      }
      const observer = new Database(database, { readonly: true, strict: true });
      try {
        for (let probe = 0; probe < 100; probe += 1) {
          expect((observer.query(`SELECT COUNT(*) AS count FROM operations operation
            LEFT JOIN operation_home_leases lease ON lease.tenant_id = operation.tenant_id AND lease.operation_id = operation.id
            WHERE operation.tenant_id = ? AND operation.computer_id = ? AND operation.kind = 'start' AND lease.operation_id IS NULL`)
            .get(admin.tenantId, computer.id) as { count: number }).count).toBe(0);
          await Bun.sleep(1);
        }
        const results = await Promise.all(children.map((child) => child.result));
        await Promise.all(children.map((child) => child.exited));
        expect(results.every((result) => result.ok)).toBe(true);
        expect(new Set(results.map((result) => result.id)).size).toBe(1);
        const operationId = results[0]?.id;
        expect(operationId).toBeString();
        expect(observer.query("SELECT status FROM operations WHERE tenant_id = ? AND id = ?").get(admin.tenantId, operationId ?? "missing"))
          .toEqual({ status: "pending" });
        expect(observer.query("SELECT computer_id, holder_id, fence FROM operation_home_leases WHERE tenant_id = ? AND operation_id = ?")
          .get(admin.tenantId, operationId ?? "missing")).toEqual({
          computer_id: computer.id, holder_id: "controller_lifecycle_atomic", fence: 1,
        });
      } finally { observer.close(false); }
    } finally {
      for (const child of children) if (child.process.exitCode === null) child.process.kill("SIGTERM");
    }
  }, 15_000);

  test("100 independent processes allow one distinct child and one duplicate result", async () => {
    const directory = mkdtempSync(join(process.cwd(), ".test-data-concurrency-")); directories.push(directory);
    const database = join(directory, "controller.db");
    const storage = new SQLiteStorage(database); storage.migrate();
    const service = new ComputersService(storage, { ticketSigningKeyProvider: new StaticInstallTicketSigningKeyProvider(randomBytes(32)) });
    const admin = { tenantId: "tenant_concurrency", principalId: "principal_admin", scopes: ["computers:admin" as const], authMethod: "bearer" as const };
    const parent = service.createComputer(admin, { slug: "parent", provider: "local_machine", ownerPrincipalId: "principal_owner", idempotencyKey: "concurrency-parent" });
    const allowedOwners = Array.from({ length: 100 }, (_, index) => `principal_child_${String(index).padStart(3, "0")}`);
    const grant = service.createComputerGrant(admin, {
      principalId: "principal_owner", ownerPrincipalId: "principal_owner", parentComputerId: parent.id,
      allowedProviders: ["local_machine"], allowedChildOwnerPrincipalIds: allowedOwners, allowedRegions: ["local"],
      allowedProfileIds: ["profile_default"], maxStorageGiB: 32, maxUptimeSeconds: 600, maxBudgetMicros: 1000, limit: 1,
    } as never);
    storage.close();
    const distinct = await runWorkers(Array.from({ length: 100 }, (_, index) => ({
      database, parentComputerId: parent.id, grantId: grant.id, slug: `child-${index}`,
      ownerPrincipalId: allowedOwners[index] ?? "principal_child_missing", idempotencyKey: `concurrent-${String(index).padStart(3, "0")}`,
    })));
    expect(distinct.filter((item) => item.ok)).toHaveLength(1);

    const secondDirectory = mkdtempSync(join(process.cwd(), ".test-data-concurrency-")); directories.push(secondDirectory);
    const secondDatabase = join(secondDirectory, "controller.db");
    const secondStorage = new SQLiteStorage(secondDatabase); secondStorage.migrate();
    const secondService = new ComputersService(secondStorage, { ticketSigningKeyProvider: new StaticInstallTicketSigningKeyProvider(randomBytes(32)) });
    const secondParent = secondService.createComputer(admin, { slug: "parent-two", provider: "local_machine", ownerPrincipalId: "principal_owner", idempotencyKey: "concurrency-parent-two" });
    const secondGrant = secondService.createComputerGrant(admin, {
      principalId: "principal_owner", ownerPrincipalId: "principal_owner", parentComputerId: secondParent.id,
      allowedProviders: ["local_machine"], allowedChildOwnerPrincipalIds: ["principal_duplicate"], allowedRegions: ["local"],
      allowedProfileIds: ["profile_default"], maxStorageGiB: 32, maxUptimeSeconds: 600, maxBudgetMicros: 1000, limit: 1,
    } as never);
    secondStorage.close();
    const duplicateWork = { database: secondDatabase, parentComputerId: secondParent.id, grantId: secondGrant.id, slug: "duplicate", ownerPrincipalId: "principal_duplicate", idempotencyKey: "concurrent-duplicate" };
    const duplicates = await runWorkers(Array.from({ length: 100 }, () => duplicateWork));
    expect(duplicates.every((item) => item.ok)).toBe(true);
    expect(new Set(duplicates.map((item) => item.id)).size).toBe(1);
  }, 60_000);

  test("100 simultaneous connections initialize missing and existing databases for 10 repetitions each", async () => {
    for (const state of ["missing", "existing"] as const) {
      for (let repetition = 0; repetition < 10; repetition += 1) {
        const directory = mkdtempSync(join(process.cwd(), `.test-data-initialize-${state}-`)); directories.push(directory);
        const database = join(directory, "controller.db");
        if (state === "existing") {
          const storage = new SQLiteStorage(database);
          storage.migrate();
          storage.close();
        }
        const results = await runWorkers(Array.from({ length: 100 }, () => ({ mode: "initialize", database })));
        expect(results.filter((result) => !result.ok), `${state} repetition ${repetition + 1}: ${results.filter((result) => !result.ok).map((result) => result.message).join(", ")}`).toEqual([]);
        expect(results.every((result) => result.journalMode === "wal")).toBe(true);
        expect(results.every((result) => result.foreignKeys === 1)).toBe(true);
        expect(results.every((result) => result.version === 3)).toBe(true);
        expect(results.every((result) => (result.fileModes?.length ?? 0) >= 1 && result.fileModes?.every((mode) => mode === 0o600))).toBe(true);
      }
    }
  }, 180_000);
});
