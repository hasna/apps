import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { ComputersError, type AuthorizationContext, type Computer, type Operation, type ProviderOutcome } from "../src/contracts";
import { StaticInstallTicketSigningKeyProvider } from "../src/install-policy";
import { createProviderPorts, inspectProviderOutcome, validateProviderAssurance, validateProviderOutcome, type ProviderPort } from "../src/providers";
import { ResidentProtocol } from "../src/resident";
import { ComputersService } from "../src/service";
import { SQLiteStorage } from "../src/storage";
import { OperationWorker } from "../src/worker";

const admin: AuthorizationContext = { tenantId: "tenant_review", principalId: "principal_admin", scopes: ["computers:admin"], authMethod: "bearer" };
const ownerBase: AuthorizationContext = {
  tenantId: "tenant_review", principalId: "principal_owner",
  scopes: ["computers:read", "computers:create", "computers:operate", "computers:exec", "computers:install"],
  authMethod: "bearer",
};
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function setup(path = ":memory:"): { storage: SQLiteStorage; service: ComputersService; computer: Computer; owner: AuthorizationContext } {
  const storage = new SQLiteStorage(path); storage.migrate();
  const service = new ComputersService(storage, { ticketSigningKeyProvider: new StaticInstallTicketSigningKeyProvider(randomBytes(32)) });
  const computer = service.createComputer(admin, { slug: "review", provider: "local_machine", ownerPrincipalId: ownerBase.principalId, idempotencyKey: "review-create-001" });
  return { storage, service, computer, owner: { ...ownerBase, boundComputerId: computer.id, policyGeneration: computer.policyGeneration } };
}

function outcomeProvider(outcome: ProviderOutcome, calls: string[] = []): ProviderPort {
  const invoke = async (request: Parameters<ProviderPort["stop"]>[0]): Promise<ProviderOutcome> => {
    calls.push(request.operation.kind);
    return outcome;
  };
  return {
    kind: "local_machine",
    readiness: async () => ({ provider: "local_machine", configured: true, ready: true, confinementClass: "dedicated_machine", controls: {}, limitations: [] }),
    create: invoke, start: invoke, stop: invoke, quarantine: invoke, delete: invoke, restore: invoke, reconcile: invoke,
  };
}

async function finishInitialCreate(storage: SQLiteStorage, computer: Computer): Promise<void> {
  const providers = createProviderPorts();
  providers.local_machine = outcomeProvider({ kind: "success", resource: { resourceId: `resource_${computer.id}` }, result: { lifecycle: "stopped" } });
  await new OperationWorker(storage, providers).runTenant(computer.tenantId);
}

function captureComputersError(action: () => unknown): Pick<ComputersError, "code" | "message" | "status"> {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(ComputersError);
    const failure = error as ComputersError;
    return { code: failure.code, message: failure.message, status: failure.status };
  }
  throw new Error("Expected ComputersError");
}

interface ExecutionCounters {
  getters: number;
  get: number;
  ownKeys: number;
  getPrototypeOf: number;
  getOwnPropertyDescriptor: number;
}

function trackedProxy<T extends object>(target: T, counters: ExecutionCounters, throwing = false, trackGet = false): T {
  const trap = (name: "ownKeys" | "getPrototypeOf" | "getOwnPropertyDescriptor"): void => {
    counters[name] += 1;
    if (throwing) throw new Error(`${name} proxy trap invoked`);
  };
  return new Proxy(target, {
    ...(trackGet ? { get(value, property, receiver) {
      counters.get += 1;
      if (throwing) throw new Error("get proxy trap invoked");
      return Reflect.get(value, property, receiver);
    } } : {}),
    ownKeys(value) { trap("ownKeys"); return Reflect.ownKeys(value); },
    getPrototypeOf(value) { trap("getPrototypeOf"); return Reflect.getPrototypeOf(value); },
    getOwnPropertyDescriptor(value, property) {
      trap("getOwnPropertyDescriptor");
      return Reflect.getOwnPropertyDescriptor(value, property);
    },
  });
}

function expectZeroExecutions(counters: ExecutionCounters): void {
  expect(counters).toEqual({ getters: 0, get: 0, ownKeys: 0, getPrototypeOf: 0, getOwnPropertyDescriptor: 0 });
}

