import { describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import type { AuthorizationContext, ResidentOperationEnvelope } from "../src/contracts";
import { StaticInstallTicketSigningKeyProvider } from "../src/install-policy";
import { ResidentProtocol } from "../src/resident";
import { ComputersService } from "../src/service";
import { SQLiteStorage, sha256 } from "../src/storage";

const admin: AuthorizationContext = { tenantId: "tenant_binding", principalId: "principal_admin", scopes: ["computers:admin"], authMethod: "bearer" };

describe("authoritative resident binding", () => {
  test("enrollment matches provider resource, instance, boot, generation and replaces old identity", async () => {
    const storage = new SQLiteStorage(":memory:"); storage.migrate();
    const service = new ComputersService(storage, { ticketSigningKeyProvider: new StaticInstallTicketSigningKeyProvider(randomBytes(32)) });
    const computer = service.createComputer(admin, { slug: "binding", provider: "local_machine", ownerPrincipalId: "principal_owner", idempotencyKey: "binding-create-001" });
    const bindingApi = storage as unknown as { setResidentBinding: (binding: Record<string, unknown>) => unknown };
    bindingApi.setResidentBinding({ tenantId: admin.tenantId, computerId: computer.id, provider: "local_machine", providerResourceId: "resource_one", instanceId: "instance_one", bootId: "boot_one", generation: 1 });
    const protocol = new ResidentProtocol(storage);
    try {
      const wrong = await protocol.precreateEnrollment(admin.tenantId, computer.id, 300 as never);
      await expect(protocol.enroll({ token: wrong.token, provider: "local_vm", instanceId: "instance_one", bootId: "boot_one" })).rejects.toThrow("Enrollment denied");
      await expect(protocol.enroll({ token: wrong.token, provider: "local_machine", instanceId: "instance_wrong", bootId: "boot_one" })).rejects.toThrow("Enrollment denied");
      await expect(protocol.enroll({ token: wrong.token, provider: "local_machine", instanceId: "instance_one", bootId: "wrong_boot" })).rejects.toThrow("Enrollment denied");
      const firstSecret = await protocol.precreateEnrollment(admin.tenantId, computer.id, 300 as never);
      const secondSecret = await protocol.precreateEnrollment(admin.tenantId, computer.id, 300 as never);
      const [firstResult, secondResult] = await Promise.all([
        protocol.enroll({ token: firstSecret.token, provider: "local_machine", instanceId: "instance_one", bootId: "boot_one" }),
        protocol.enroll({ token: secondSecret.token, provider: "local_machine", instanceId: "instance_one", bootId: "boot_one" }),
      ]);
      const first = firstResult.identity; const second = secondResult.identity;
      const identities = [first, second].map((identity) => storage.getResidentIdentity(identity.certificateId));
      expect(identities.filter((identity) => identity?.revokedAt === undefined)).toHaveLength(1);
      expect(identities.filter((identity) => identity?.revokedAt !== undefined)).toHaveLength(1);
      const revoked = identities.find((identity) => identity?.revokedAt !== undefined);
      const active = identities.find((identity) => identity?.revokedAt === undefined);
      if (revoked === undefined || active === undefined) throw new Error("resident replacement state is inconsistent");
      const owner: AuthorizationContext = { tenantId: admin.tenantId, principalId: "principal_owner", scopes: ["computers:exec"], boundComputerId: computer.id, policyGeneration: 1, authMethod: "bearer" };
      const operation = service.requestExec(owner, computer.id, { argv: ["id"], idempotencyKey: "binding-exec-001" });
      const now = new Date();
      const envelope: ResidentOperationEnvelope = {
        operationId: operation.id, attemptId: "attempt_binding", tenantId: admin.tenantId, computerId: computer.id,
        certificateId: revoked.certificateId, policyGeneration: 1, fence: 0, sequence: 0, nonce: randomBytes(24).toString("base64url"),
        issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 60_000).toISOString(), capability: "exec", payloadDigest: sha256(operation.request),
      };
      expect(() => protocol.validateOperation(envelope)).toThrow("Resident authentication failed");
      storage.database.query("UPDATE resident_identities SET expires_at = ? WHERE certificate_id = ?").run(new Date(0).toISOString(), active.certificateId);
      expect(() => protocol.validateOperation({ ...envelope, certificateId: active.certificateId, nonce: randomBytes(24).toString("base64url") })).toThrow("Resident authentication failed");
    } finally { storage.close(); }
  });

  test("binding generation changes revoke active identities and reject stale enrollment", async () => {
    const storage = new SQLiteStorage(":memory:"); storage.migrate();
    const service = new ComputersService(storage, { ticketSigningKeyProvider: new StaticInstallTicketSigningKeyProvider(randomBytes(32)) });
    const computer = service.createComputer(admin, { slug: "binding-race", provider: "local_machine", ownerPrincipalId: "principal_owner_two", idempotencyKey: "binding-race-create" });
    const bindingApi = storage as unknown as { setResidentBinding: (binding: Record<string, unknown>) => unknown };
    bindingApi.setResidentBinding({ tenantId: admin.tenantId, computerId: computer.id, provider: "local_machine", providerResourceId: "resource_one", instanceId: "instance_one", bootId: "boot_one", generation: 1 });
    const protocol = new ResidentProtocol(storage);
    try {
      const stale = await protocol.precreateEnrollment(admin.tenantId, computer.id, 300 as never);
      bindingApi.setResidentBinding({ tenantId: admin.tenantId, computerId: computer.id, provider: "local_machine", providerResourceId: "resource_two", instanceId: "instance_two", bootId: "boot_two", generation: 2 });
      await expect(protocol.enroll({ token: stale.token, provider: "local_machine", instanceId: "instance_one", bootId: "boot_one" })).rejects.toThrow("Enrollment denied");
    } finally { storage.close(); }
  });
});
