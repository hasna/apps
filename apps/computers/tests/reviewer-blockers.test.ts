import { afterEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { AuthorizationContext, Computer, ProviderOutcome } from "../src/contracts";
import { StaticInstallTicketSigningKeyProvider } from "../src/install-policy";
import { createProviderPorts, type ProviderPort } from "../src/providers";
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
  providers.local_machine = outcomeProvider({ kind: "success", resource: { resourceId: `resource_${computer.id}` }, result: {} });
  await new OperationWorker(storage, providers).runTenant(computer.tenantId);
}

describe("reviewer lifecycle and atomicity blockers", () => {
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
        const providers = createProviderPorts(); providers.local_machine = outcomeProvider({ kind: "success", resource: { resourceId: `resource_${computer.id}` }, result: { kind } });
        await new OperationWorker(storage, providers).runTenant(admin.tenantId);
        expect(storage.getComputer(admin.tenantId, computer.id)?.status).toBe(expected);
        expect(storage.getProviderBinding(admin.tenantId, computer.id)?.state).toBe(kind === "delete" ? "released" : "active");
      }
      expect(() => service.requestLifecycle(owner, computer.id, "start", "invalid-start-after-delete")).toThrow("cannot start from deleted");
    } finally { storage.close(); }
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
        reconciles += 1; return { kind: "success", resource: { resourceId: "resource_child" }, result: { adopted: true } };
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
      storage.beginProviderAttempt(createOperation);
      let crashCreates = 0; let crashReconciles = 0;
      provider.create = async () => { crashCreates += 1; return { kind: "success", resource: { resourceId: "duplicate_resource" }, result: {} }; };
      provider.reconcile = async () => { crashReconciles += 1; return { kind: "success", resource: { resourceId: "resource_after_cleanup" }, result: { adopted: true } }; };
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
      storage.completeProviderOperation(createOperation, storage.beginProviderAttempt(createOperation), { kind: "success", resource: { resourceId: "resource_idempotent" }, result: {} });
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