describe("reviewer lifecycle and atomicity blockers", () => {
  test("SQLite initialization rejects missing duplicate and corrupt migration ledgers", () => {
    const replaceHistory = (database: Database, appliedAt: readonly [string, string, string]): void => {
      for (const [index, value] of appliedAt.entries()) {
        database.query("UPDATE schema_migrations SET applied_at = ? WHERE version = ?").run(value, index + 1);
      }
    };
    const corruptions: Array<{ name: string; mutate(database: Database): void }> = [
      {
        name: "missing-ledger",
        mutate(database) { database.exec("DROP TABLE schema_migrations"); },
      },
      {
        name: "missing-version",
        mutate(database) { database.query("DELETE FROM schema_migrations WHERE version = 2").run(); },
      },
      {
        name: "duplicate-version",
        mutate(database) {
          database.exec(`ALTER TABLE schema_migrations RENAME TO schema_migrations_valid;
            CREATE TABLE schema_migrations (version INTEGER, applied_at TEXT NOT NULL);
            INSERT INTO schema_migrations SELECT version, applied_at FROM schema_migrations_valid;
            INSERT INTO schema_migrations SELECT version, applied_at FROM schema_migrations_valid WHERE version = 2;
            DROP TABLE schema_migrations_valid;`);
        },
      },
      {
        name: "corrupt-timestamp",
        mutate(database) { database.query("UPDATE schema_migrations SET applied_at = 'not-a-timestamp' WHERE version = 2").run(); },
      },
      {
        name: "impossible-february-day",
        mutate(database) { replaceHistory(database, ["2025-02-28T00:00:00.000Z", "2025-02-30T00:00:00.000Z", "2025-03-03T00:00:00.000Z"]); },
      },
      {
        name: "non-leap-february-29",
        mutate(database) { replaceHistory(database, ["2025-02-28T00:00:00.000Z", "2025-02-29T00:00:00.000Z", "2025-03-02T00:00:00.000Z"]); },
      },
      {
        name: "day-overflow",
        mutate(database) { replaceHistory(database, ["2025-04-30T00:00:00.000Z", "2025-04-31T00:00:00.000Z", "2025-05-02T00:00:00.000Z"]); },
      },
      {
        name: "month-overflow",
        mutate(database) { replaceHistory(database, ["2025-11-30T00:00:00.000Z", "2025-13-01T00:00:00.000Z", "2026-01-02T00:00:00.000Z"]); },
      },
      {
        name: "normalized-hour-overflow",
        mutate(database) { replaceHistory(database, ["2025-01-01T23:00:00.000Z", "2025-01-01T24:00:00.000Z", "2025-01-02T01:00:00.000Z"]); },
      },
    ];
    for (const corruption of corruptions) {
      const directory = mkdtempSync(join(process.cwd(), `.test-data-ledger-${corruption.name}-`)); temporaryDirectories.push(directory);
      const path = join(directory, "controller.db");
      const initialized = new SQLiteStorage(path); initialized.close();
      const database = new Database(path, { strict: true }); corruption.mutate(database); database.close(false);
      expect(() => new SQLiteStorage(path), corruption.name).toThrow("Storage initialization failed");
    }
  });

  test("SQLite initialization accepts canonical leap-day migration timestamps", () => {
    const directory = mkdtempSync(join(process.cwd(), ".test-data-ledger-valid-leap-day-")); temporaryDirectories.push(directory);
    const path = join(directory, "controller.db");
    const initialized = new SQLiteStorage(path); initialized.close();
    const database = new Database(path, { strict: true });
    for (const [version, appliedAt] of [
      [1, "2024-02-28T23:59:59.999Z"], [2, "2024-02-29T00:00:00.000Z"], [3, "2024-03-01T00:00:00.000Z"],
    ] as const) database.query("UPDATE schema_migrations SET applied_at = ? WHERE version = ?").run(appliedAt, version);
    database.close(false);
    const reopened = new SQLiteStorage(path);
    try { expect(reopened.ready()).toBe(true); }
    finally { reopened.close(); }
  });

  test("SQLite migration rolls back schema and ledger changes when a canonical prefix would make history decrease", () => {
    const directory = mkdtempSync(join(process.cwd(), ".test-data-ledger-future-prefix-")); temporaryDirectories.push(directory);
    const path = join(directory, "controller.db");
    const database = new Database(path, { strict: true });
    database.exec(readFileSync("migrations/sqlite/0001_initial.sql", "utf8"));
    database.query("UPDATE schema_migrations SET applied_at = ? WHERE version = 1").run("9999-12-31T23:59:59.999Z");
    database.close(false);

    expect(() => new SQLiteStorage(path)).toThrow("Storage initialization failed");

    const preserved = new Database(path, { strict: true });
    try {
      expect(preserved.query("SELECT version, applied_at FROM schema_migrations ORDER BY version").all()).toEqual([
        { version: 1, applied_at: "9999-12-31T23:59:59.999Z" },
      ]);
      expect(preserved.query("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'provider_assurance'").get()).toBeNull();
    } finally { preserved.close(false); }
  });

  test("a second worker cannot overlap a slow provider mutation before the owner lease deadline", async () => {
    const directory = mkdtempSync(join(process.cwd(), ".test-data-provider-owner-")); temporaryDirectories.push(directory);
    const database = join(directory, "controller.db");
    const firstStorage = new SQLiteStorage(database); firstStorage.migrate();
    const service = new ComputersService(firstStorage, { ticketSigningKeyProvider: new StaticInstallTicketSigningKeyProvider(randomBytes(32)) });
    const computer = service.createComputer(admin, { slug: "slow-owner", provider: "local_machine", ownerPrincipalId: ownerBase.principalId, idempotencyKey: "slow-owner-create-001" });
    let enteredResolve!: () => void; const entered = new Promise<void>((resolve) => { enteredResolve = resolve; });
    let finishResolve!: () => void; const finish = new Promise<void>((resolve) => { finishResolve = resolve; });
    let createCalls = 0;
    const provider = outcomeProvider({ kind: "success", resource: { resourceId: "resource_slow_owner" }, result: { lifecycle: "stopped" } });
    provider.create = async () => { createCalls += 1; enteredResolve(); await finish; return { kind: "success", resource: { resourceId: "resource_slow_owner" }, result: { lifecycle: "stopped" } }; };
    const providers = createProviderPorts(); providers.local_machine = provider;
    const firstRun = new OperationWorker(firstStorage, providers).runTenant(admin.tenantId);
    await entered;

    const secondStorage = new SQLiteStorage(database);
    try {
      expect(await new OperationWorker(secondStorage, providers).runTenant(admin.tenantId)).toBe(0);
      expect(createCalls).toBe(1);
    } finally { secondStorage.close(); }

    finishResolve(); await firstRun;
    expect(firstStorage.listOperations(admin.tenantId, computer.id)[0]?.status).toBe("succeeded");
    firstStorage.close();
  });

  test("an expired crashed owner is reclaimed for reconcile only and its stale token cannot complete", async () => {
    const directory = mkdtempSync(join(process.cwd(), ".test-data-provider-reclaim-")); temporaryDirectories.push(directory);
    const database = join(directory, "controller.db");
    const firstStorage = new SQLiteStorage(database); firstStorage.migrate();
    const service = new ComputersService(firstStorage, { ticketSigningKeyProvider: new StaticInstallTicketSigningKeyProvider(randomBytes(32)) });
    const computer = service.createComputer(admin, { slug: "crashed-owner", provider: "local_machine", ownerPrincipalId: ownerBase.principalId, idempotencyKey: "crashed-owner-create-001" });
    const operation = firstStorage.listOperations(admin.tenantId, computer.id)[0];
    if (operation === undefined) throw new Error("Missing create operation");
    const crashedClaim = firstStorage.claimProviderAttempt(operation);
    expect(crashedClaim.mode).toBe("perform");
    firstStorage.database.query("UPDATE operation_attempts SET execution_owner_expires_at = ? WHERE tenant_id = ? AND id = ?")
      .run("1970-01-01T00:00:00.000Z", admin.tenantId, crashedClaim.attempt.id);

    let creates = 0; let reconciles = 0;
    const provider = outcomeProvider({ kind: "success", resource: { resourceId: "resource_reclaimed" }, result: {} });
    provider.create = async () => { creates += 1; return { kind: "success", resource: { resourceId: "resource_reclaimed" }, result: {} }; };
    provider.reconcile = async () => { reconciles += 1; return { kind: "success", resource: { resourceId: "resource_reclaimed" }, result: { reconciled: true, lifecycle: "stopped" } }; };
    const providers = createProviderPorts(); providers.local_machine = provider;
    const secondStorage = new SQLiteStorage(database);
    try {
      expect(await new OperationWorker(secondStorage, providers).runTenant(admin.tenantId)).toBe(1);
      expect(creates).toBe(0); expect(reconciles).toBe(1);
      expect(secondStorage.getProviderAttempt(admin.tenantId, operation.id)?.executionOwnerGeneration).toBe(crashedClaim.attempt.executionOwnerGeneration + 1);
      expect(() => firstStorage.completeProviderOperation(operation, crashedClaim.attempt, {
        kind: "success", resource: { resourceId: "resource_stale" }, result: {},
      })).toThrow("does not match");
    } finally { secondStorage.close(); firstStorage.close(); }
  });

  test("a stale owner records restrictive unknown without revoking the reclaimed owner generation", () => {
    const storage = new SQLiteStorage(":memory:"); storage.migrate();
    const service = new ComputersService(storage, { ticketSigningKeyProvider: new StaticInstallTicketSigningKeyProvider(randomBytes(32)) });
    const computer = service.createComputer(admin, { slug: "lost-owner", provider: "local_machine", ownerPrincipalId: ownerBase.principalId, idempotencyKey: "lost-owner-create-001" });
    try {
      const operation = storage.listOperations(admin.tenantId, computer.id)[0]; if (operation === undefined) throw new Error("missing operation");
      const stale = storage.claimProviderAttempt(operation).attempt;
      storage.database.query("UPDATE operation_attempts SET execution_owner_expires_at = ? WHERE tenant_id = ? AND id = ?")
        .run("1970-01-01T00:00:00.000Z", stale.tenantId, stale.id);
      const reclaimed = storage.claimProviderAttempt(operation); expect(reclaimed.mode).toBe("reconcile");
      expect(reclaimed.attempt.executionOwnerGeneration).toBe(stale.executionOwnerGeneration + 1);
      storage.recordProviderOwnershipLost(stale, { resourceId: "resource_stale_owner" });
      expect(storage.getOperation(admin.tenantId, operation.id)?.status).toBe("unknown");
      expect(storage.getComputer(admin.tenantId, computer.id)?.status).toBe("quarantined");
      expect(() => storage.assertProviderAttemptOwnership(reclaimed.attempt)).not.toThrow();
      expect(storage.getProviderAttempt(admin.tenantId, operation.id)?.executionOwnerToken).toBe(reclaimed.attempt.executionOwnerToken);
    } finally { storage.close(); }
  });

  test("provider success drives explicit observed states only after completion", async () => {
    const { storage, service, computer, owner } = setup();
    try {
      await finishInitialCreate(storage, computer);
      expect(storage.getComputer(admin.tenantId, computer.id)?.status).toBe("stopped");
      expect(storage.getProviderBinding(admin.tenantId, computer.id)?.state).toBe("active");
      expect(() => service.requestLifecycle(owner, computer.id, "stop", "invalid-stop-from-stopped")).toThrow("cannot stop from stopped");
      const cases = [
        ["start", "running"], ["stop", "stopped"], ["quarantine", "quarantined"], ["delete", "deleted"],
      ] as const;
      for (const [kind, expected] of cases) {
        if (kind === "stop") storage.updateComputerStatus(admin.tenantId, computer.id, "running");
        if (kind === "quarantine" || kind === "delete") storage.updateComputerStatus(admin.tenantId, computer.id, "stopped");
        const before = storage.getComputer(admin.tenantId, computer.id)?.status;
        if (kind === "start" && storage.getHomeLeaseCapability(admin.tenantId, computer.id) === undefined) storage.acquireHomeLease(admin.tenantId, computer.id, computer.ownerPrincipalId, "controller_lifecycle", 60, 0);
        service.requestLifecycle(kind === "delete" ? admin : owner, computer.id, kind, `lifecycle-${kind}-001`);
        expect(storage.getComputer(admin.tenantId, computer.id)?.status).toBe(before);
        const providers = createProviderPorts(); providers.local_machine = outcomeProvider({
          kind: "success", resource: { resourceId: `resource_${computer.id}` }, result: { lifecycle: expected },
        });
        await new OperationWorker(storage, providers).runTenant(admin.tenantId);
        expect(storage.getComputer(admin.tenantId, computer.id)?.status).toBe(expected);
        expect(storage.getProviderBinding(admin.tenantId, computer.id)?.state).toBe(kind === "delete" ? "released" : "active");
      }
      expect(() => service.requestLifecycle(owner, computer.id, "start", "invalid-start-after-delete")).toThrow("cannot start from deleted");
    } finally { storage.close(); }
  });

  test("reclaimed stop persists an authoritative stronger quarantined lifecycle atomically", async () => {
    const { storage, service, computer, owner } = setup();
    try {
      await finishInitialCreate(storage, computer);
      storage.updateComputerStatus(admin.tenantId, computer.id, "running");
      const stop = service.requestLifecycle(owner, computer.id, "stop", "reclaimed-observed-quarantine-001");
      const abandoned = storage.claimProviderAttempt(stop);
      expect(abandoned.mode).toBe("perform");
      storage.database.query("UPDATE operation_attempts SET execution_owner_expires_at = ? WHERE tenant_id = ? AND id = ?")
        .run("1970-01-01T00:00:00.000Z", admin.tenantId, abandoned.attempt.id);

      let stopCalls = 0; let reconcileCalls = 0;
      const provider = outcomeProvider({
        kind: "success", resource: { resourceId: `resource_${computer.id}` }, result: { lifecycle: "quarantined" },
      });
      provider.stop = async () => { stopCalls += 1; return { kind: "success", resource: { resourceId: `resource_${computer.id}` }, result: { lifecycle: "stopped" } }; };
      provider.reconcile = async () => { reconcileCalls += 1; return {
        kind: "success", resource: { resourceId: `resource_${computer.id}` }, result: { lifecycle: "quarantined" },
      }; };
      const providers = createProviderPorts(); providers.local_machine = provider;
      const auditBefore = Number((storage.database.query("SELECT COUNT(*) AS count FROM audit_events").get() as { count: number }).count);
      const outboxBefore = Number((storage.database.query("SELECT COUNT(*) AS count FROM outbox_events").get() as { count: number }).count);

      expect(await new OperationWorker(storage, providers).runTenant(admin.tenantId)).toBe(1);
      expect(stopCalls).toBe(0); expect(reconcileCalls).toBe(1);
      expect(storage.getComputer(admin.tenantId, computer.id)?.status).toBe("quarantined");
      expect(storage.getOperation(admin.tenantId, stop.id)).toMatchObject({ status: "succeeded", result: { lifecycle: "quarantined" } });
      expect(storage.getProviderAttempt(admin.tenantId, stop.id)?.status).toBe("succeeded");
      expect(storage.getProviderBinding(admin.tenantId, computer.id)).toMatchObject({
        operationId: stop.id, state: "active", resource: { resourceId: `resource_${computer.id}` },
      });
      expect(Number((storage.database.query("SELECT COUNT(*) AS count FROM audit_events").get() as { count: number }).count)).toBe(auditBefore + 1);
      expect(Number((storage.database.query("SELECT COUNT(*) AS count FROM outbox_events").get() as { count: number }).count)).toBe(outboxBefore + 1);
      const audit = storage.database.query("SELECT action, data_json FROM audit_events ORDER BY sequence DESC LIMIT 1").get() as { action: string; data_json: string };
      expect(audit.action).toBe("computer.stop.succeeded");
      expect(JSON.parse(audit.data_json)).toMatchObject({ operationId: stop.id, attemptId: storage.getProviderAttempt(admin.tenantId, stop.id)?.id,
        outcome: "success", computerStatus: "quarantined" });
    } finally { storage.close(); }
  });

  test("invalid observed lifecycle becomes unknown without duplicate mutation or terminal success", async () => {
    const { storage, service, computer, owner } = setup();
    try {
      await finishInitialCreate(storage, computer);
      storage.updateComputerStatus(admin.tenantId, computer.id, "running");
      const stop = service.requestLifecycle(owner, computer.id, "stop", "invalid-observed-lifecycle-worker-001");
      let stopCalls = 0; let reconcileCalls = 0;
      const provider = outcomeProvider({ kind: "success", resource: { resourceId: `resource_${computer.id}` }, result: {} });
      provider.stop = async () => { stopCalls += 1; return {
        kind: "success", resource: { resourceId: `resource_${computer.id}` }, result: { lifecycle: "running" },
      }; };
      provider.reconcile = async () => { reconcileCalls += 1; return {
        kind: "success", resource: { resourceId: `resource_${computer.id}` }, result: { lifecycle: "terminated" },
      }; };
      const providers = createProviderPorts(); providers.local_machine = provider;

      expect(await new OperationWorker(storage, providers).runTenant(admin.tenantId)).toBe(1);
      expect(stopCalls).toBe(1); expect(reconcileCalls).toBe(0);
      expect(storage.getOperation(admin.tenantId, stop.id)).toMatchObject({ status: "unknown", errorCode: "provider_outcome_unknown" });
      expect(storage.getProviderAttempt(admin.tenantId, stop.id)?.status).toBe("unknown");
      expect(storage.getComputer(admin.tenantId, computer.id)?.status).toBe("running");
      expect(storage.getProviderBinding(admin.tenantId, computer.id)?.state).toBe("unknown");
      expect(await new OperationWorker(storage, providers).runTenant(admin.tenantId)).toBe(1);
      expect(stopCalls).toBe(1); expect(reconcileCalls).toBe(1);
      expect((storage.database.query("SELECT COUNT(*) AS count FROM audit_events WHERE action = 'computer.stop.unknown'").get() as { count: number }).count).toBe(1);
      expect((storage.database.query(`SELECT COUNT(*) AS count FROM outbox_events o JOIN audit_events a
        ON json_extract(o.payload_json, '$.auditEventId') = a.id WHERE a.action = 'computer.stop.unknown'`).get() as { count: number }).count).toBe(1);
    } finally { storage.close(); }
  });

  test("start stop quarantine and delete require own compatible lifecycle evidence before terminalization", async () => {
    const cases: Array<{
      name: string;
      kind: "start" | "stop" | "quarantine" | "delete";
      prior: "running" | "stopped";
      result(): unknown;
    }> = [
      { name: "inherited", kind: "start", prior: "stopped", result: () => Object.assign(Object.create({ lifecycle: "running" }), { inheritedOnly: true }) },
      { name: "malformed", kind: "stop", prior: "running", result: () => ({ lifecycle: 1 }) },
      { name: "null-result", kind: "quarantine", prior: "stopped", result: () => null },
      { name: "non-enumerable", kind: "quarantine", prior: "stopped", result: () => {
        const result = {}; Object.defineProperty(result, "lifecycle", { value: "quarantined", enumerable: false }); return result;
      } },
      { name: "non-enumerable-extra", kind: "stop", prior: "running", result: () => {
        const result = { lifecycle: "stopped" }; Object.defineProperty(result, "detail", { value: "hidden", enumerable: false }); return result;
      } },
      { name: "lifecycle-accessor", kind: "quarantine", prior: "stopped", result: () => {
        const result = {}; Object.defineProperty(result, "lifecycle", { enumerable: true, get: () => { throw new Error("lifecycle getter invoked"); } }); return result;
      } },
      { name: "mutating-accessor", kind: "stop", prior: "running", result: () => {
        const result = { lifecycle: "stopped" }; Object.defineProperty(result, "a", {
          enumerable: true, get: () => { result.lifecycle = "running"; return 1; },
        }); return result;
      } },
      { name: "nested", kind: "delete", prior: "stopped", result: () => ({ metadata: { lifecycle: "running" } }) },
    ];
    for (const item of cases) {
      const { storage, service, computer, owner } = setup();
      try {
        await finishInitialCreate(storage, computer);
        storage.updateComputerStatus(admin.tenantId, computer.id, item.prior);
        if (item.kind === "start") storage.acquireHomeLease(admin.tenantId, computer.id, computer.ownerPrincipalId, "controller_invalid_start", 60, 0);
        const operation = service.requestLifecycle(item.kind === "delete" ? admin : owner, computer.id, item.kind, `invalid-${item.name}-${item.kind}-lifecycle-storage-001`);
        const claim = storage.claimProviderAttempt(operation); expect(claim.mode).toBe("perform");
        const beforeStatus = storage.getComputer(admin.tenantId, computer.id)?.status;
        const completed = storage.completeProviderOperation(operation, claim.attempt, {
          kind: "success", resource: { resourceId: `resource_invalid_${item.kind}` }, result: item.result(),
        } as never);
        expect(completed).toMatchObject({ status: "unknown", errorCode: "provider_outcome_unknown" });
        expect(storage.getProviderAttempt(admin.tenantId, operation.id)?.status).toBe("unknown");
        expect(storage.getComputer(admin.tenantId, computer.id)?.status).toBe(beforeStatus);
        expect(storage.getProviderBinding(admin.tenantId, computer.id)?.state).toBe("unknown");
        expect((storage.database.query("SELECT COUNT(*) AS count FROM audit_events WHERE action = ?").get(`computer.${item.kind}.unknown`) as { count: number }).count).toBe(1);
      } finally { storage.close(); }
    }
  });

  test("provider completion reloads persisted lifecycle intent instead of trusting the caller copy", () => {
    const { storage, computer } = setup();
    try {
      const persisted = storage.listOperations(admin.tenantId, computer.id)[0];
      if (persisted === undefined) throw new Error("Missing create operation");
      expect(persisted.desiredComputerStatus).toBe("stopped");
      const callerCopy = { ...persisted, desiredComputerStatus: undefined } as Operation;
      const completed = storage.completeProviderOperation(callerCopy, storage.beginProviderAttempt(persisted), {
        kind: "success", resource: { resourceId: "resource_persisted_lifecycle" }, result: {},
      });
      expect(completed).toMatchObject({ status: "unknown", errorCode: "provider_outcome_unknown" });
      expect(storage.getComputer(admin.tenantId, computer.id)?.status).toBe("provisioning");
      expect(storage.getProviderBinding(admin.tenantId, computer.id)?.state).toBe("unknown");
    } finally { storage.close(); }
  });

  test("create snapshots profile binding without invoking accessors or persisting later values", () => {
    const storage = new SQLiteStorage(":memory:"); storage.migrate();
    const service = new ComputersService(storage, { ticketSigningKeyProvider: new StaticInstallTicketSigningKeyProvider(randomBytes(32)) });
    const originalCreate = storage.createComputer.bind(storage);
    let accessorHits = 0;
    storage.createComputer = ((record, operation, policy, audit) => {
      const valid = operation.request.profile as Record<string, unknown>;
      const hostile: Record<string, unknown> = {
        generation: valid.generation, digest: valid.digest, document: valid.document,
      };
      Object.defineProperty(hostile, "id", {
        enumerable: true,
        get: () => {
          accessorHits += 1;
          return accessorHits < 3 ? valid.id : "profile_poisoned";
        },
      });
      operation.request.profile = hostile;
      return originalCreate(record, operation, policy, audit);
    }) as typeof storage.createComputer;
    try {
      expect(() => service.createComputer(admin, {
        slug: "profile-accessor", provider: "local_machine", ownerPrincipalId: ownerBase.principalId,
        idempotencyKey: "profile-accessor-create-001",
      })).toThrow("Computer profile binding is invalid");
      expect(accessorHits).toBe(0);
      expect(storage.listComputers(admin.tenantId)).toEqual([]);
      expect(storage.listOperations(admin.tenantId)).toEqual([]);
    } finally { storage.close(); }
  });

  test("create validates and persists the same detached request snapshot", () => {
    const storage = new SQLiteStorage(":memory:"); storage.migrate();
    const service = new ComputersService(storage, { ticketSigningKeyProvider: new StaticInstallTicketSigningKeyProvider(randomBytes(32)) });
    const originalCreate = storage.createComputer.bind(storage);
    let originalProfileIdReads = 0;
    storage.createComputer = ((record, operation, policy, audit) => {
      operation.request = new Proxy(operation.request, {
        get(target, property, receiver) {
          if (property === "profileId") {
            originalProfileIdReads += 1;
            return "profile_default";
          }
          return Reflect.get(target, property, receiver);
        },
        getOwnPropertyDescriptor(target, property) {
          const descriptor = Reflect.getOwnPropertyDescriptor(target, property);
          if (property === "profileId" && descriptor !== undefined && "value" in descriptor) {
            return { ...descriptor, value: "profile_poisoned" };
          }
          return descriptor;
        },
      });
      return originalCreate(record, operation, policy, audit);
    }) as typeof storage.createComputer;
    try {
      expect(() => service.createComputer(admin, {
        slug: "profile-proxy", provider: "local_machine", ownerPrincipalId: ownerBase.principalId,
        idempotencyKey: "profile-proxy-create-001",
      })).toThrow("Computer profile binding is invalid");
      expect(originalProfileIdReads).toBe(0);
      expect(storage.listComputers(admin.tenantId)).toEqual([]);
      expect(storage.listOperations(admin.tenantId)).toEqual([]);
    } finally { storage.close(); }
  });

  test("worker validation failures demote an existing binding even when the malformed outcome resource is unavailable", async () => {
    const malformed = [
      { name: "absent-result", outcome: () => ({ kind: "success", resource: { resourceId: "resource_absent_result" } }) },
      { name: "null-result", outcome: () => ({ kind: "success", resource: { resourceId: "resource_null_result" }, result: null }) },
      { name: "array-result", outcome: () => ({ kind: "success", resource: { resourceId: "resource_array_result" }, result: [] }) },
    ] as const;
    for (const item of malformed) {
      const { storage, service, computer, owner } = setup();
      try {
        await finishInitialCreate(storage, computer);
        const originalRecordMalformed = storage.recordProviderMalformed.bind(storage);
        let malformedCalls = 0;
        storage.recordProviderMalformed = ((attempt, outcome) => {
          malformedCalls += 1;
          expect(outcome.kind).toBe("malformed");
          return originalRecordMalformed(attempt, outcome);
        }) as typeof storage.recordProviderMalformed;
        storage.acquireHomeLease(admin.tenantId, computer.id, computer.ownerPrincipalId, `controller_${item.name}`, 60, 0);
        const start = service.requestLifecycle(owner, computer.id, "start", `worker-${item.name}-001`);
        const provider = outcomeProvider({ kind: "definite_failure", code: "unused", message: "unused" });
        provider.start = async () => item.outcome() as never;
        const providers = createProviderPorts(); providers.local_machine = provider;
        expect(await new OperationWorker(storage, providers).runTenant(admin.tenantId)).toBe(1);
        expect(storage.getOperation(admin.tenantId, start.id)).toMatchObject({ status: "unknown", errorCode: "provider_outcome_unknown" });
        expect(storage.getProviderAttempt(admin.tenantId, start.id)?.status).toBe("unknown");
        expect(storage.getComputer(admin.tenantId, computer.id)?.status).toBe("stopped");
        expect(storage.getProviderBinding(admin.tenantId, computer.id)?.state).toBe("unknown");
        expect(malformedCalls).toBe(1);
        const audit = storage.database.query("SELECT data_json FROM audit_events WHERE action = 'computer.start.unknown' ORDER BY sequence DESC LIMIT 1")
          .get() as { data_json: string };
        expect(JSON.parse(audit.data_json).provenance).toBe("malformed_provider_outcome");
      } finally { storage.close(); }
    }
  });

  test("actual worker path rejects provider proxies without executing traps or accessors and preserves malformed provenance", async () => {
    const cases: Array<{
      name: string;
      malformedAtProviderBoundary: boolean;
      expectedResourceId?: string;
      outcome(counters: ExecutionCounters): unknown;
    }> = [
      { name: "result-field-accessor", malformedAtProviderBoundary: true, expectedResourceId: "resource_result_accessor", outcome: (counters) => {
        const value: Record<string, unknown> = { kind: "success", resource: { resourceId: "resource_result_accessor" } };
        Object.defineProperty(value, "result", { enumerable: true, get: () => { counters.getters += 1; throw new Error("result getter invoked"); } });
        return value;
      } },
      { name: "lifecycle-accessor", malformedAtProviderBoundary: true, expectedResourceId: "resource_lifecycle_accessor", outcome: (counters) => {
        const result: Record<string, unknown> = {};
        Object.defineProperty(result, "lifecycle", { enumerable: true, get: () => { counters.getters += 1; throw new Error("lifecycle getter invoked"); } });
        return { kind: "success", resource: { resourceId: "resource_lifecycle_accessor" }, result };
      } },
      { name: "unrelated-accessor", malformedAtProviderBoundary: true, expectedResourceId: "resource_detail_accessor", outcome: (counters) => {
        const result: Record<string, unknown> = { lifecycle: "running" };
        Object.defineProperty(result, "detail", { enumerable: true, get: () => { counters.getters += 1; throw new Error("detail getter invoked"); } });
        return { kind: "success", resource: { resourceId: "resource_detail_accessor" }, result };
      } },
      { name: "inherited-lifecycle", malformedAtProviderBoundary: true, expectedResourceId: "resource_inherited_lifecycle", outcome: (counters) => {
        const prototype: Record<string, unknown> = {};
        Object.defineProperty(prototype, "lifecycle", { enumerable: true, get: () => { counters.getters += 1; return "running"; } });
        return { kind: "success", resource: { resourceId: "resource_inherited_lifecycle" }, result: Object.assign(Object.create(prototype), { detail: "inherited" }) };
      } },
      { name: "nested-lifecycle", malformedAtProviderBoundary: false, outcome: () => ({
        kind: "success", resource: { resourceId: "resource_nested_lifecycle" }, result: { metadata: { lifecycle: "running" } },
      }) },
      { name: "malformed-lifecycle", malformedAtProviderBoundary: false, outcome: () => ({
        kind: "success", resource: { resourceId: "resource_malformed_lifecycle" }, result: { lifecycle: 1 },
      }) },
      { name: "transparent-result-proxy", malformedAtProviderBoundary: true, expectedResourceId: "resource_result_proxy", outcome: (counters) => ({
        kind: "success", resource: { resourceId: "resource_result_proxy" }, result: trackedProxy({ lifecycle: "running" }, counters),
      }) },
      { name: "throwing-result-proxy", malformedAtProviderBoundary: true, expectedResourceId: "resource_throwing_result_proxy", outcome: (counters) => ({
        kind: "success", resource: { resourceId: "resource_throwing_result_proxy" }, result: trackedProxy({ lifecycle: "running" }, counters, true),
      }) },
      { name: "transparent-outcome-proxy", malformedAtProviderBoundary: true, outcome: (counters) => trackedProxy({
        kind: "success", resource: { resourceId: "resource_outcome_proxy" }, result: { lifecycle: "running" },
      }, counters) },
      { name: "throwing-outcome-proxy", malformedAtProviderBoundary: true, outcome: (counters) => trackedProxy({
        kind: "success", resource: { resourceId: "resource_outcome_proxy" }, result: { lifecycle: "running" },
      }, counters, true) },
      { name: "resource-proxy", malformedAtProviderBoundary: true, outcome: (counters) => ({
        kind: "success", resource: trackedProxy({ resourceId: "resource_proxy" }, counters), result: { lifecycle: "running" },
      }) },
      { name: "assurance-proxy", malformedAtProviderBoundary: true, expectedResourceId: "resource_assurance_proxy", outcome: (counters) => ({
        kind: "success", resource: { resourceId: "resource_assurance_proxy" }, result: {
          lifecycle: "running",
          assurance: trackedProxy({
            confinementClass: "dedicated_machine", providerSpecificControlsPassed: true, externalEgressEnforced: false,
            residentIndependentIsolation: false, hostMounts: false, hostSockets: false, portForwards: false, containerd: false,
          }, counters),
        },
      }) },
      { name: "nested-object-proxy", malformedAtProviderBoundary: true, expectedResourceId: "resource_nested_object_proxy", outcome: (counters) => ({
        kind: "success", resource: { resourceId: "resource_nested_object_proxy" },
        result: { lifecycle: "running", metadata: trackedProxy({ safe: true }, counters) },
      }) },
      { name: "nested-array-proxy", malformedAtProviderBoundary: true, expectedResourceId: "resource_nested_array_proxy", outcome: (counters) => ({
        kind: "success", resource: { resourceId: "resource_nested_array_proxy" },
        result: { lifecycle: "running", values: trackedProxy(["safe"], counters) },
      }) },
    ];
    for (const item of cases) {
      const { storage, service, computer, owner } = setup();
      const counters: ExecutionCounters = { getters: 0, get: 0, ownKeys: 0, getPrototypeOf: 0, getOwnPropertyDescriptor: 0 };
      try {
        await finishInitialCreate(storage, computer);
        const originalRecordMalformed = storage.recordProviderMalformed.bind(storage);
        let malformedCalls = 0;
        let recordedResourceId: string | undefined;
        storage.recordProviderMalformed = ((attempt, outcome) => {
          malformedCalls += 1;
          recordedResourceId = outcome.resource?.resourceId;
          return originalRecordMalformed(attempt, outcome);
        }) as typeof storage.recordProviderMalformed;
        storage.acquireHomeLease(admin.tenantId, computer.id, computer.ownerPrincipalId, `controller_${item.name}`, 60, 0);
        const start = service.requestLifecycle(owner, computer.id, "start", `worker-${item.name}-provenance-001`);
        const provider = outcomeProvider({ kind: "definite_failure", code: "unused", message: "unused" });
        provider.start = async () => item.outcome(counters) as never;
        const providers = createProviderPorts(); providers.local_machine = provider;
        expect(await new OperationWorker(storage, providers).runTenant(admin.tenantId)).toBe(1);
        expect(storage.getOperation(admin.tenantId, start.id)).toMatchObject({ status: "unknown", errorCode: "provider_outcome_unknown" });
        expect(storage.getComputer(admin.tenantId, computer.id)?.status).toBe("stopped");
        expect(storage.getProviderBinding(admin.tenantId, computer.id)?.state).toBe("unknown");
        expectZeroExecutions(counters);
        expect(malformedCalls).toBe(item.malformedAtProviderBoundary ? 1 : 0);
        expect(recordedResourceId).toBe(item.expectedResourceId);
        const audit = storage.database.query("SELECT data_json FROM audit_events WHERE action = 'computer.start.unknown' ORDER BY sequence DESC LIMIT 1")
          .get() as { data_json: string };
        expect(JSON.parse(audit.data_json).provenance).toBe(item.malformedAtProviderBoundary ? "malformed_provider_outcome" : undefined);
      } finally { storage.close(); }
    }
  });

  test("storage provider-result snapshots reject proxies before reflection", async () => {
    const cases = [
      { name: "root", result: (counters: ExecutionCounters) => trackedProxy({ lifecycle: "running" }, counters, true) },
      { name: "nested", result: (counters: ExecutionCounters) => ({
        lifecycle: "running", metadata: trackedProxy({ safe: true }, counters, true),
      }) },
      { name: "nested-array", result: (counters: ExecutionCounters) => ({
        lifecycle: "running", values: trackedProxy(["safe"], counters, true),
      }) },
    ];
    for (const item of cases) {
      const { storage, service, computer, owner } = setup();
      const counters: ExecutionCounters = { getters: 0, get: 0, ownKeys: 0, getPrototypeOf: 0, getOwnPropertyDescriptor: 0 };
      try {
        await finishInitialCreate(storage, computer);
        storage.updateComputerStatus(admin.tenantId, computer.id, "stopped");
        storage.acquireHomeLease(admin.tenantId, computer.id, computer.ownerPrincipalId, `controller_storage_proxy_${item.name}`, 60, 0);
        const start = service.requestLifecycle(owner, computer.id, "start", `storage-${item.name}-proxy-result-001`);
        const claim = storage.claimProviderAttempt(start);
        expect(claim.mode).toBe("perform");
        const completed = storage.completeProviderOperation(start, claim.attempt, {
          kind: "success", resource: { resourceId: `resource_storage_${item.name}_proxy` }, result: item.result(counters),
        });
        expect(completed).toMatchObject({ status: "unknown", errorCode: "provider_outcome_unknown" });
        expect(storage.getComputer(admin.tenantId, computer.id)?.status).toBe("stopped");
        expect(storage.getProviderBinding(admin.tenantId, computer.id)).toMatchObject({
          state: "unknown", resource: { resourceId: `resource_storage_${item.name}_proxy` },
        });
        expectZeroExecutions(counters);
      } finally { storage.close(); }
    }
  });

  test("storage completion and malformed recording reject outcome and resource executable objects", async () => {
    const cases: Array<{
      name: string;
      complete(counters: ExecutionCounters): unknown;
    }> = [
      {
        name: "root-outcome-proxy",
        complete: (counters) => trackedProxy({
          kind: "success", resource: { resourceId: "resource_storage_root_proxy" }, result: { lifecycle: "running" },
        }, counters, true, true),
      },
      {
        name: "resource-proxy",
        complete: (counters) => ({
          kind: "success", resource: trackedProxy({ resourceId: "resource_storage_resource_proxy" }, counters, true, true),
          result: { lifecycle: "running" },
        }),
      },
      {
        name: "resource-getter",
        complete: (counters) => {
          const resource: Record<string, unknown> = {};
          Object.defineProperty(resource, "resourceId", {
            enumerable: true, get: () => { counters.getters += 1; throw new Error("resource getter invoked"); },
          });
          return { kind: "success", resource, result: { lifecycle: "running" } };
        },
      },
    ];
    for (const item of cases) {
      const { storage, service, computer, owner } = setup();
      const counters: ExecutionCounters = { getters: 0, get: 0, ownKeys: 0, getPrototypeOf: 0, getOwnPropertyDescriptor: 0 };
      try {
        await finishInitialCreate(storage, computer);
        storage.updateComputerStatus(admin.tenantId, computer.id, "stopped");
        storage.acquireHomeLease(admin.tenantId, computer.id, computer.ownerPrincipalId, `controller_storage_${item.name}`, 60, 0);
        const start = service.requestLifecycle(owner, computer.id, "start", `storage-${item.name}-001`);
        const claim = storage.claimProviderAttempt(start);
        const completed = storage.completeProviderOperation(start, claim.attempt, item.complete(counters) as never);
        expect(completed).toMatchObject({ status: "unknown", errorCode: "provider_outcome_unknown" });
        expect(storage.getComputer(admin.tenantId, computer.id)?.status).toBe("stopped");
        expect(storage.getProviderBinding(admin.tenantId, computer.id)?.state).toBe("unknown");
        expectZeroExecutions(counters);
      } finally { storage.close(); }
    }

    const { storage, service, computer, owner } = setup();
    const counters: ExecutionCounters = { getters: 0, get: 0, ownKeys: 0, getPrototypeOf: 0, getOwnPropertyDescriptor: 0 };
    try {
      await finishInitialCreate(storage, computer);
      storage.acquireHomeLease(admin.tenantId, computer.id, computer.ownerPrincipalId, "controller_storage_malformed_resource", 60, 0);
      const start = service.requestLifecycle(owner, computer.id, "start", "storage-malformed-resource-001");
      const claim = storage.claimProviderAttempt(start);
      storage.recordProviderMalformed(claim.attempt, {
        kind: "malformed", providerOperationId: claim.attempt.providerIdempotencyKey,
        message: "Provider returned a malformed outcome",
        resource: trackedProxy({ resourceId: "resource_storage_malformed_proxy" }, counters, true, true),
      });
      expect(storage.getOperation(admin.tenantId, start.id)).toMatchObject({ status: "unknown", errorCode: "provider_outcome_unknown" });
      expectZeroExecutions(counters);
    } finally { storage.close(); }
  });

  test("direct storage completion applies provider depth node and byte bounds", async () => {
    const cycle: Record<string, unknown> = { lifecycle: "running" }; cycle.self = cycle;
    let tooDeep: Record<string, unknown> = { lifecycle: "running" };
    for (let depth = 0; depth < 65; depth += 1) tooDeep = { nested: tooDeep };
    const cases = [
      { name: "cycle", result: cycle },
      { name: "depth", result: tooDeep },
      { name: "nodes", result: { lifecycle: "running", values: Array.from({ length: 100_001 }, () => null) } },
      { name: "bytes", result: { lifecycle: "running", value: "x".repeat(1024 * 1024 + 1) } },
    ];
    for (const item of cases) {
      const { storage, service, computer, owner } = setup();
      try {
        await finishInitialCreate(storage, computer);
        storage.updateComputerStatus(admin.tenantId, computer.id, "stopped");
        storage.acquireHomeLease(admin.tenantId, computer.id, computer.ownerPrincipalId, `controller_storage_bound_${item.name}`, 60, 0);
        const start = service.requestLifecycle(owner, computer.id, "start", `storage-bound-${item.name}-001`);
        const claim = storage.claimProviderAttempt(start);
        const completed = storage.completeProviderOperation(start, claim.attempt, {
          kind: "success", resource: { resourceId: `resource_storage_bound_${item.name}` }, result: item.result,
        } as never);
        expect(completed).toMatchObject({ status: "unknown", errorCode: "provider_outcome_unknown" });
        expect(completed.result).toBeUndefined();
        expect(storage.getComputer(admin.tenantId, computer.id)?.status).toBe("stopped");
      } finally { storage.close(); }
    }
  });

  test("provider snapshots do not reintroduce polluted prototypes or order-dependent resource recovery", () => {
    let inheritedReads = 0;
    let inheritedWrites = 0;
    const pollution: Record<string, PropertyDescriptor> = {
      kind: { configurable: true, get: () => { inheritedReads += 1; return "definite_failure"; } },
      code: { configurable: true, get: () => { inheritedReads += 1; return "polluted"; } },
      message: { configurable: true, get: () => { inheritedReads += 1; return "polluted"; } },
      confinementClass: { configurable: true, get: () => { inheritedReads += 1; return "strict_vm"; } },
      providerSpecificControlsPassed: { configurable: true, get: () => { inheritedReads += 1; return true; } },
      externalEgressEnforced: { configurable: true, get: () => { inheritedReads += 1; return true; } },
      residentIndependentIsolation: { configurable: true, get: () => { inheritedReads += 1; return true; } },
      hostMounts: { configurable: true, get: () => { inheritedReads += 1; return false; } },
      hostSockets: { configurable: true, get: () => { inheritedReads += 1; return false; } },
      portForwards: { configurable: true, get: () => { inheritedReads += 1; return false; } },
      containerd: { configurable: true, get: () => { inheritedReads += 1; return false; } },
      instanceId: { configurable: true, get: () => { inheritedReads += 1; return "polluted_instance"; }, set: () => { inheritedWrites += 1; } },
      networkPolicyId: { configurable: true, get: () => { inheritedReads += 1; return "polluted_network"; }, set: () => { inheritedWrites += 1; } },
    };
    const prior = Object.fromEntries(Object.keys(pollution).map((key) => [key, Object.getOwnPropertyDescriptor(Object.prototype, key)]));
    try {
      Object.defineProperties(Object.prototype, pollution);
      expect(() => validateProviderOutcome({})).toThrow("Provider returned an invalid outcome");
      expect(() => validateProviderAssurance({})).toThrow("Provider returned invalid assurance evidence");
      const assuranceInput = {
        confinementClass: "dedicated_machine", providerSpecificControlsPassed: true, externalEgressEnforced: false,
        residentIndependentIsolation: false, hostMounts: false, hostSockets: false, portForwards: false, containerd: false,
        networkPolicyId: "network_safe",
      };
      const normalized = validateProviderOutcome({
        kind: "success", resource: { resourceId: "resource_safe", instanceId: "instance_safe" },
        result: { lifecycle: "running", assurance: assuranceInput },
      });
      if (normalized.kind !== "success") throw new Error("Expected normalized success");
      expect(Object.getPrototypeOf(normalized.resource)).toBeNull();
      expect(Object.hasOwn(normalized.resource, "instanceId")).toBe(true);
      expect(normalized.resource.instanceId).toBe("instance_safe");
      const assurance = normalized.result.assurance as Record<string, unknown>;
      expect(Object.getPrototypeOf(assurance)).toBeNull();
      expect(Object.hasOwn(assurance, "networkPolicyId")).toBe(true);
      expect(assurance.networkPolicyId).toBe("network_safe");
      expect(Object.getPrototypeOf(validateProviderAssurance(assuranceInput))).toBeNull();
      expect(inheritedReads).toBe(0);
      expect(inheritedWrites).toBe(0);
    } finally {
      for (const [key, descriptor] of Object.entries(prior)) {
        if (descriptor === undefined) delete (Object.prototype as Record<string, unknown>)[key];
        else Object.defineProperty(Object.prototype, key, descriptor);
      }
    }
    const oversized = Array.from({ length: 100_001 }, () => null);
    for (const outcome of [
      { kind: "success", result: { lifecycle: "running", oversized }, resource: { resourceId: "resource_after_oversized" } },
      { kind: "success", resource: { resourceId: "resource_before_oversized" }, result: { lifecycle: "running", oversized } },
    ]) {
      const inspection = inspectProviderOutcome(outcome);
      expect(inspection.kind).toBe("malformed");
      if (inspection.kind !== "malformed") throw new Error("Expected malformed outcome");
      expect(inspection.resource?.resourceId).toBe(outcome.resource.resourceId);
    }
    const cycle: Record<string, unknown> = { lifecycle: "running" }; cycle.self = cycle;
    const symbolValue = Symbol("provider-symbol");
    const withSymbol: Record<PropertyKey, unknown> = { lifecycle: "running" }; withSymbol[symbolValue] = true;
    let tooDeep: Record<string, unknown> = { lifecycle: "running" };
    for (let depth = 0; depth < 65; depth += 1) tooDeep = { nested: tooDeep };
    const malformedResults = [
      cycle,
      withSymbol,
      tooDeep,
      { lifecycle: "running", oversizedText: "x".repeat(1024 * 1024 + 1) },
    ];
    for (const result of malformedResults) {
      const inspection = inspectProviderOutcome({
        kind: "success", resource: { resourceId: "resource_bounded_snapshot" }, result,
      });
      expect(inspection.kind).toBe("malformed");
      if (inspection.kind !== "malformed") throw new Error("Expected malformed outcome");
      expect(inspection.resource?.resourceId).toBe("resource_bounded_snapshot");
    }
  });

  test("malformed restrictive evidence preserves lifecycle state but revokes resident authority", async () => {
    const { storage, service, computer, owner } = setup();
    let lifecycleReads = 0;
    try {
      await finishInitialCreate(storage, computer);
      storage.updateComputerStatus(admin.tenantId, computer.id, "running");
      storage.setResidentBinding({ tenantId: computer.tenantId, computerId: computer.id, provider: computer.provider,
        providerResourceId: "resource_review", instanceId: "instance_malformed_stop", bootId: "boot_malformed_stop", generation: 1 });
      const stop = service.requestLifecycle(owner, computer.id, "stop", "malformed-stop-authority-001");
      const result: Record<string, unknown> = {};
      Object.defineProperty(result, "lifecycle", { enumerable: true, get: () => { lifecycleReads += 1; return "stopped"; } });
      const provider = outcomeProvider({ kind: "success", resource: { resourceId: "resource_review" }, result: {} });
      provider.stop = async () => ({ kind: "success", resource: { resourceId: "resource_review" }, result }) as never;
      const providers = createProviderPorts(); providers.local_machine = provider;
      expect(await new OperationWorker(storage, providers).runTenant(admin.tenantId)).toBe(1);
      expect(storage.getOperation(admin.tenantId, stop.id)).toMatchObject({ status: "unknown", errorCode: "provider_outcome_unknown" });
      expect(storage.getComputer(admin.tenantId, computer.id)?.status).toBe("running");
      expect(storage.getProviderBinding(admin.tenantId, computer.id)?.state).toBe("unknown");
      expect(storage.getResidentBinding(admin.tenantId, computer.id)).toBeUndefined();
      expect(lifecycleReads).toBe(0);
    } finally { storage.close(); }
  });

  test("JSON-safe incompatible restrictive lifecycle also revokes resident and home authority", async () => {
    const { storage, service, computer, owner } = setup();
    try {
      await finishInitialCreate(storage, computer);
      storage.updateComputerStatus(admin.tenantId, computer.id, "running");
      storage.setResidentBinding({ tenantId: computer.tenantId, computerId: computer.id, provider: computer.provider,
        providerResourceId: "resource_review", instanceId: "instance_incompatible_stop", bootId: "boot_incompatible_stop", generation: 1 });
      const lease = storage.acquireHomeLease(admin.tenantId, computer.id, computer.ownerPrincipalId, "controller_incompatible_stop", 60, 0);
      const stop = service.requestLifecycle(owner, computer.id, "stop", "incompatible-stop-authority-001");
      const provider = outcomeProvider({ kind: "success", resource: { resourceId: "resource_review" }, result: {} });
      provider.stop = async () => ({ kind: "success", resource: { resourceId: "resource_review" }, result: { lifecycle: 1 } }) as never;
      const providers = createProviderPorts(); providers.local_machine = provider;
      expect(await new OperationWorker(storage, providers).runTenant(admin.tenantId)).toBe(1);
      expect(storage.getOperation(admin.tenantId, stop.id)).toMatchObject({ status: "unknown", errorCode: "provider_outcome_unknown" });
      expect(storage.getComputer(admin.tenantId, computer.id)?.status).toBe("running");
      expect(storage.getProviderBinding(admin.tenantId, computer.id)?.state).toBe("unknown");
      expect(storage.getResidentBinding(admin.tenantId, computer.id)).toBeUndefined();
      const currentLease = storage.database.query("SELECT fence, expires_at FROM home_leases WHERE tenant_id = ? AND computer_id = ?")
        .get(admin.tenantId, computer.id) as { fence: number; expires_at: string };
      expect(currentLease.fence).toBeGreaterThan(lease.fence);
      expect(Date.parse(currentLease.expires_at)).toBeLessThanOrEqual(Date.now());
    } finally { storage.close(); }
  });

  test("create without own lifecycle evidence retains unknown binding and delegated quota", async () => {
    const { storage, service, computer: parent } = setup();
    try {
      await finishInitialCreate(storage, parent);
      const grant = service.createComputerGrant(admin, {
        principalId: ownerBase.principalId, ownerPrincipalId: ownerBase.principalId, parentComputerId: parent.id,
        allowedProviders: ["local_machine"], allowedChildOwnerPrincipalIds: ["principal_missing_lifecycle", "principal_quota_blocked"], allowedRegions: ["local"],
        allowedProfileIds: ["profile_default"], maxStorageGiB: 32, maxUptimeSeconds: 600, maxBudgetMicros: 0, limit: 1,
      } as never);
      const delegated = { ...ownerBase, boundComputerId: parent.id, policyGeneration: parent.policyGeneration };
      const child = service.createComputer(delegated, {
        slug: "missing-lifecycle", provider: "local_machine", ownerPrincipalId: "principal_missing_lifecycle", parentComputerId: parent.id, grantId: grant.id,
        region: "local", profileId: "profile_default", storageGiB: 32, uptimeSeconds: 600, budgetMicros: 0, idempotencyKey: "missing-create-lifecycle-001",
      } as never);
      const operation = storage.listOperations(admin.tenantId, child.id)[0]; if (operation === undefined) throw new Error("Missing create operation");
      const completed = storage.completeProviderOperation(operation, storage.beginProviderAttempt(operation), {
        kind: "success", resource: { resourceId: "resource_missing_create_lifecycle" },
      } as never);
      expect(completed).toMatchObject({ status: "unknown", errorCode: "provider_outcome_unknown" });
      expect(storage.getComputer(admin.tenantId, child.id)?.status).toBe("provisioning");
      expect(storage.getProviderBinding(admin.tenantId, child.id)).toMatchObject({ state: "unknown", resource: { resourceId: "resource_missing_create_lifecycle" } });
      expect((storage.database.query("SELECT state FROM child_reservations WHERE grant_id = ? AND child_computer_id = ?").get(grant.id, child.id) as { state: string }).state).toBe("active");
      expect(() => service.createComputer(delegated, {
        slug: "quota-still-held", provider: "local_machine", ownerPrincipalId: "principal_quota_blocked", parentComputerId: parent.id, grantId: grant.id,
        region: "local", profileId: "profile_default", storageGiB: 32, uptimeSeconds: 600, budgetMicros: 0, idempotencyKey: "missing-create-lifecycle-002",
      } as never)).toThrow("quota");
    } finally { storage.close(); }
  });

  test("restore terminalization requires and accepts only own observed running lifecycle", async () => {
    const { storage, computer } = setup();
    try {
      await finishInitialCreate(storage, computer);
      storage.acquireHomeLease(admin.tenantId, computer.id, computer.ownerPrincipalId, "controller_restore", 60, 0);
      const capability = storage.getHomeLeaseCapability(admin.tenantId, computer.id);
      if (capability === undefined) throw new Error("Missing restore home capability");
      const now = new Date().toISOString();
      const restore: Operation = {
        id: "opn_restore_observed_lifecycle", tenantId: admin.tenantId, computerId: computer.id, kind: "restore", status: "pending",
        policyGeneration: computer.policyGeneration, idempotencyKey: "restore-observed-lifecycle-001", request: {},
        priorComputerStatus: "stopped", desiredComputerStatus: "running", fence: 0, createdAt: now, updatedAt: now,
      };
      storage.createOperation(restore, { actorPrincipalId: admin.principalId, action: "computer.restore.requested",
        data: { operationId: restore.id }, computerId: computer.id });
      storage.setOperationHomeLease(restore.id, capability);
      const claim = storage.claimProviderAttempt(restore); expect(claim.mode).toBe("perform");

      const missing = storage.completeProviderOperation(restore, claim.attempt, {
        kind: "success", resource: { resourceId: `resource_${computer.id}` }, result: {},
      });
      expect(missing).toMatchObject({ status: "unknown", errorCode: "provider_outcome_unknown" });
      expect(storage.getComputer(admin.tenantId, computer.id)?.status).toBe("stopped");
      expect(storage.getProviderBinding(admin.tenantId, computer.id)?.state).toBe("unknown");
    } finally { storage.close(); }

    const valid = setup();
    try {
      await finishInitialCreate(valid.storage, valid.computer);
      valid.storage.acquireHomeLease(admin.tenantId, valid.computer.id, valid.computer.ownerPrincipalId, "controller_restore_valid", 60, 0);
      const capability = valid.storage.getHomeLeaseCapability(admin.tenantId, valid.computer.id);
      if (capability === undefined) throw new Error("Missing restore home capability");
      const now = new Date().toISOString();
      const restore: Operation = {
        id: "opn_restore_valid_lifecycle", tenantId: admin.tenantId, computerId: valid.computer.id, kind: "restore", status: "pending",
        policyGeneration: valid.computer.policyGeneration, idempotencyKey: "restore-valid-lifecycle-001", request: {},
        priorComputerStatus: "stopped", desiredComputerStatus: "running", fence: 0, createdAt: now, updatedAt: now,
      };
      valid.storage.createOperation(restore, { actorPrincipalId: admin.principalId, action: "computer.restore.requested",
        data: { operationId: restore.id }, computerId: valid.computer.id });
      valid.storage.setOperationHomeLease(restore.id, capability);
      const claim = valid.storage.claimProviderAttempt(restore); expect(claim.mode).toBe("perform");
      valid.storage.completeProviderOperation(restore, claim.attempt, {
        kind: "success", resource: { resourceId: `resource_${valid.computer.id}` }, result: { lifecycle: "running" },
      });
      expect(valid.storage.getComputer(admin.tenantId, valid.computer.id)?.status).toBe("running");
      expect(valid.storage.getOperation(admin.tenantId, restore.id)).toMatchObject({ status: "succeeded", result: { lifecycle: "running" } });
    } finally { valid.storage.close(); }
  });

  test("create definite failure and unconfigured outcomes remain truthful and release only definite reservations", async () => {
    for (const providerMode of ["definite_failure", "unconfigured"] as const) {
      const { storage, computer } = setup();
      try {
        const providers = createProviderPorts();
        if (providerMode === "definite_failure") providers.local_machine = outcomeProvider({ kind: "definite_failure", code: "provider_rejected", message: "rejected" });
        await new OperationWorker(storage, providers).runTenant(admin.tenantId);
        const operation = storage.listOperations(admin.tenantId, computer.id)[0];
        expect(storage.getComputer(admin.tenantId, computer.id)?.status).toBe("error");
        expect(operation?.status).toBe("failed");
        expect(operation?.errorCode).toBe(providerMode === "unconfigured" ? "provider_not_configured" : "provider_rejected");
        expect(storage.getProviderBinding(admin.tenantId, computer.id)).toBeUndefined();
      } finally { storage.close(); }
    }
  });

  test("definite failure and unconfigured providers retain truthful prior lifecycle state", async () => {
    for (const providerMode of ["definite_failure", "unconfigured"] as const) {
      const { storage, service, computer, owner } = setup();
      try {
        await finishInitialCreate(storage, computer);
        for (const kind of ["start", "stop", "quarantine", "delete"] as const) {
          storage.updateComputerStatus(admin.tenantId, computer.id, kind === "stop" ? "running" : "stopped");
          const before = storage.getComputer(admin.tenantId, computer.id)?.status;
          if (kind === "start" && storage.getHomeLeaseCapability(admin.tenantId, computer.id) === undefined) storage.acquireHomeLease(admin.tenantId, computer.id, computer.ownerPrincipalId, "controller_failure", 60, 0);
          const operation = service.requestLifecycle(kind === "delete" ? admin : owner, computer.id, kind, `${providerMode}-${kind}-001`);
          const providers = createProviderPorts();
          if (providerMode === "definite_failure") providers.local_machine = outcomeProvider({ kind: "definite_failure", code: "provider_rejected", message: "rejected" });
          await new OperationWorker(storage, providers).runTenant(admin.tenantId);
          expect(storage.getComputer(admin.tenantId, computer.id)?.status).toBe(before);
          expect(storage.getOperation(admin.tenantId, operation.id)?.status).toBe("failed");
        }
      } finally { storage.close(); }
    }
  });

  test("unknown create outcome holds quota and reconciles without a second create", async () => {
    const { storage, service, computer: parent } = setup();
    try {
      await finishInitialCreate(storage, parent);
      const grant = service.createComputerGrant(admin, {
        principalId: ownerBase.principalId, ownerPrincipalId: ownerBase.principalId, parentComputerId: parent.id,
        allowedProviders: ["local_machine"], allowedChildOwnerPrincipalIds: ["principal_child", "principal_child_two"], allowedRegions: ["local"],
        allowedProfileIds: ["profile_default"], maxStorageGiB: 64, maxUptimeSeconds: 3600, maxBudgetMicros: 1_000_000,
        limit: 1,
      } as never);
      const delegated = { ...ownerBase, boundComputerId: parent.id, policyGeneration: parent.policyGeneration };
      const child = service.createComputer(delegated, {
        slug: "child", provider: "local_machine", ownerPrincipalId: "principal_child", parentComputerId: parent.id, grantId: grant.id,
        region: "local", profileId: "profile_default", storageGiB: 32, uptimeSeconds: 1800, budgetMicros: 500_000,
        idempotencyKey: "unknown-child-001",
      } as never);
      let creates = 0; let reconciles = 0;
      const provider = outcomeProvider({ kind: "unknown", providerOperationId: "provider_attempt_one", resource: { resourceId: "resource_child" }, message: "timeout" });
      const originalCreate = provider.create.bind(provider);
      provider.create = async (request) => { creates += 1; return originalCreate(request); };
      provider.reconcile = async () => {
        reconciles += 1; return { kind: "success", resource: { resourceId: "resource_child" }, result: { adopted: true, lifecycle: "stopped" } };
      };
      const providers = createProviderPorts(); providers.local_machine = provider;
      await new OperationWorker(storage, providers).runTenant(admin.tenantId);
      expect(storage.listOperations(admin.tenantId, child.id)[0]?.status).toBe("unknown");
      expect(storage.getProviderAttempt(admin.tenantId, storage.listOperations(admin.tenantId, child.id)[0]?.id ?? "")?.providerIdempotencyKey).toStartWith("provider:");
      expect(storage.getProviderBinding(admin.tenantId, child.id)?.state).toBe("unknown");
      expect(() => service.createComputer(delegated, {
        slug: "second", provider: "local_machine", ownerPrincipalId: "principal_child_two", parentComputerId: parent.id, grantId: grant.id,
        region: "local", profileId: "profile_default", storageGiB: 32, uptimeSeconds: 1800, budgetMicros: 500_000,
        idempotencyKey: "unknown-child-002",
      } as never)).toThrow("quota");
      await new OperationWorker(storage, providers).runTenant(admin.tenantId);
      expect(creates).toBe(1); expect(reconciles).toBe(1);
      expect(storage.getComputer(admin.tenantId, child.id)?.status).toBe("stopped");
      expect(storage.getProviderBinding(admin.tenantId, child.id)?.state).toBe("active");
    } finally { storage.close(); }
  });

  test("timeout-before-success cleanup and crash-boundary adoption never oversubscribe quota one", async () => {
    const { storage, service, computer: parent } = setup();
    try {
      await finishInitialCreate(storage, parent);
      const grant = service.createComputerGrant(admin, {
        principalId: ownerBase.principalId, ownerPrincipalId: ownerBase.principalId, parentComputerId: parent.id,
        allowedProviders: ["local_machine"], allowedChildOwnerPrincipalIds: ["principal_timeout", "principal_after_cleanup"], allowedRegions: ["local"],
        allowedProfileIds: ["profile_default"], maxStorageGiB: 64, maxUptimeSeconds: 3600, maxBudgetMicros: 1000, limit: 1,
      } as never);
      const delegated = { ...ownerBase, boundComputerId: parent.id, policyGeneration: 1 };
      const fields = { parentComputerId: parent.id, grantId: grant.id, region: "local", profileId: "profile_default", storageGiB: 32, uptimeSeconds: 300, budgetMicros: 500 };
      const timedOut = service.createComputer(delegated, { ...fields, slug: "timeout", provider: "local_machine", ownerPrincipalId: "principal_timeout", idempotencyKey: "timeout-before-success" } as never);
      let creates = 0; let reconciles = 0;
      const provider = outcomeProvider({ kind: "definite_failure", code: "unused", message: "unused" });
      provider.create = async () => { creates += 1; throw new Error("transport timeout before acknowledgement"); };
      provider.reconcile = async () => { reconciles += 1; return { kind: "definite_failure", code: "not_created", message: "provider confirms no resource" }; };
      const providers = createProviderPorts(); providers.local_machine = provider;
      await new OperationWorker(storage, providers).runTenant(admin.tenantId);
      expect(storage.listOperations(admin.tenantId, timedOut.id)[0]?.status).toBe("unknown");
      expect(() => service.createComputer(delegated, { ...fields, slug: "blocked", provider: "local_machine", ownerPrincipalId: "principal_after_cleanup", idempotencyKey: "blocked-before-cleanup" } as never)).toThrow("quota");
      await new OperationWorker(storage, providers).runTenant(admin.tenantId);
      expect(creates).toBe(1); expect(reconciles).toBe(1);
      expect(storage.listOperations(admin.tenantId, timedOut.id)[0]?.status).toBe("failed");
      const afterCleanup = service.createComputer(delegated, { ...fields, slug: "after-cleanup", provider: "local_machine", ownerPrincipalId: "principal_after_cleanup", idempotencyKey: "after-cleanup-create" } as never);
      expect(afterCleanup.status).toBe("provisioning");

      const createOperation = storage.listOperations(admin.tenantId, afterCleanup.id)[0];
      if (createOperation === undefined) throw new Error("missing create operation");
      const crashedAttempt = storage.beginProviderAttempt(createOperation);
      storage.database.query("UPDATE operation_attempts SET execution_owner_expires_at = ? WHERE tenant_id = ? AND id = ?")
        .run("1970-01-01T00:00:00.000Z", createOperation.tenantId, crashedAttempt.id);
      let crashCreates = 0; let crashReconciles = 0;
      provider.create = async () => { crashCreates += 1; return { kind: "success", resource: { resourceId: "duplicate_resource" }, result: {} }; };
      provider.reconcile = async () => { crashReconciles += 1; return { kind: "success", resource: { resourceId: "resource_after_cleanup" }, result: { adopted: true, lifecycle: "stopped" } }; };
      await new OperationWorker(storage, providers).runTenant(admin.tenantId);
      expect(crashCreates).toBe(0); expect(crashReconciles).toBe(1);
      expect(storage.getProviderBinding(admin.tenantId, afterCleanup.id)?.resource.resourceId).toBe("resource_after_cleanup");
      expect((storage.database.query("SELECT COUNT(*) AS count FROM child_reservations WHERE grant_id = ? AND state IN ('reserved','active')").get(grant.id) as { count: number }).count).toBe(1);
    } finally { storage.close(); }
  });

  test("same idempotent replay emits exactly one audit and outbox effect", () => {
    const storage = new SQLiteStorage(":memory:"); storage.migrate();
    const service = new ComputersService(storage, { ticketSigningKeyProvider: new StaticInstallTicketSigningKeyProvider(randomBytes(32)) });
    try {
      const input = { slug: "idempotent", provider: "local_machine" as const, ownerPrincipalId: ownerBase.principalId, idempotencyKey: "audit-idempotent-001" };
      const first = service.createComputer(admin, input); const second = service.createComputer(admin, input);
      expect(second.id).toBe(first.id);
      const createOperation = storage.listOperations(admin.tenantId, first.id)[0];
      if (createOperation === undefined) throw new Error("missing create operation");
      storage.completeProviderOperation(createOperation, storage.beginProviderAttempt(createOperation), {
        kind: "success", resource: { resourceId: "resource_idempotent" }, result: { lifecycle: "stopped" },
      });
      const owner = { ...ownerBase, boundComputerId: first.id, policyGeneration: 1 };
      const execOne = service.requestExec(owner, first.id, { argv: ["id"], idempotencyKey: "audit-exec-replay" });
      const execTwo = service.requestExec(owner, first.id, { argv: ["id"], idempotencyKey: "audit-exec-replay" });
      expect(execTwo.id).toBe(execOne.id);
      expect(() => service.requestExec(owner, first.id, { argv: ["whoami"], idempotencyKey: "audit-exec-replay" })).toThrow("different request");
      const quarantineOne = service.requestLifecycle(owner, first.id, "quarantine", "audit-quarantine-replay");
      const quarantineTwo = service.requestLifecycle(owner, first.id, "quarantine", "audit-quarantine-replay");
      expect(quarantineTwo.id).toBe(quarantineOne.id);
      const audit = storage.database.query("SELECT COUNT(*) AS count FROM audit_events WHERE action = 'computer.created'").get() as { count: number };
      expect(audit.count).toBe(1);
      expect((storage.database.query("SELECT COUNT(*) AS count FROM audit_events WHERE action = 'exec.requested'").get() as { count: number }).count).toBe(1);
      expect((storage.database.query("SELECT COUNT(*) AS count FROM audit_events WHERE action = 'computer.quarantine.requested'").get() as { count: number }).count).toBe(1);
      expect((storage.database.query(`SELECT COUNT(*) AS count FROM outbox_events o JOIN audit_events a
        ON json_extract(o.payload_json, '$.auditEventId') = a.id WHERE a.action IN ('computer.created','exec.requested','computer.quarantine.requested')`).get() as { count: number }).count).toBe(3);
    } finally { storage.close(); }
  });

  test("lifecycle replay returns the same pending or completed operation after state changes", async () => {
    const cases = [
      { kind: "start" as const, completedStatus: "running" as const, conflictingKind: "quarantine" as const },
      { kind: "stop" as const, completedStatus: "stopped" as const, conflictingKind: "quarantine" as const },
      { kind: "quarantine" as const, completedStatus: "quarantined" as const, conflictingKind: "delete" as const },
      { kind: "delete" as const, completedStatus: "deleted" as const, conflictingKind: "quarantine" as const },
    ];
    for (const lifecycle of cases) {
      const { storage, service, computer } = setup();
      try {
        await finishInitialCreate(storage, computer);
        if (lifecycle.kind === "stop") storage.updateComputerStatus(admin.tenantId, computer.id, "running");
        if (lifecycle.kind === "start") {
          storage.acquireHomeLease(admin.tenantId, computer.id, computer.ownerPrincipalId, `controller_replay_${lifecycle.kind}`, 60, 0);
        }
        const key = `lifecycle-replay-${lifecycle.kind}`;
        const first = service.requestLifecycle(admin, computer.id, lifecycle.kind, key);
        expect(service.requestLifecycle(admin, computer.id, lifecycle.kind, key).id).toBe(first.id);
        expect(() => service.requestLifecycle(admin, computer.id, lifecycle.conflictingKind, key)).toThrow("different request");
        storage.updateOperation(admin.tenantId, first.id, "succeeded", { lifecycle: lifecycle.kind });
        storage.updateComputerStatus(admin.tenantId, computer.id, lifecycle.completedStatus);
        const completedReplay = service.requestLifecycle(admin, computer.id, lifecycle.kind, key);
        expect(completedReplay).toMatchObject({ id: first.id, status: "succeeded", result: { lifecycle: lifecycle.kind } });
        expect((storage.database.query("SELECT COUNT(*) AS count FROM audit_events WHERE action = ?").get(`computer.${lifecycle.kind}.requested`) as { count: number }).count).toBe(1);
      } finally { storage.close(); }
    }
  });

  test("separate services map an active lifecycle collision to the public conflict while preserving replay", async () => {
    const directory = mkdtempSync(join(process.cwd(), ".test-data-lifecycle-conflict-")); temporaryDirectories.push(directory);
    const database = join(directory, "controller.db");
    const firstStorage = new SQLiteStorage(database); firstStorage.migrate();
    const firstService = new ComputersService(firstStorage, { ticketSigningKeyProvider: new StaticInstallTicketSigningKeyProvider(randomBytes(32)) });
    const computer = firstService.createComputer(admin, {
      slug: "lifecycle-conflict", provider: "local_machine", ownerPrincipalId: ownerBase.principalId, idempotencyKey: "lifecycle-conflict-create",
    });
    await finishInitialCreate(firstStorage, computer);
    const secondStorage = new SQLiteStorage(database);
    const secondService = new ComputersService(secondStorage, { ticketSigningKeyProvider: new StaticInstallTicketSigningKeyProvider(randomBytes(32)) });
    try {
      const first = firstService.requestLifecycle(admin, computer.id, "quarantine", "lifecycle-conflict-first");
      expect(secondService.requestLifecycle(admin, computer.id, "quarantine", "lifecycle-conflict-first").id).toBe(first.id);
      expect(captureComputersError(() => secondService.requestLifecycle(admin, computer.id, "delete", "lifecycle-conflict-second"))).toEqual({
        code: "conflict", message: "Computer already has an active lifecycle operation", status: 409,
      });
      expect(captureComputersError(() => secondService.requestLifecycle(admin, computer.id, "start", "lifecycle-conflict-start"))).toEqual({
        code: "conflict", message: "Computer already has an active lifecycle operation", status: 409,
      });
      expect(secondStorage.listOperations(admin.tenantId, computer.id).filter((operation) => operation.kind !== "create")).toHaveLength(1);
    } finally { secondStorage.close(); firstStorage.close(); }
  });

  test("unrelated lifecycle insertion constraints remain storage failures", async () => {
    const { storage, service, computer } = setup();
    try {
      await finishInitialCreate(storage, computer);
      storage.database.exec(`CREATE TRIGGER reject_lifecycle_for_unrelated_reason BEFORE INSERT ON operations
        WHEN NEW.kind = 'quarantine' BEGIN SELECT RAISE(ABORT, 'unrelated lifecycle constraint'); END;`);
      let failure: unknown;
      try { service.requestLifecycle(admin, computer.id, "quarantine", "unrelated-constraint"); } catch (error) { failure = error; }
      expect(failure).toBeInstanceOf(Error);
      expect(failure).not.toBeInstanceOf(ComputersError);
      expect(String(failure)).toContain("unrelated lifecycle constraint");
    } finally { storage.close(); }
  });

  test("start and its home capability commit or roll back as one unit", async () => {
    const { storage, service, computer, owner } = setup();
    try {
      await finishInitialCreate(storage, computer);
      expect(() => service.requestLifecycle(owner, computer.id, "start", "atomic-start-without-lease")).toThrow("current home lease");
      expect((storage.database.query("SELECT COUNT(*) AS count FROM operations WHERE kind = 'start'").get() as { count: number }).count).toBe(0);
      storage.acquireHomeLease(admin.tenantId, computer.id, computer.ownerPrincipalId, "controller_atomic_start", 60, 0);
      storage.database.exec(`CREATE TRIGGER fail_home_capability BEFORE INSERT ON operation_home_leases
        BEGIN SELECT RAISE(ABORT, 'injected capability failure'); END;`);
      expect(() => service.requestLifecycle(owner, computer.id, "start", "atomic-start-with-lease")).toThrow("injected capability failure");
      expect((storage.database.query("SELECT COUNT(*) AS count FROM operations WHERE kind = 'start'").get() as { count: number }).count).toBe(0);
      expect((storage.database.query("SELECT COUNT(*) AS count FROM audit_events WHERE action IN ('computer.start.requested','home_lease.capability_bound')").get() as { count: number }).count).toBe(0);
      storage.database.exec("DROP TRIGGER fail_home_capability");
      const start = service.requestLifecycle(owner, computer.id, "start", "atomic-start-with-lease");
      expect(storage.getOperationHomeLease(admin.tenantId, start.id)).toMatchObject({
        computerId: computer.id, holderId: "controller_atomic_start", fence: 1,
      });
    } finally { storage.close(); }
  });

  test("install consume and operation creation are atomic and idempotent", () => {
    const { storage, service, computer, owner } = setup();
    try {
      service.createInstallPolicy(admin, computer.id, [{ effect: "allow", managers: ["bun"] }]);
      const currentOwner = { ...owner, policyGeneration: 2 };
      const spec = { manager: "bun" as const, name: "atomic", version: "1.0.0", digest: `sha256:${"a".repeat(64)}`, registry: "https://registry.example.invalid/", dependencyClosure: [], allowLifecycleScripts: false };
      const ticket = service.installPlan(currentOwner, computer.id, spec).ticket ?? "";
      storage.database.exec("CREATE TRIGGER fail_install_operation BEFORE INSERT ON operations WHEN NEW.kind = 'install' BEGIN SELECT RAISE(ABORT, 'injected'); END;");
      expect(() => service.installApply(currentOwner, computer.id, ticket, "atomic-install-001")).toThrow();
      expect((storage.database.query("SELECT consumed_at FROM install_tickets").get() as { consumed_at: string | null }).consumed_at).toBeNull();
      storage.database.exec("DROP TRIGGER fail_install_operation");
      const first = service.installApply(currentOwner, computer.id, ticket, "atomic-install-001");
      const second = service.installApply(currentOwner, computer.id, ticket, "atomic-install-001");
      expect(second.id).toBe(first.id);
      const conflictingTicket = service.installPlan(currentOwner, computer.id, { ...spec, name: "atomic-other", digest: `sha256:${"b".repeat(64)}` }).ticket ?? "";
      expect(() => service.installApply(currentOwner, computer.id, conflictingTicket, "atomic-install-001")).toThrow("different request");
      expect((storage.database.query("SELECT COUNT(*) AS count FROM install_tickets WHERE consumed_at IS NULL").get() as { count: number }).count).toBe(1);
      expect((storage.database.query("SELECT COUNT(*) AS count FROM operations WHERE kind = 'install'").get() as { count: number }).count).toBe(1);
      expect((storage.database.query("SELECT COUNT(*) AS count FROM audit_events WHERE action = 'install.apply_requested'").get() as { count: number }).count).toBe(1);
    } finally { storage.close(); }
  });

  test("invalid install policies fail with bounded domain errors before persistence", () => {
    const { storage, service, computer } = setup();
    try {
      for (const rules of [
        [{ effect: "allow", unknown: true }], [{ effect: "maybe" }], [{ effect: "allow", managers: ["unknown"] }],
        [{ effect: "allow", packagePatterns: ["*".repeat(200)] }], [{ effect: "allow", registries: ["http://insecure.invalid"] }],
        [{ effect: "allow", packagePatterns: ["safe-*", "safe-*"] }],
        [{ effect: "allow", registries: ["https://registry.example.invalid", "https://registry.example.invalid/"] }],
        Array.from({ length: 65 }, () => ({ effect: "deny" })),
      ]) {
        expect(() => service.createInstallPolicy(admin, computer.id, rules as never)).toThrow("Invalid install policy");
      }
      expect((storage.database.query("SELECT COUNT(*) AS count FROM install_policy_revisions").get() as { count: number }).count).toBe(1);
    } finally { storage.close(); }
  });

  test("home lease renewal is CAS-only and stale capabilities cannot reach a provider", async () => {
    const { storage, service, computer, owner } = setup();
    try {
      await finishInitialCreate(storage, computer);
      const other = service.createComputer(admin, { slug: "lease-other", provider: "local_machine", ownerPrincipalId: "principal_lease_other", idempotencyKey: "lease-other-create" });
      await finishInitialCreate(storage, other);
      const first = storage.acquireHomeLease(admin.tenantId, computer.id, computer.ownerPrincipalId, "controller_one", 60, 0);
      const otherLease = storage.acquireHomeLease(admin.tenantId, other.id, other.ownerPrincipalId, "controller_other", 60, 0);
      expect(() => storage.acquireHomeLease(admin.tenantId, computer.id, computer.ownerPrincipalId, "controller_one", 60)).toThrow("expected fence");
      expect(() => storage.acquireHomeLease(admin.tenantId, computer.id, computer.ownerPrincipalId, "controller_two", 60, first.fence)).toThrow("active writer");
      const start = service.requestLifecycle(owner, computer.id, "start", "lease-start-001");
      expect(() => storage.setOperationHomeLease(start.id, { ...otherLease, homeId: `home:${other.id}` })).toThrow("does not match operation");
      storage.database.query("UPDATE home_leases SET expires_at = ? WHERE computer_id = ?").run(new Date(0).toISOString(), computer.id);
      const second = storage.acquireHomeLease(admin.tenantId, computer.id, computer.ownerPrincipalId, "controller_two", 60, first.fence);
      let calls = 0;
      const provider = outcomeProvider({ kind: "success", resource: { resourceId: "resource_review" }, result: {} });
      provider.start = async () => { calls += 1; return { kind: "success", resource: { resourceId: "resource_review" }, result: {} }; };
      const providers = createProviderPorts(); providers.local_machine = provider;
      await new OperationWorker(storage, providers).runTenant(admin.tenantId);
      expect(calls).toBe(0);
      expect(second.fence).toBeGreaterThan(first.fence);
    } finally { storage.close(); }
  });

  test("a home lease handoff racing start success is reconciled and quarantined before closure", async () => {
    const { storage, service, computer, owner } = setup();
    try {
      await finishInitialCreate(storage, computer);
      const first = storage.acquireHomeLease(admin.tenantId, computer.id, computer.ownerPrincipalId, "controller_first", 60, 0);
      const start = service.requestLifecycle(owner, computer.id, "start", "lease-race-start-001");
      let starts = 0; let reconciles = 0; let quarantines = 0;
      const provider = outcomeProvider({ kind: "definite_failure", code: "unused", message: "unused" });
      provider.start = async () => {
        starts += 1;
        storage.database.query("UPDATE home_leases SET expires_at = ? WHERE tenant_id = ? AND computer_id = ?")
          .run("1970-01-01T00:00:00.000Z", admin.tenantId, computer.id);
        storage.acquireHomeLease(admin.tenantId, computer.id, computer.ownerPrincipalId, "controller_second", 60, first.fence);
        return { kind: "success", resource: { resourceId: "resource_lease_race" }, result: { lifecycle: "running", running: true } };
      };
      provider.reconcile = async () => { reconciles += 1; return { kind: "success", resource: { resourceId: "resource_lease_race" }, result: { lifecycle: "running", running: true } }; };
      provider.quarantine = async () => { quarantines += 1; return { kind: "success", resource: { resourceId: "resource_lease_race" }, result: { lifecycle: "quarantined", quarantined: true } }; };
      const providers = createProviderPorts(); providers.local_machine = provider;
      const worker = new OperationWorker(storage, providers);
      await worker.runTenant(admin.tenantId);
      expect(starts).toBe(1);
      expect(storage.getOperation(admin.tenantId, start.id)?.status).toBe("unknown");
      await worker.runTenant(admin.tenantId);
      expect(reconciles).toBe(1); expect(quarantines).toBe(1);
      expect(storage.getOperation(admin.tenantId, start.id)).toMatchObject({ status: "failed", errorCode: "stale_fence" });
      expect(storage.getComputer(admin.tenantId, computer.id)?.status).toBe("stopped");
    } finally { storage.close(); }
  });

  test("fenced quarantine without observed lifecycle stays unknown without terminal closure", async () => {
    const { storage, service, computer, owner } = setup();
    try {
      await finishInitialCreate(storage, computer);
      const first = storage.acquireHomeLease(admin.tenantId, computer.id, computer.ownerPrincipalId, "controller_missing_quarantine_first", 60, 0);
      const start = service.requestLifecycle(owner, computer.id, "start", "missing-quarantine-lifecycle-start-001");
      const provider = outcomeProvider({ kind: "definite_failure", code: "unused", message: "unused" });
      provider.start = async () => {
        storage.database.query("UPDATE home_leases SET expires_at = ? WHERE tenant_id = ? AND computer_id = ?")
          .run("1970-01-01T00:00:00.000Z", admin.tenantId, computer.id);
        storage.acquireHomeLease(admin.tenantId, computer.id, computer.ownerPrincipalId, "controller_missing_quarantine_second", 60, first.fence);
        return { kind: "success", resource: { resourceId: "resource_missing_quarantine_lifecycle" }, result: { lifecycle: "running" } };
      };
      provider.reconcile = async () => ({ kind: "success", resource: { resourceId: "resource_missing_quarantine_lifecycle" }, result: { lifecycle: "running" } });
      provider.quarantine = async () => ({ kind: "success", resource: { resourceId: "resource_missing_quarantine_lifecycle" }, result: { quarantined: true } });
      const providers = createProviderPorts(); providers.local_machine = provider;
      const worker = new OperationWorker(storage, providers);
      expect(await worker.runTenant(admin.tenantId)).toBe(1);
      expect(storage.getOperation(admin.tenantId, start.id)?.status).toBe("unknown");
      expect(storage.getComputer(admin.tenantId, computer.id)?.status).toBe("stopped");
      expect(await worker.runTenant(admin.tenantId)).toBe(1);
      expect(storage.getOperation(admin.tenantId, start.id)).toMatchObject({ status: "unknown", errorCode: "provider_outcome_unknown" });
      expect(storage.getComputer(admin.tenantId, computer.id)?.status).toBe("stopped");
      expect(storage.getProviderBinding(admin.tenantId, computer.id)?.state).toBe("unknown");
    } finally { storage.close(); }
  });

  test("stop quarantine and delete atomically revoke resident and home authority", async () => {
    for (const kind of ["stop", "quarantine", "delete"] as const) {
      const { storage, service, computer, owner } = setup();
      try {
        await finishInitialCreate(storage, computer);
        storage.setResidentBinding({ tenantId: computer.tenantId, computerId: computer.id, provider: computer.provider,
          providerResourceId: `resource_${kind}`, instanceId: `instance_${kind}`, bootId: `boot_${kind}`, generation: 1 });
        const protocol = new ResidentProtocol(storage);
        const used = await protocol.precreateEnrollment(computer.tenantId, computer.id);
        const identity = (await protocol.enroll({ token: used.token, provider: computer.provider, instanceId: `instance_${kind}`, bootId: `boot_${kind}` })).identity;
        const pending = await protocol.precreateEnrollment(computer.tenantId, computer.id);
        const lease = storage.acquireHomeLease(computer.tenantId, computer.id, computer.ownerPrincipalId, `controller_${kind}`, 60, 0);
        storage.updateComputerStatus(computer.tenantId, computer.id, kind === "stop" ? "running" : "stopped");
        const operation = service.requestLifecycle(kind === "delete" ? admin : owner, computer.id, kind, `authority-${kind}-001`);
        const providers = createProviderPorts(); providers.local_machine = outcomeProvider({
          kind: "success", resource: { resourceId: `resource_${kind}` }, result: {
            lifecycle: kind === "stop" ? "stopped" : kind === "quarantine" ? "quarantined" : "deleted",
          },
        });
        await new OperationWorker(storage, providers).runTenant(computer.tenantId);
        expect(storage.getOperation(computer.tenantId, operation.id)?.status).toBe("succeeded");
        expect(storage.getResidentIdentity(identity.certificateId)?.revokedAt).toBeDefined();
        expect(storage.getResidentBinding(computer.tenantId, computer.id)).toBeUndefined();
        expect((storage.database.query("SELECT revoked_at FROM resident_enrollments WHERE id = ?").get(pending.enrollment.id) as { revoked_at: string | null }).revoked_at).not.toBeNull();
        const currentLease = storage.database.query("SELECT fence, expires_at FROM home_leases WHERE tenant_id = ? AND computer_id = ?")
          .get(computer.tenantId, computer.id) as { fence: number; expires_at: string };
        expect(currentLease.fence).toBeGreaterThan(lease.fence);
        expect(Date.parse(currentLease.expires_at)).toBeLessThanOrEqual(Date.now());
      } finally { storage.close(); }
    }
  });

  test("strict proof indeterminacy forces quarantine and demotes authority before retry", async () => {
    const storage = new SQLiteStorage(":memory:"); storage.migrate();
    const service = new ComputersService(storage, { ticketSigningKeyProvider: new StaticInstallTicketSigningKeyProvider(randomBytes(32)) });
    try {
      const profile = service.createProfile(admin, { id: "profile_strict_loss", name: "Strict loss VM", document: { provider: "local_vm", cpus: 2, memoryGiB: 4,
        rootDiskGiB: 16, homeDiskGiB: 32, imageLocation: "https://images.example.invalid/strict-loss.qcow2", imageDigest: `sha256:${"b".repeat(64)}` } });
      const created = service.createComputer(admin, { slug: "strict-loss", provider: "local_vm", ownerPrincipalId: ownerBase.principalId, profileId: profile.id, idempotencyKey: "strict-loss-create" });
      storage.database.query("UPDATE computers SET provider = 'aws_ec2' WHERE tenant_id = ? AND id = ?").run(admin.tenantId, created.id);
      const computer = storage.getComputer(admin.tenantId, created.id);
      if (computer === undefined) throw new Error("missing computer");
      const create = storage.listOperations(admin.tenantId, computer.id)[0];
      if (create === undefined) throw new Error("missing create operation");
      const createAttempt = storage.beginProviderAttempt(create);
      const strict = {
        confinementClass: "strict_vm", providerSpecificControlsPassed: true, externalEgressEnforced: true,
        residentIndependentIsolation: true, hostMounts: false, hostSockets: false, portForwards: false, containerd: false,
        networkPolicyId: "policy.strict-loss",
      } as const;
      storage.completeProviderOperation(create, createAttempt, {
        kind: "success", resource: { resourceId: "resource_strict", instanceId: "instance_strict", bootId: "boot_strict" },
        result: { lifecycle: "stopped", assurance: strict, residentBindingVerified: true },
      });
      storage.acquireHomeLease(admin.tenantId, computer.id, computer.ownerPrincipalId, "controller_strict", 60, 0);
      const current = storage.getComputer(admin.tenantId, computer.id);
      if (current === undefined) throw new Error("missing computer");
      const start = service.requestLifecycle({ ...ownerBase, boundComputerId: computer.id, policyGeneration: current.policyGeneration }, computer.id, "start", "strict-loss-start");
      let starts = 0; let reconciles = 0; let quarantines = 0;
      const provider: ProviderPort = { ...outcomeProvider({ kind: "definite_failure", code: "unused", message: "unused" }), kind: "aws_ec2" };
      provider.start = async () => { starts += 1; return { kind: "unknown", providerOperationId: "strict-start", message: "proof unavailable" }; };
      provider.reconcile = async () => { reconciles += 1; return { kind: "success", resource: { resourceId: "resource_strict" }, result: { lifecycle: "running", running: true } }; };
      provider.quarantine = async () => { quarantines += 1; return { kind: "success", resource: { resourceId: "resource_strict" }, result: { lifecycle: "quarantined", quarantined: true } }; };
      const providers = createProviderPorts(); providers.aws_ec2 = provider;
      const worker = new OperationWorker(storage, providers);
      await worker.runTenant(admin.tenantId);
      expect(starts).toBe(1); expect(quarantines).toBe(1);
      expect(storage.getOperation(admin.tenantId, start.id)?.status).toBe("unknown");
      expect(storage.getComputer(admin.tenantId, computer.id)).toMatchObject({ status: "quarantined", confinementClass: "unverified_vm" });
      expect(storage.getProviderAssurance(admin.tenantId, computer.id)?.confinementClass).toBe("unverified_vm");
      expect(storage.getResidentBinding(admin.tenantId, computer.id)).toBeUndefined();
      await worker.runTenant(admin.tenantId);
      expect(reconciles).toBe(1); expect(quarantines).toBe(2);
      expect(storage.getOperation(admin.tenantId, start.id)).toMatchObject({ status: "failed", errorCode: "stale_fence" });
    } finally { storage.close(); }
  });

  test("delegated mutations require current generation and grants enforce ceilings", () => {
    const { storage, service, computer } = setup();
    try {
      expect(() => service.requestExec({ ...ownerBase, boundComputerId: computer.id }, computer.id, { argv: ["id"], idempotencyKey: "missing-generation" })).toThrow("generation");
      const grant = service.createComputerGrant(admin, {
        principalId: ownerBase.principalId, ownerPrincipalId: ownerBase.principalId, parentComputerId: computer.id,
        allowedProviders: ["local_machine"], allowedChildOwnerPrincipalIds: ["principal_allowed"], allowedRegions: ["local"],
        allowedProfileIds: ["profile_default"], maxStorageGiB: 32, maxUptimeSeconds: 600, maxBudgetMicros: 1000, limit: 1,
      } as never);
      const delegated = { ...ownerBase, boundComputerId: computer.id, policyGeneration: computer.policyGeneration };
      expect(() => service.createComputer(delegated, {
        slug: "unrelated", provider: "local_machine", ownerPrincipalId: "principal_unrelated", parentComputerId: computer.id, grantId: grant.id,
        region: "local", profileId: "profile_default", storageGiB: 16, uptimeSeconds: 300, budgetMicros: 500, idempotencyKey: "unrelated-owner-001",
      } as never)).toThrow("Authorization denied");
      const base = {
        slug: "ceiling", provider: "local_machine" as const, ownerPrincipalId: "principal_allowed", parentComputerId: computer.id, grantId: grant.id,
        region: "local", profileId: "profile_default", storageGiB: 16, uptimeSeconds: 300, budgetMicros: 500,
      };
      for (const [index, change] of [
        { provider: "local_vm" }, { region: "elsewhere" }, { profileId: "profile_other" }, { storageGiB: 33 }, { uptimeSeconds: 601 }, { budgetMicros: 1001 },
      ].entries()) {
        expect(() => service.createComputer(delegated, { ...base, ...change, idempotencyKey: `ceiling-denied-${index}` } as never)).toThrow("Authorization denied");
      }
      storage.database.query("UPDATE computer_create_grants SET expires_at = ? WHERE id = ?").run(new Date(0).toISOString(), grant.id);
      expect(() => service.createComputer(delegated, { ...base, idempotencyKey: "expired-grant-create" } as never)).toThrow("Authorization denied");
      storage.database.query("UPDATE computer_create_grants SET expires_at = NULL WHERE id = ?").run(grant.id);
      const now = new Date().toISOString();
      storage.database.query("INSERT INTO grants (id, tenant_id, principal_id, computer_id, scopes_json, policy_generation, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run("gnt_stale_generation", admin.tenantId, ownerBase.principalId, computer.id, '["computers:exec"]', 1, now);
      storage.database.query("INSERT INTO sessions (id, tenant_id, principal_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run("ses_stale_generation", admin.tenantId, ownerBase.principalId, "b".repeat(64), new Date(Date.now() + 60_000).toISOString(), now);
      service.createInstallPolicy(admin, computer.id, [{ effect: "deny" }]);
      expect((storage.database.query("SELECT active FROM computer_create_grants WHERE id = ?").get(grant.id) as { active: number }).active).toBe(0);
      expect((storage.database.query("SELECT revoked_at FROM grants WHERE id = ?").get("gnt_stale_generation") as { revoked_at: string | null }).revoked_at).not.toBeNull();
      expect((storage.database.query("SELECT revoked_at FROM sessions WHERE id = ?").get("ses_stale_generation") as { revoked_at: string | null }).revoked_at).not.toBeNull();
      expect(() => service.createComputer({ ...delegated, policyGeneration: 2 }, {
        slug: "stale-grant", provider: "local_machine", ownerPrincipalId: "principal_allowed", parentComputerId: computer.id, grantId: grant.id,
        region: "local", profileId: "profile_default", storageGiB: 16, uptimeSeconds: 300, budgetMicros: 500, idempotencyKey: "stale-grant-001",
      } as never)).toThrow("Authorization denied");
      expect(() => service.listComputerGrants({ tenantId: admin.tenantId, principalId: "principal_none", scopes: ["computers:exec"], authMethod: "bearer" })).toThrow("Authorization denied");
    } finally { storage.close(); }
  });

  test("invalid expired and unauthorized grants cannot disclose whether a requested profile exists", () => {
    const { storage, service, computer } = setup();
    try {
      const existingProfileId = "profile_oracle_existing";
      const missingProfileId = "profile_oracle_missing";
      service.createProfile(admin, {
        id: existingProfileId,
        name: "Oracle existing",
        document: {
          provider: "local_vm", cpus: 2, memoryGiB: 4, rootDiskGiB: 16, homeDiskGiB: 32,
          imageLocation: "https://images.example.invalid/oracle.qcow2", imageDigest: `sha256:${"d".repeat(64)}`,
        },
      });
      const grant = service.createComputerGrant(admin, {
        principalId: ownerBase.principalId, ownerPrincipalId: ownerBase.principalId, parentComputerId: computer.id,
        allowedProviders: ["local_machine", "local_vm"], allowedChildOwnerPrincipalIds: ["principal_oracle_child"], allowedRegions: ["local"],
        allowedProfileIds: [existingProfileId, missingProfileId], maxStorageGiB: 32, maxUptimeSeconds: 600, maxBudgetMicros: 1000, limit: 8,
      } as never);
      const delegated = { ...ownerBase, boundComputerId: computer.id, policyGeneration: computer.policyGeneration };
      const request = (profileId: string, grantId: string, ownerPrincipalId = "principal_oracle_child") => ({
        slug: `oracle-${profileId.endsWith("existing") ? "existing" : "missing"}`,
        provider: "local_vm" as const, ownerPrincipalId, parentComputerId: computer.id, grantId,
        region: "local", profileId, storageGiB: 32, uptimeSeconds: 300, budgetMicros: 500,
        idempotencyKey: `oracle-${grantId}-${profileId}-${ownerPrincipalId}`,
      });
      const assertSameDenied = (left: () => unknown, right: () => unknown) => {
        const existingFailure = captureComputersError(left);
        const missingFailure = captureComputersError(right);
        expect(existingFailure).toEqual({ code: "authorization_denied", message: "Authorization denied", status: 403 });
        expect(missingFailure).toEqual(existingFailure);
      };

      assertSameDenied(
        () => service.createComputer(delegated, request(existingProfileId, "grt_oracle_invalid") as never),
        () => service.createComputer(delegated, request(missingProfileId, "grt_oracle_invalid") as never),
      );
      storage.database.query("UPDATE computer_create_grants SET expires_at = ? WHERE tenant_id = ? AND id = ?")
        .run("1970-01-01T00:00:00.000Z", admin.tenantId, grant.id);
      assertSameDenied(
        () => service.createComputer(delegated, request(existingProfileId, grant.id) as never),
        () => service.createComputer(delegated, request(missingProfileId, grant.id) as never),
      );
      storage.database.query("UPDATE computer_create_grants SET expires_at = NULL WHERE tenant_id = ? AND id = ?")
        .run(admin.tenantId, grant.id);
      assertSameDenied(
        () => service.createComputer(delegated, request(existingProfileId, grant.id, "principal_oracle_denied") as never),
        () => service.createComputer(delegated, request(missingProfileId, grant.id, "principal_oracle_denied") as never),
      );
      storage.database.query("UPDATE computer_create_grants SET active = 0 WHERE tenant_id = ? AND id = ?").run(admin.tenantId, grant.id);
      assertSameDenied(
        () => service.createComputer(delegated, request(existingProfileId, grant.id) as never),
        () => service.createComputer(delegated, request(missingProfileId, grant.id) as never),
      );
      storage.database.query("UPDATE computer_create_grants SET active = 1, generation = generation + 1 WHERE tenant_id = ? AND id = ?")
        .run(admin.tenantId, grant.id);
      assertSameDenied(
        () => service.createComputer(delegated, request(existingProfileId, grant.id) as never),
        () => service.createComputer(delegated, request(missingProfileId, grant.id) as never),
      );
      storage.database.query("UPDATE computer_create_grants SET generation = ?, principal_id = ? WHERE tenant_id = ? AND id = ?")
        .run(computer.policyGeneration, "principal_oracle_other", admin.tenantId, grant.id);
      assertSameDenied(
        () => service.createComputer(delegated, request(existingProfileId, grant.id) as never),
        () => service.createComputer(delegated, request(missingProfileId, grant.id) as never),
      );
      storage.database.query("UPDATE computer_create_grants SET principal_id = ? WHERE tenant_id = ? AND id = ?")
        .run(ownerBase.principalId, admin.tenantId, grant.id);
      assertSameDenied(
        () => service.createComputer(delegated, { ...request(existingProfileId, grant.id), storageGiB: 33, idempotencyKey: "oracle-cap-existing" } as never),
        () => service.createComputer(delegated, { ...request(missingProfileId, grant.id), storageGiB: 33, idempotencyKey: "oracle-cap-missing" } as never),
      );

      expect(captureComputersError(() => service.createComputer(delegated, request(missingProfileId, grant.id) as never))).toEqual({
        code: "invalid_request", message: "Computer profile is not available", status: 400,
      });
      expect(captureComputersError(() => service.createComputer(delegated, {
        ...request(existingProfileId, grant.id), provider: "local_machine", idempotencyKey: "oracle-provider-mismatch",
      } as never))).toEqual({ code: "invalid_request", message: "Computer profile provider does not match", status: 400 });
      const valid = request(existingProfileId, grant.id);
      const first = service.createComputer(delegated, valid as never);
      expect(service.createComputer(delegated, valid as never).id).toBe(first.id);
    } finally { storage.close(); }
  });

  test("audit failure rolls back security mutation and chain verification detects tampering", () => {
    const { storage, service, computer } = setup();
    try {
      storage.database.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT, 'audit sink failed'); END;");
      expect(() => service.createComputerGrant(admin, {
        principalId: ownerBase.principalId, ownerPrincipalId: ownerBase.principalId, parentComputerId: computer.id,
        allowedProviders: ["local_machine"], allowedChildOwnerPrincipalIds: ["principal_child"], allowedRegions: ["local"],
        allowedProfileIds: ["profile_default"], maxStorageGiB: 32, maxUptimeSeconds: 600, maxBudgetMicros: 1000, limit: 1,
      } as never)).toThrow("audit sink failed");
      expect((storage.database.query("SELECT COUNT(*) AS count FROM computer_create_grants").get() as { count: number }).count).toBe(0);
      storage.database.exec("DROP TRIGGER fail_audit");
      const verifier = storage as unknown as { verifyAuditChain: (tenantId: string, checkpoint?: unknown) => { valid: boolean; anchored: boolean } };
      expect(verifier.verifyAuditChain(admin.tenantId).valid).toBe(true);
      storage.database.exec("DROP TRIGGER audit_events_no_update");
      storage.database.query("UPDATE audit_events SET previous_hash = ? WHERE sequence = (SELECT MAX(sequence) FROM audit_events)").run(`sha256:${"f".repeat(64)}`);
      expect(verifier.verifyAuditChain(admin.tenantId).valid).toBe(false);
    } finally { storage.close(); }
  });

  test("policy-fence operation failure is atomic, audited once, and rolls back when audit append fails", async () => {
    const { storage, service, computer } = setup();
    try {
      const counts = (): { audit: number; outbox: number } => ({
        audit: Number((storage.database.query("SELECT COUNT(*) AS count FROM audit_events").get() as { count: number }).count),
        outbox: Number((storage.database.query("SELECT COUNT(*) AS count FROM outbox_events").get() as { count: number }).count),
      });
      service.createInstallPolicy(admin, computer.id, [{ effect: "deny" }]);
      const before = counts();
      const calls: string[] = [];
      const providers = createProviderPorts();
      providers.local_machine = outcomeProvider({ kind: "success", resource: { resourceId: "must_not_run" }, result: {} }, calls);
      const worker = new OperationWorker(storage, providers);
      expect(await worker.runTenant(admin.tenantId)).toBe(1);
      expect(calls).toEqual([]);
      expect(storage.listOperations(admin.tenantId, computer.id)[0]).toMatchObject({ status: "failed", errorCode: "policy_generation_mismatch" });
      expect(counts()).toEqual({ audit: before.audit + 1, outbox: before.outbox + 1 });
      expect((storage.database.query("SELECT action FROM audit_events ORDER BY sequence DESC LIMIT 1").get() as { action: string }).action).toBe("computer.create.failed");
      expect(await worker.runTenant(admin.tenantId)).toBe(0);
      expect(counts()).toEqual({ audit: before.audit + 1, outbox: before.outbox + 1 });

      const currentOwner = { ...ownerBase, boundComputerId: computer.id, policyGeneration: 2 };
      const operation = service.requestExec(currentOwner, computer.id, { argv: ["id"], idempotencyKey: "policy-fence-audit-rollback" });
      service.createInstallPolicy(admin, computer.id, [{ effect: "deny", managers: ["apt"] }]);
      const rollbackBefore = counts();
      storage.database.exec("CREATE TRIGGER fail_policy_fence_audit BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT, 'audit sink failed'); END;");
      await expect(worker.runTenant(admin.tenantId)).rejects.toThrow("audit sink failed");
      const rolledBack = storage.getOperation(admin.tenantId, operation.id);
      expect(rolledBack?.status).toBe("pending");
      expect(rolledBack?.errorCode).toBeUndefined();
      expect(counts()).toEqual(rollbackBefore);
    } finally { storage.close(); }
  });

  test("PostgreSQL migration is fail-closed and does not claim SQLite key parity", () => {
    const sql = readFileSync("migrations/postgres/0001_initial.sql", "utf8");
    expect(sql).toContain("FORCE ROW LEVEL SECURITY");
    expect(sql).toContain("NULLIF(current_setting('computers.tenant_id', true), '')");
    expect(sql).toContain("CHECK (status IN ('provisioning'");
    expect(sql).toContain("CHECK (kind IN ('create'");
    expect(sql).toContain("CHECK (status IN ('pending'");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS provider_bindings");
    expect(sql).toContain("prior_computer_status text CHECK");
    expect(sql).toContain("REVOKE ALL ON TABLE");
    expect(sql).toContain("NOBYPASSRLS");
    expect(sql).not.toContain("controller_keys");
    expect(sql).toContain("application role");
  });
});
