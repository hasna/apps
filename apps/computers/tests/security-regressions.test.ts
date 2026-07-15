import { afterEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import type { BearerPrincipal } from "../src/auth";
import type { AuthorizationContext, Computer, PackageSpec, ProviderOutcome, ResidentOperationEnvelope } from "../src/contracts";
import { StaticInstallTicketSigningKeyProvider } from "../src/install-policy";
import { ResidentProtocol } from "../src/resident";
import { createProviderPorts, type ProviderPort } from "../src/providers";
import * as serverModule from "../src/server";
import { ComputersService } from "../src/service";
import { SQLiteStorage, sha256 } from "../src/storage";
import { OperationWorker } from "../src/worker";
import { validateProviderConfinement } from "../src/validation";

const admin: AuthorizationContext = { tenantId: "tenant_secure", principalId: "principal_admin", scopes: ["computers:admin"], authMethod: "bearer" };
const owner: AuthorizationContext = { tenantId: "tenant_secure", principalId: "principal_owner", scopes: ["computers:read", "computers:create", "computers:exec", "computers:install"], authMethod: "bearer" };
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function spec(): PackageSpec {
  return { manager: "bun", name: "restart-safe", version: "1.0.0", digest: `sha256:${"c".repeat(64)}`, registry: "https://registry.example.invalid/", dependencyClosure: [], allowLifecycleScripts: false };
}

function setup(): { storage: SQLiteStorage; service: ComputersService; computer: Computer } {
  const storage = new SQLiteStorage(":memory:"); storage.migrate();
  const service = new ComputersService(storage, { ticketSigningKeyProvider: new StaticInstallTicketSigningKeyProvider(randomBytes(32)) });
  const computer = service.createComputer(admin, { slug: "secure", provider: "local_machine", ownerPrincipalId: owner.principalId, idempotencyKey: "secure-create-001" });
  return { storage, service, computer };
}

function ownerFor(computer: Computer): AuthorizationContext {
  return { ...owner, boundComputerId: computer.id, policyGeneration: computer.policyGeneration };
}

describe("security contract regressions", () => {
  test("resident envelope binds constant-time digest and capability to stored operation", async () => {
    const { storage, service, computer } = setup();
    try {
      const operation = service.requestExec(ownerFor(computer), computer.id, { argv: ["id"], idempotencyKey: "secure-exec-001" });
      const protocol = new ResidentProtocol(storage);
      storage.setResidentBinding({ tenantId: admin.tenantId, computerId: computer.id, provider: "local_machine", providerResourceId: "resource_secure", instanceId: "instance_secure", bootId: "boot_secure", generation: 1, updatedAt: new Date().toISOString() });
      const enrollment = await protocol.precreateEnrollment(admin.tenantId, computer.id);
      const identity = (await protocol.enroll({ token: enrollment.token, provider: "local_machine", instanceId: "instance_secure", bootId: "boot_secure" })).identity;
      const now = new Date();
      const base: ResidentOperationEnvelope = {
        operationId: operation.id, attemptId: "attempt_secure", tenantId: admin.tenantId, computerId: computer.id,
        certificateId: identity.certificateId, policyGeneration: computer.policyGeneration, fence: operation.fence, sequence: 0,
        nonce: randomBytes(24).toString("base64url"), issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 60_000).toISOString(),
        capability: "exec", payloadDigest: sha256(operation.request),
      };
      expect(() => protocol.validateOperation({ ...base, payloadDigest: `sha256:${"d".repeat(64)}` })).toThrow("Resident operation rejected");
      expect(() => protocol.validateOperation({ ...base, nonce: randomBytes(24).toString("base64url"), capability: "install" })).toThrow("Resident operation rejected");
      protocol.validateOperation({ ...base, nonce: randomBytes(24).toString("base64url") });
    } finally { storage.close(); }
  });

  test("creation limit comes only from a durable controller grant and cannot be raised by request", () => {
    const { storage, service, computer: parent } = setup();
    try {
      const grant = service.createComputerGrant(admin, {
        id: "grant_quota_one", principalId: owner.principalId, ownerPrincipalId: owner.principalId, parentComputerId: parent.id,
        allowedProviders: ["local_machine"], allowedChildOwnerPrincipalIds: ["principal_child_one", "principal_child_two", "principal_wrong_provider"],
        allowedRegions: ["local"], allowedProfileIds: ["profile_default"], maxStorageGiB: 32, maxUptimeSeconds: 3600, maxBudgetMicros: 0, limit: 1,
      });
      const childContext = ownerFor(parent);
      const resources = { region: "local", profileId: "profile_default", storageGiB: 32, uptimeSeconds: 3600, budgetMicros: 0 };
      expect(() => service.createComputer(childContext, { ...resources, slug: "no-grant", provider: "local_machine", ownerPrincipalId: "principal_no_grant", parentComputerId: parent.id, idempotencyKey: "no-grant-create" })).toThrow("Authorization denied");
      expect(() => service.createComputer(childContext, { ...resources, slug: "wrong-provider", provider: "local_vm", ownerPrincipalId: "principal_wrong_provider", parentComputerId: parent.id, grantId: grant.id, idempotencyKey: "wrong-provider-create" })).toThrow("Authorization denied");
      const first = service.createComputer(childContext, { ...resources, slug: "child-one", provider: "local_machine", ownerPrincipalId: "principal_child_one", parentComputerId: parent.id, grantId: grant.id, idempotencyKey: "grant-child-one" });
      expect(first.slug).toBe("child-one");
      expect(() => service.createComputer(childContext, {
        slug: "child-two", provider: "local_machine", ownerPrincipalId: "principal_child_two", parentComputerId: parent.id,
        ...resources, grantId: grant.id, idempotencyKey: "grant-child-two", quotaLimit: 999,
      } as never)).toThrow("Invalid quotaLimit");
      expect(() => service.createComputer(childContext, { ...resources, slug: "child-two", provider: "local_machine", ownerPrincipalId: "principal_child_two", parentComputerId: parent.id, grantId: grant.id, idempotencyKey: "grant-child-two" })).toThrow("Computer creation quota exceeded");
    } finally { storage.close(); }
  });

  test("database rejects contradictory provider and confinement pairs", () => {
    const storage = new SQLiteStorage(":memory:"); storage.migrate();
    try {
      const now = new Date().toISOString();
      expect(() => storage.database.query(`INSERT INTO computers (id, tenant_id, slug, provider, confinement_class, status, owner_principal_id, policy_generation, data_exfiltration_protection, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)`).run("cmp_invalid_local", admin.tenantId, "invalid-local", "local_machine", "strict_vm", "stopped", "principal_invalid", now, now)).toThrow();
      expect(() => storage.database.query(`INSERT INTO computers (id, tenant_id, slug, provider, confinement_class, status, owner_principal_id, policy_generation, data_exfiltration_protection, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)`).run("cmp_invalid_vm", admin.tenantId, "invalid-vm", "local_vm", "dedicated_machine", "stopped", "principal_invalid_vm", now, now)).toThrow();
      expect(() => validateProviderConfinement("local_machine", "strict_vm")).toThrow("Invalid confinementClass");
      expect(() => validateProviderConfinement("aws_ec2", "dedicated_machine")).toThrow("Invalid confinementClass");
      validateProviderConfinement("local_machine", "dedicated_machine");
      validateProviderConfinement("local_vm", "unverified_vm");
      const service = new ComputersService(storage, { ticketSigningKeyProvider: new StaticInstallTicketSigningKeyProvider(randomBytes(32)) });
      const valid = service.createComputer(admin, { slug: "constraint", provider: "local_machine", ownerPrincipalId: "principal_constraint", idempotencyKey: "constraint-create" });
      const insertOperation = (id: string, kind: string, status: string): void => {
        storage.database.query(`INSERT INTO operations
          (id, tenant_id, computer_id, kind, status, policy_generation, idempotency_key, request_json, fence, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 1, ?, '{}', 0, ?, ?)`)
          .run(id, admin.tenantId, valid.id, kind, status, `${id}-key`, now, now);
      };
      expect(() => insertOperation("opn_invalid_kind", "invented", "pending")).toThrow();
      expect(() => insertOperation("opn_invalid_status", "exec", "invented")).toThrow();
    } finally { storage.close(); }
  });

  test("persistent controller signing key validates an install ticket after restart", () => {
    const directory = mkdtempSync(join(process.cwd(), ".test-data-signing-")); temporaryDirectories.push(directory);
    const path = join(directory, "controller.db");
    let storage = new SQLiteStorage(path); storage.migrate();
    expect(statSync(path).mode & 0o777).toBe(0o600);
    let service = new ComputersService(storage);
    const computer = service.createComputer(admin, { slug: "restart", provider: "local_machine", ownerPrincipalId: owner.principalId, idempotencyKey: "restart-create-001" });
    service.createInstallPolicy(admin, computer.id, [{ effect: "allow", managers: ["bun"] }]);
    const ticket = service.installPlan(ownerFor(service.getComputer(admin, computer.id)), computer.id, spec()).ticket ?? "";
    storage.close();
    storage = new SQLiteStorage(path); storage.migrate(); service = new ComputersService(storage);
    try { expect(service.installApply(ownerFor(service.getComputer(admin, computer.id)), computer.id, ticket, "restart-apply-001").kind).toBe("install"); }
    finally { storage.close(); }
  });

  test("in-memory controller fails closed without explicit dev/test signing key", () => {
    const storage = new SQLiteStorage(":memory:"); storage.migrate();
    try { expect(() => new ComputersService(storage)).toThrow("Controller signing key configuration is required"); }
    finally { storage.close(); }
  });

  test("authentication configuration parser rejects malformed, duplicate, and unbounded principals", async () => {
    const parser = (serverModule as unknown as { parseBearerPrincipals(raw: string): BearerPrincipal[] }).parseBearerPrincipals;
    const valid = { tokenHash: "a".repeat(64), context: { tenantId: "tenant_secure", principalId: "principal_owner", scopes: ["computers:read"], authMethod: "bearer" } };
    expect(parser(JSON.stringify([valid]))).toHaveLength(1);
    for (const invalid of ["{}", JSON.stringify([]), JSON.stringify([{ ...valid, tokenHash: "invalid" }]), JSON.stringify([valid, valid]), JSON.stringify([{ ...valid, context: { ...valid.context, scopes: ["computers:read", "computers:read"] } }])]) {
      expect(() => parser(invalid)).toThrow("Invalid authentication configuration");
    }
    const tooMany = Array.from({ length: 129 }, (_, index) => ({
      tokenHash: index.toString(16).padStart(64, "0"),
      context: { ...valid.context, principalId: `principal_${String(index).padStart(3, "0")}` },
    }));
    expect(() => parser(JSON.stringify(tooMany))).toThrow("Invalid authentication configuration");
    expect(() => parser(JSON.stringify([{ ...valid, context: { ...valid.context, scopes: ["computers:unknown"] } }]))).toThrow("Invalid authentication configuration");
    expect(() => parser(JSON.stringify([{ ...valid, context: { ...valid.context, boundComputerId: "cmp_bound_without_generation" } }]))).toThrow("Invalid authentication configuration");
    expect(() => parser(JSON.stringify([{ ...valid, context: { ...valid.context, policyGeneration: 1 } }]))).toThrow("Invalid authentication configuration");
  });

  test("policy mutation fences provider and resident execution authorized under an older generation", async () => {
    const { storage, service, computer } = setup();
    try {
      const operation = service.requestExec(ownerFor(computer), computer.id, { argv: ["id"], idempotencyKey: "stale-policy-exec" });
      const protocol = new ResidentProtocol(storage);
      storage.setResidentBinding({ tenantId: admin.tenantId, computerId: computer.id, provider: "local_machine", providerResourceId: "resource_policy_fence", instanceId: "instance_policy_fence", bootId: "boot_policy_fence", generation: 1, updatedAt: new Date().toISOString() });
      const enrollment = await protocol.precreateEnrollment(admin.tenantId, computer.id);
      const identity = (await protocol.enroll({ token: enrollment.token, provider: "local_machine", instanceId: "instance_policy_fence", bootId: "boot_policy_fence" })).identity;
      const now = new Date();
      const staleEnvelope: ResidentOperationEnvelope = {
        operationId: operation.id, attemptId: "attempt_policy_fence", tenantId: admin.tenantId, computerId: computer.id,
        certificateId: identity.certificateId, policyGeneration: computer.policyGeneration, fence: operation.fence, sequence: 0,
        nonce: randomBytes(24).toString("base64url"), issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 60_000).toISOString(),
        capability: "exec", payloadDigest: sha256(operation.request),
      };
      service.createInstallPolicy(admin, computer.id, [{ effect: "deny" }]);
      expect(() => storage.assertOperationPolicyCurrent(admin.tenantId, operation.id)).toThrow("Policy generation changed");
      expect(storage.getOperation(admin.tenantId, operation.id)?.fence).toBe(1);
      expect(() => protocol.validateOperation(staleEnvelope)).toThrow("Resident operation rejected");
      let providerCalls = 0;
      const unavailable = async (): Promise<ProviderOutcome> => { providerCalls += 1; return { kind: "success", resource: { resourceId: "resource_unexpected" }, result: {} }; };
      const fake: ProviderPort = {
        kind: "local_machine", readiness: async () => ({ provider: "local_machine", configured: true, ready: true, confinementClass: "dedicated_machine", controls: {}, limitations: [] }),
        create: unavailable, start: unavailable, stop: unavailable, quarantine: unavailable, delete: unavailable, restore: unavailable, reconcile: unavailable,
      };
      const providers = createProviderPorts(); providers.local_machine = fake;
      await new OperationWorker(storage, providers).runTenant(admin.tenantId);
      expect(providerCalls).toBe(0);
      expect(storage.getOperation(admin.tenantId, operation.id)?.errorCode).toBe("policy_generation_mismatch");
    } finally { storage.close(); }
  });

  test("policy mutation racing a provider success preserves observed state and requires reconciliation", async () => {
    const { storage, service, computer } = setup();
    try {
      const initial = storage.listOperations(admin.tenantId, computer.id)[0];
      if (initial === undefined) throw new Error("missing create operation");
      const initialAttempt = storage.beginProviderAttempt(initial);
      storage.completeProviderOperation(initial, initialAttempt, { kind: "success", resource: { resourceId: "resource_policy_race" }, result: {} });
      storage.acquireHomeLease(admin.tenantId, computer.id, computer.ownerPrincipalId, "controller_policy_race", 60, 0);
      const start = service.requestLifecycle({ ...ownerFor(computer), scopes: [...owner.scopes, "computers:operate"] }, computer.id, "start", "policy-race-start");
      const success = async (): Promise<ProviderOutcome> => {
        service.createInstallPolicy(admin, computer.id, [{ effect: "deny" }]);
        return { kind: "success", resource: { resourceId: "resource_policy_race" }, result: { started: true } };
      };
      const unused = async (): Promise<ProviderOutcome> => ({ kind: "definite_failure", code: "unused", message: "unused" });
      const fake: ProviderPort = {
        kind: "local_machine", readiness: async () => ({ provider: "local_machine", configured: true, ready: true, confinementClass: "dedicated_machine", controls: {}, limitations: [] }),
        create: unused, start: success, stop: unused, quarantine: unused, delete: unused, restore: unused, reconcile: unused,
      };
      const providers = createProviderPorts(); providers.local_machine = fake;
      await new OperationWorker(storage, providers).runTenant(admin.tenantId);
      expect(storage.getComputer(admin.tenantId, computer.id)?.status).toBe("stopped");
      expect(storage.getOperation(admin.tenantId, start.id)?.status).toBe("unknown");
      expect(storage.getProviderBinding(admin.tenantId, computer.id)?.state).toBe("unknown");
    } finally { storage.close(); }
  });
});
