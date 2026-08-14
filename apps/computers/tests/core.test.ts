import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { ComputersError, type AuthorizationContext, type Computer, type PackageSpec, type ResidentOperationEnvelope } from "../src/contracts";
import { ResidentProtocol } from "../src/resident";
import { StaticInstallTicketSigningKeyProvider } from "../src/install-policy";
import { ComputersService } from "../src/service";
import { SQLiteStorage, sha256 } from "../src/storage";

const admin: AuthorizationContext = { tenantId: "tenant_test", principalId: "principal_admin", scopes: ["computers:admin"], authMethod: "loopback_dev" };
const owner: AuthorizationContext = { tenantId: "tenant_test", principalId: "principal_owner", scopes: ["computers:read", "computers:create", "computers:operate", "computers:exec", "computers:install"], authMethod: "bearer" };

function ownerFor(computer: Computer, context: AuthorizationContext = owner): AuthorizationContext {
  return { ...context, boundComputerId: computer.id, policyGeneration: computer.policyGeneration };
}

function packageSpec(name = "example-package"): PackageSpec {
  return { manager: "bun", name, version: "1.2.3", digest: `sha256:${"a".repeat(64)}`, registry: "https://registry.example.invalid/", dependencyClosure: [{ name: "dependency", version: "2.0.0", digest: `sha256:${"b".repeat(64)}` }], allowLifecycleScripts: false };
}

