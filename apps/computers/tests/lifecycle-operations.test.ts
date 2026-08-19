// agent-authored: SOL consult refused (capacity wall, exact error: "Selected model is at capacity. Please try a different model.");
// no SOL spec received. Test specs authored from direct source analysis of untested surfaces.
import { describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import type { AuthorizationContext, HomeLeaseCapability } from "../src/contracts";
import { StaticInstallTicketSigningKeyProvider } from "../src/install-policy";
import { ComputersService } from "../src/service";
import { SQLiteStorage } from "../src/storage";

function setup() {
  const storage = new SQLiteStorage(":memory:"); storage.migrate();
  const service = new ComputersService(storage, { ticketSigningKeyProvider: new StaticInstallTicketSigningKeyProvider(randomBytes(32)) });
  const admin: AuthorizationContext = { tenantId: "tenant_lifecycle", principalId: "principal_admin", scopes: ["computers:admin"], authMethod: "bearer" };
  const computer = service.createComputer(admin, { slug: "lifecycle", provider: "local_machine", ownerPrincipalId: "principal_owner", idempotencyKey: "lifecycle-create" });
  const owner: AuthorizationContext = { tenantId: admin.tenantId, principalId: "principal_owner", scopes: ["computers:operate", "computers:exec", "computers:policy"], boundComputerId: computer.id, policyGeneration: 1, authMethod: "bearer" };
  const create = storage.listOperations(admin.tenantId, computer.id)[0];
  if (create === undefined) throw new Error("Missing create operation");
  storage.completeProviderOperation(create, storage.beginProviderAttempt(create), {
    kind: "success", resource: { resourceId: "resource_lifecycle" }, result: { lifecycle: "stopped" },
  });
  return { storage, service, admin, owner, computer };
}

describe("lifecycle operations and policy fencing", () => {
  test("start requires a current home lease capability and binds it to the operation", () => {
    const { storage, service, owner, computer } = setup();
    storage.updateComputerStatus(owner.tenantId, computer.id, "stopped");
    expect(() => service.requestLifecycle(owner, computer.id, "start", "lifecycle-start-no-lease")).toThrow("Start requires a current home lease capability");
    storage.acquireHomeLease(owner.tenantId, computer.id, owner.principalId, "holder_one", 300);
    const operation = service.requestLifecycle(owner, computer.id, "start", "lifecycle-start-lease");
    expect(operation.kind).toBe("start");
    expect(operation.status).toBe("admitted");
    const capability = storage.getOperationHomeLease(owner.tenantId, operation.id);
    expect(capability?.homeId).toBe(`home:${computer.id}`);
    expect(capability?.holderId).toBe("holder_one");
    expect(capability?.fence).toBe(1);
  });

  test("a lifecycle operation whose status transition is not allowed conflicts", () => {
    const { storage, service, admin, owner, computer } = setup();
    storage.updateComputerStatus(owner.tenantId, computer.id, "stopped");
    expect(() => service.requestLifecycle(owner, computer.id, "stop", "lifecycle-stop-from-stopped")).toThrow("Computer cannot stop from stopped");
    storage.updateComputerStatus(owner.tenantId, computer.id, "running");
    expect(() => service.requestLifecycle(admin, computer.id, "delete", "lifecycle-delete-from-running")).toThrow("Computer cannot delete from running");
    const quarantine = service.requestLifecycle(owner, computer.id, "quarantine", "lifecycle-quarantine-running");
    expect(quarantine.kind).toBe("quarantine");
  });

  test("an active lifecycle operation blocks a second one with a different key", () => {
    const { storage, service, owner, computer } = setup();
    storage.updateComputerStatus(owner.tenantId, computer.id, "stopped");
    storage.acquireHomeLease(owner.tenantId, computer.id, owner.principalId, "holder_one", 300);
    service.requestLifecycle(owner, computer.id, "start", "lifecycle-active-one");
    expect(() => service.requestLifecycle(owner, computer.id, "start", "lifecycle-active-two")).toThrow("Computer already has an active lifecycle operation");
  });

  test("an idempotent lifecycle retry returns the same operation", () => {
    const { storage, service, owner, computer } = setup();
    storage.updateComputerStatus(owner.tenantId, computer.id, "stopped");
    storage.acquireHomeLease(owner.tenantId, computer.id, owner.principalId, "holder_one", 300);
    const first = service.requestLifecycle(owner, computer.id, "start", "lifecycle-idempotent-key");
    const second = service.requestLifecycle(owner, computer.id, "start", "lifecycle-idempotent-key");
    expect(second.id).toBe(first.id);
    const count = storage.database.query("SELECT COUNT(*) AS count FROM operations WHERE kind = 'start'").get() as { count: number };
    expect(count.count).toBe(1);
  });

  test("failOperationPolicyFence fails a stale operation, fences its attempt, and is idempotent", () => {
    const { storage, service, owner, computer } = setup();
    const operation = service.requestExec(owner, computer.id, { argv: ["id"], idempotencyKey: "lifecycle-fence-exec" });
    const attempt = storage.beginProviderAttempt(operation);
    expect(attempt.status).toBe("running");
    service.createInstallPolicy(owner, computer.id, [{ effect: "deny", managers: ["bun"] }]);
    const fenced = storage.failOperationPolicyFence(owner.tenantId, operation.id);
    expect(fenced.status).toBe("failed");
    expect(fenced.errorCode).toBe("policy_generation_mismatch");
    const attemptRow = storage.database.query("SELECT status FROM operation_attempts WHERE operation_id = ?").get(operation.id) as { status: string };
    expect(attemptRow.status).toBe("failed");
    const second = storage.failOperationPolicyFence(owner.tenantId, operation.id);
    expect(second.id).toBe(operation.id);
    expect(second.errorCode).toBe("policy_generation_mismatch");
  });

  test("failOperationPolicyFence refuses a current-generation operation", () => {
    const { storage, service, owner, computer } = setup();
    const operation = service.requestExec(owner, computer.id, { argv: ["id"], idempotencyKey: "lifecycle-fence-current" });
    expect(() => storage.failOperationPolicyFence(owner.tenantId, operation.id)).toThrow("Operation policy generation is current");
    const attempt = storage.beginProviderAttempt(operation);
    expect(attempt.status).toBe("running");
    expect(() => storage.failOperationPolicyFence(owner.tenantId, operation.id)).toThrow("Operation policy generation is current");
  });

  test("releaseChildReservation releases only reserved or active child rows", () => {
    const { storage, service, admin, owner, computer } = setup();
    const other = service.createComputer(admin, { slug: "lifecycle-other", provider: "local_machine", ownerPrincipalId: "principal_other", idempotencyKey: "lifecycle-other-create" });
    const otherCreate = storage.listOperations(admin.tenantId, other.id)[0];
    if (otherCreate === undefined) throw new Error("Missing second create operation");
    storage.completeProviderOperation(otherCreate, storage.beginProviderAttempt(otherCreate), {
      kind: "success", resource: { resourceId: "resource_lifecycle_other" }, result: { lifecycle: "stopped" },
    });
    const grant = service.createComputerGrant(admin, {
      principalId: owner.principalId, ownerPrincipalId: owner.principalId, parentComputerId: computer.id,
      allowedProviders: ["local_machine"], allowedChildOwnerPrincipalIds: ["principal_other"],
      allowedRegions: ["local"], allowedProfileIds: ["profile_default"], maxStorageGiB: 32, maxUptimeSeconds: 600,
      maxBudgetMicros: 1000, limit: 2,
    });
    const base = { tenantId: owner.tenantId, parentComputerId: computer.id, grantId: grant.id, idempotencyKey: "lifecycle-child-reservation" };
    storage.database.query(`INSERT INTO child_reservations (id, tenant_id, parent_computer_id, grant_id, child_computer_id, idempotency_key, state, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`)
      .run("res_lifecycle_active", base.tenantId, base.parentComputerId, base.grantId, other.id, base.idempotencyKey, new Date().toISOString(), new Date().toISOString());
    storage.database.query(`INSERT INTO child_reservations (id, tenant_id, parent_computer_id, grant_id, child_computer_id, idempotency_key, state, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'released', ?, ?)`)
      .run("res_lifecycle_released", base.tenantId, base.parentComputerId, base.grantId, computer.id, "lifecycle-child-reservation-released", new Date().toISOString(), new Date().toISOString());
    storage.releaseChildReservation(owner.tenantId, other.id);
    const states = storage.database.query("SELECT child_computer_id, state FROM child_reservations WHERE tenant_id = ? ORDER BY id").all(owner.tenantId) as Array<{ child_computer_id: string; state: string }>;
    expect(states.find((row) => row.child_computer_id === other.id)?.state).toBe("released");
    expect(states.find((row) => row.child_computer_id === computer.id)?.state).toBe("released");
  });

  test("home lease capability asserts the fence and expiry at binding time", () => {
    const { storage, service, owner, computer } = setup();
    storage.updateComputerStatus(owner.tenantId, computer.id, "stopped");
    const lease = storage.acquireHomeLease(owner.tenantId, computer.id, owner.principalId, "holder_fence", 300);
    const stale: HomeLeaseCapability = { tenantId: owner.tenantId, computerId: computer.id, homeId: `home:${computer.id}`, holderId: "holder_fence", fence: lease.fence + 1, expiresAt: lease.expiresAt };
    expect(() => storage.setOperationHomeLease("operation_does_not_exist", stale)).toThrow("Stale home lease fence");
    const expired: HomeLeaseCapability = { ...stale, fence: lease.fence, expiresAt: new Date(0).toISOString() };
    expect(() => storage.setOperationHomeLease("operation_does_not_exist", expired)).toThrow("Stale home lease capability");
    const operation = service.requestExec(owner, computer.id, { argv: ["id"], idempotencyKey: "lifecycle-capability-exec" });
    const current: HomeLeaseCapability = { tenantId: owner.tenantId, computerId: computer.id, homeId: `home:${computer.id}`, holderId: "holder_fence", fence: lease.fence, expiresAt: lease.expiresAt };
    storage.setOperationHomeLease(operation.id, current);
    expect(storage.getOperationHomeLease(owner.tenantId, operation.id)?.fence).toBe(lease.fence);
  });
});