describe("Computers core", () => {
  let storage: SQLiteStorage;
  let service: ComputersService;

  beforeEach(() => { storage = new SQLiteStorage(":memory:"); storage.migrate(); service = new ComputersService(storage, { ticketSigningKeyProvider: new StaticInstallTicketSigningKeyProvider(randomBytes(32)) }); });
  afterEach(() => storage.close());

  function create(input: Partial<{ slug: string; provider: "local_machine" | "local_vm" | "aws_ec2"; ownerPrincipalId: string; idempotencyKey: string }> = {}): Computer {
    return service.createComputer(admin, { slug: input.slug ?? "primary", provider: input.provider ?? "local_machine", ownerPrincipalId: input.ownerPrincipalId ?? "principal_owner", idempotencyKey: input.idempotencyKey ?? "create-primary-001" });
  }

  test("migrates with foreign keys, WAL, and integrity enabled", () => {
    expect(storage.ready()).toBe(true);
    expect((storage.database.query("PRAGMA foreign_keys").get() as { foreign_keys: number }).foreign_keys).toBe(1);
    expect((storage.database.query("PRAGMA journal_mode").get() as { journal_mode: string }).journal_mode).toBe("memory");
    expect(storage.database.query("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 3 });
  });

  test("uses honest confinement classes and deterministic create idempotency", () => {
    const first = create();
    const replay = create();
    expect(replay.id).toBe(first.id);
    expect(first.confinementClass).toBe("dedicated_machine");
    const vmProfile = service.createProfile(admin, { id: "profile_core_vm", name: "Core VM", document: { provider: "local_vm", cpus: 2, memoryGiB: 4,
      rootDiskGiB: 16, homeDiskGiB: 32, imageLocation: "https://images.example.invalid/core.qcow2", imageDigest: `sha256:${"a".repeat(64)}` } });
    const virtual = service.createComputer(admin, { slug: "virtual", provider: "local_vm", ownerPrincipalId: "principal_other", profileId: vmProfile.id, idempotencyKey: "create-virtual-001" });
    expect(virtual.confinementClass).toBe("unverified_vm");
    expect(virtual.dataExfiltrationProtection).toBe(false);
    expect(() => service.createComputer(admin, { slug: "changed", provider: "local_machine", ownerPrincipalId: "principal_third", idempotencyKey: "create-primary-001" })).toThrow("different request");
  });

  test("enforces tenant, owner, bound Computer, scope, and generation through one engine", () => {
    const computer = create();
    const wrongTenant = { ...owner, tenantId: "tenant_other" };
    expect(() => service.getComputer(wrongTenant, computer.id)).toThrow(ComputersError);
    const wrongScope = { ...owner, scopes: ["computers:read"] as AuthorizationContext["scopes"] };
    expect(() => service.requestExec(wrongScope, computer.id, { argv: ["id"], idempotencyKey: "exec-scope-001" })).toThrow("Authorization denied");
    const wrongComputer = { ...owner, boundComputerId: "cmp_not_the_owner_computer" };
    let wrongComputerError: unknown;
    try { service.getComputer(wrongComputer, computer.id); } catch (error) { wrongComputerError = error; }
    expect(wrongComputerError).toBeInstanceOf(ComputersError);
    const captured = wrongComputerError as ComputersError;
    expect({ status: captured.status, code: captured.code, message: captured.message }).toEqual({ status: 404, code: "not_found", message: "Computer not found" });
    const stale = { ...owner, policyGeneration: 99 };
    expect(() => service.getComputer(stale, computer.id)).toThrow("Authorization denied");
  });

  test("stores typed argv only and rejects traversal and malformed input", () => {
    const computer = create();
    const operation = service.requestExec(ownerFor(computer), computer.id, { argv: ["printf", "%s", "safe"], cwd: "/home/agent", idempotencyKey: "exec-typed-001" });
    expect(operation.request.argv).toEqual(["printf", "%s", "safe"]);
    expect(() => service.requestExec(ownerFor(computer), computer.id, { argv: ["sh", "-c", "ok"], cwd: "/home/../host", idempotencyKey: "exec-path-001" })).toThrow("Invalid cwd");
    expect(() => service.createComputer(admin, { slug: "../bad", provider: "local_machine", ownerPrincipalId: "principal_bad", idempotencyKey: "create-invalid-001" })).toThrow("Invalid slug");
  });

  test("makes child quota reservations atomic and idempotent", async () => {
    const parent = create();
    const grant = service.createComputerGrant(admin, {
      principalId: owner.principalId, ownerPrincipalId: owner.principalId, parentComputerId: parent.id,
      allowedProviders: ["local_machine"], allowedChildOwnerPrincipalIds: Array.from({ length: 100 }, (_, index) => `principal_child${index}`),
      allowedRegions: ["local"], allowedProfileIds: ["profile_default"], maxStorageGiB: 32, maxUptimeSeconds: 3600, maxBudgetMicros: 0, limit: 1,
    });
    const childContext = ownerFor(parent);
    const distinct = Array.from({ length: 100 }, (_, index) => Promise.resolve().then(() => service.createComputer(childContext, {
      slug: `delegated-${index}`, provider: "local_machine", ownerPrincipalId: `principal_child${index}`, parentComputerId: parent.id,
      grantId: grant.id, region: "local", profileId: "profile_default", storageGiB: 32, uptimeSeconds: 3600, budgetMicros: 0,
      idempotencyKey: `delegated-create-${String(index).padStart(3, "0")}`,
    })).then((value) => ({ ok: true, value } as const), (error: unknown) => ({ ok: false, error } as const)));
    const delegatedResults = await Promise.all(distinct);
    expect(delegatedResults.filter((result) => result.ok)).toHaveLength(1);
    const reservation = storage.database.query("SELECT COUNT(*) AS count FROM child_reservations WHERE state = 'active'").get() as { count: number };
    expect(reservation.count).toBe(1);
    const secondParent = create({ slug: "parent-two", ownerPrincipalId: "principal_parent2", idempotencyKey: "create-parent-two" });
    const secondGrant = service.createComputerGrant(admin, {
      principalId: secondParent.ownerPrincipalId, ownerPrincipalId: secondParent.ownerPrincipalId, parentComputerId: secondParent.id,
      allowedProviders: ["local_machine"], allowedChildOwnerPrincipalIds: ["principal_dupchild"], allowedRegions: ["local"],
      allowedProfileIds: ["profile_default"], maxStorageGiB: 32, maxUptimeSeconds: 3600, maxBudgetMicros: 0, limit: 1,
    });
    const duplicateInput = { slug: "duplicate-child", provider: "local_machine" as const, ownerPrincipalId: "principal_dupchild", parentComputerId: secondParent.id, grantId: secondGrant.id, region: "local", profileId: "profile_default", storageGiB: 32, uptimeSeconds: 3600, budgetMicros: 0, idempotencyKey: "duplicate-child-create" };
    const secondContext = ownerFor(secondParent, { ...owner, principalId: secondParent.ownerPrincipalId });
    const duplicateResults = await Promise.all(Array.from({ length: 100 }, () => Promise.resolve().then(() => service.createComputer(secondContext, duplicateInput))));
    expect(new Set(duplicateResults.map((item) => item.id)).size).toBe(1);
    expect((storage.database.query("SELECT COUNT(*) AS count FROM child_reservations WHERE state = 'active'").get() as { count: number }).count).toBe(2);
  });

  test("fences durable home writers monotonically", () => {
    const computer = create();
    const first = storage.acquireHomeLease(admin.tenantId, computer.id, computer.ownerPrincipalId, "controller_one", 60, 0);
    expect(first.fence).toBe(1);
    expect(() => storage.acquireHomeLease(admin.tenantId, computer.id, "principal_wrong", "controller_two", 60, 1)).toThrow("Home lease denied");
    expect(() => storage.acquireHomeLease(admin.tenantId, computer.id, computer.ownerPrincipalId, "controller_two", 60, 0)).toThrow("Stale home lease fence");
    const renewed = storage.acquireHomeLease(admin.tenantId, computer.id, computer.ownerPrincipalId, "controller_one", 60, 1);
    expect(renewed.fence).toBe(2);
    expect(() => storage.assertHomeFence(admin.tenantId, computer.id, "controller_one", 1)).toThrow("Stale home lease fence");
    storage.assertHomeFence(admin.tenantId, computer.id, "controller_one", 2);
  });

  test("evaluates deny-overrides policy and rejects ticket tamper, cross-Computer use, and replay", () => {
    let computer = create();
    service.createInstallPolicy(admin, computer.id, [
      { effect: "allow", managers: ["bun"], packagePatterns: ["example-*"] },
      { effect: "deny", packagePatterns: ["example-blocked"] },
    ]);
    computer = service.getComputer(admin, computer.id);
    expect(computer.policyGeneration).toBe(2);
    const currentOwner = ownerFor(computer);
    expect(service.installPlan(currentOwner, computer.id, packageSpec("example-blocked")).decision).toBe("deny");
    const plan = service.installPlan(currentOwner, computer.id, packageSpec());
    expect(plan.decision).toBe("allow");
    expect(plan.ticket).toBeString();
    expect(() => service.installPlan(currentOwner, computer.id, { ...packageSpec(), name: "../unsafe" })).toThrow("Invalid spec.name");
    const second = create({ slug: "secondary", ownerPrincipalId: "principal_other", idempotencyKey: "create-secondary-001" });
    expect(() => service.installApply(admin, second.id, plan.ticket ?? "", "install-cross-001")).toThrow("Install ticket rejected");
    const ticket = plan.ticket ?? "";
    const tampered = `${ticket[0] === "A" ? "B" : "A"}${ticket.slice(1)}`;
    expect(() => service.installApply(currentOwner, computer.id, tampered, "install-tamper-001")).toThrow("Install ticket rejected");
    const operation = service.installApply(currentOwner, computer.id, ticket, "install-valid-001");
    expect(operation.kind).toBe("install");
    expect(() => service.installApply(currentOwner, computer.id, ticket, "install-replay-001")).toThrow("Install ticket rejected");
  });

  test("binds enrollment to controller-selected provider/instance and rejects replayed operations", async () => {
    const computer = create();
    const protocol = new ResidentProtocol(storage);
    storage.setResidentBinding({ tenantId: admin.tenantId, computerId: computer.id, provider: "local_machine", providerResourceId: "resource_primary", instanceId: "instance_primary", bootId: "boot_primary", generation: 1, updatedAt: new Date().toISOString() });
    const secret = await protocol.precreateEnrollment(admin.tenantId, computer.id);
    await expect(protocol.enroll({ token: secret.token, provider: "local_vm", instanceId: "instance_primary", bootId: "boot_primary" })).rejects.toThrow("Enrollment denied");
    const result = await protocol.enroll({ token: secret.token, provider: "local_machine", instanceId: "instance_primary", bootId: "boot_primary" });
    await expect(protocol.enroll({ token: secret.token, provider: "local_machine", instanceId: "instance_primary", bootId: "boot_primary" })).rejects.toThrow("Enrollment denied");
    const expired = await protocol.precreateEnrollment(admin.tenantId, computer.id);
    storage.database.query("UPDATE resident_enrollments SET expires_at = ? WHERE id = ?").run(new Date(0).toISOString(), expired.enrollment.id);
    await expect(protocol.enroll({ token: expired.token, provider: "local_machine", instanceId: "instance_primary", bootId: "boot_primary" })).rejects.toThrow("Enrollment denied");
    const operation = service.requestExec(ownerFor(computer), computer.id, { argv: ["id"], idempotencyKey: "exec-resident-001" });
    storage.updateComputerStatus(admin.tenantId, computer.id, "running");
    const attempt = storage.beginProviderAttempt(operation);
    const now = new Date();
    const envelope: ResidentOperationEnvelope = {
      operationId: operation.id, attemptId: attempt.id, tenantId: admin.tenantId, computerId: computer.id,
      certificateId: result.identity.certificateId, policyGeneration: computer.policyGeneration, fence: 0, sequence: 0,
      nonce: randomBytes(24).toString("base64url"), issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 60_000).toISOString(),
      capability: "exec", payloadDigest: sha256(operation.request),
    };
    protocol.validateOperation(envelope);
    expect(() => protocol.validateOperation(envelope)).toThrow("Resident operation rejected");
    const fence = storage.advanceOperationFence(admin.tenantId, operation.id, 0);
    expect(fence).toBe(1);
    expect(() => protocol.validateOperation({ ...envelope, nonce: randomBytes(24).toString("base64url"), sequence: 1 })).toThrow("Resident operation rejected");
    expect(() => protocol.validateOperation({ ...envelope, nonce: randomBytes(24).toString("base64url"), computerId: "cmp_wrong_computer" })).toThrow("Resident authentication failed");
    storage.revokeResidentIdentity(result.identity.certificateId, new Date().toISOString());
    expect(() => protocol.validateOperation({ ...envelope, fence: 1, sequence: 1, nonce: randomBytes(24).toString("base64url") })).toThrow("Resident authentication failed");
  });

  test("keeps audit append-only and Sandboxes disabled", () => {
    create();
    expect(() => storage.database.query("DELETE FROM audit_events").run()).toThrow("append-only");
    expect(() => service.sandboxDisabled()).toThrow("Sandbox integration is disabled");
  });

  test("reports all provider adapters as unconfigured without strict claims", async () => {
    const readiness = await service.providerReadiness(admin);
    expect(readiness.every((item) => !item.ready && !item.configured)).toBe(true);
    expect(readiness.find((item) => item.provider === "local_machine")?.confinementClass).toBe("dedicated_machine");
    expect(readiness.filter((item) => item.provider !== "local_machine").every((item) => item.confinementClass === "unverified_vm")).toBe(true);
  });
});
