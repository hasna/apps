// agent-authored: SOL consult refused (capacity wall, exact error: "Selected model is at capacity. Please try a different model.");
// no SOL spec received. Test specs authored from direct source analysis of untested surfaces.
import { describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import type { AuthorizationContext, ResidentOperationEnvelope } from "../src/contracts";
import { StaticInstallTicketSigningKeyProvider } from "../src/install-policy";
import { ResidentProtocol } from "../src/resident";
import { ComputersService } from "../src/service";
import { SQLiteStorage, sha256 } from "../src/storage";

const admin: AuthorizationContext = { tenantId: "tenant_resident_replay", principalId: "principal_admin", scopes: ["computers:admin"], authMethod: "bearer" };

interface ResidencyFixture {
  storage: SQLiteStorage;
  service: ComputersService;
  protocol: ResidentProtocol;
  computerId: string;
  operationId: string;
  envelope: Omit<ResidentOperationEnvelope, "sequence" | "nonce">;
}

async function residencyFixture(): Promise<ResidencyFixture> {
  const storage = new SQLiteStorage(":memory:"); storage.migrate();
  const service = new ComputersService(storage, { ticketSigningKeyProvider: new StaticInstallTicketSigningKeyProvider(randomBytes(32)) });
  const computer = service.createComputer(admin, { slug: "resident-replay", provider: "local_machine", ownerPrincipalId: "principal_owner", idempotencyKey: "resident-replay-create" });
  const create = storage.listOperations(admin.tenantId, computer.id)[0];
  if (create === undefined) throw new Error("Missing create operation");
  storage.completeProviderOperation(create, storage.beginProviderAttempt(create), {
    kind: "success", resource: { resourceId: "resource_resident_replay" }, result: { lifecycle: "stopped" },
  });
  const bindingApi = storage as unknown as { setResidentBinding: (binding: Record<string, unknown>) => unknown };
  bindingApi.setResidentBinding({ tenantId: admin.tenantId, computerId: computer.id, provider: "local_machine", providerResourceId: "resource_replay", instanceId: "instance_replay", bootId: "boot_replay", generation: 1 });
  const owner: AuthorizationContext = { tenantId: admin.tenantId, principalId: "principal_owner", scopes: ["computers:exec"], boundComputerId: computer.id, policyGeneration: 1, authMethod: "bearer" };
  const protocol = new ResidentProtocol(storage);
  const enrollment = await protocol.precreateEnrollment(admin.tenantId, computer.id, 300);
  const identity = (await protocol.enroll({ token: enrollment.token, provider: "local_machine", instanceId: "instance_replay", bootId: "boot_replay" })).identity;
  storage.updateComputerStatus(admin.tenantId, computer.id, "running");
  const operation = service.requestExec(owner, computer.id, { argv: ["id"], idempotencyKey: "resident-replay-exec" });
  const attempt = storage.beginProviderAttempt(operation);
  const now = new Date();
  const envelope: Omit<ResidentOperationEnvelope, "sequence" | "nonce"> = {
    operationId: operation.id, attemptId: attempt.id, tenantId: admin.tenantId, computerId: computer.id,
    certificateId: identity.certificateId, policyGeneration: 1, fence: 0, capability: "exec",
    payloadDigest: sha256(operation.request), issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 60_000).toISOString(),
  };
  return { storage, service, protocol, computerId: computer.id, operationId: operation.id, envelope };
}

describe("resident enrollment and operation replay protection", () => {
  test("an expired enrollment token is refused as expired, not consumed", async () => {
    const { storage, protocol } = await residencyFixture();
    const enrollment = await protocol.precreateEnrollment(admin.tenantId, enrollmentComputer(storage), 300);
    storage.database.query("UPDATE resident_enrollments SET expires_at = ? WHERE id = ?").run(new Date(0).toISOString(), enrollment.enrollment.id);
    let code = "";
    try { await protocol.enroll({ token: enrollment.token, provider: "local_machine", instanceId: "instance_replay", bootId: "boot_replay" }); }
    catch (error) { code = (error as { code?: string }).code ?? ""; }
    expect(code).toBe("expired");
    const row = storage.database.query("SELECT used_at, revoked_at FROM resident_enrollments WHERE id = ?").get(enrollment.enrollment.id) as { used_at: string | null; revoked_at: string | null };
    expect(row.used_at).toBeNull();
    expect(row.revoked_at).toBeNull();
  });

  test("a consumed enrollment token is refused as replay on a second use", async () => {
    const { storage, protocol } = await residencyFixture();
    const enrollment = await protocol.precreateEnrollment(admin.tenantId, enrollmentComputer(storage), 300);
    await protocol.enroll({ token: enrollment.token, provider: "local_machine", instanceId: "instance_replay", bootId: "boot_replay" });
    let code = "";
    try { await protocol.enroll({ token: enrollment.token, provider: "local_machine", instanceId: "instance_replay", bootId: "boot_replay" }); }
    catch (error) { code = (error as { code?: string }).code ?? ""; }
    expect(code).toBe("replay_detected");
    const row = storage.database.query("SELECT used_at FROM resident_enrollments WHERE id = ?").get(enrollment.enrollment.id) as { used_at: string | null };
    expect(row.used_at).not.toBeNull();
  });

  test("envelope sequences must be strictly consecutive per operation attempt", async () => {
    const { protocol, envelope } = await residencyFixture();
    const first: ResidentOperationEnvelope = { ...envelope, sequence: 0, nonce: randomBytes(24).toString("base64url") };
    expect(() => protocol.validateOperation(first)).not.toThrow();
    const second: ResidentOperationEnvelope = { ...envelope, sequence: 1, nonce: randomBytes(24).toString("base64url") };
    expect(() => protocol.validateOperation(second)).not.toThrow();
    const replayed: ResidentOperationEnvelope = { ...envelope, sequence: 1, nonce: randomBytes(24).toString("base64url") };
    let replayCode = "";
    try { protocol.validateOperation(replayed); } catch (error) { replayCode = (error as { code?: string }).code ?? ""; }
    expect(replayCode).toBe("replay_detected");
    const skipped: ResidentOperationEnvelope = { ...envelope, sequence: 3, nonce: randomBytes(24).toString("base64url") };
    let skipCode = "";
    try { protocol.validateOperation(skipped); } catch (error) { skipCode = (error as { code?: string }).code ?? ""; }
    expect(skipCode).toBe("replay_detected");
    const third: ResidentOperationEnvelope = { ...envelope, sequence: 2, nonce: randomBytes(24).toString("base64url") };
    expect(() => protocol.validateOperation(third)).not.toThrow();
  });

  test("a stale operation fence rejects the envelope", async () => {
    const { storage, protocol, envelope, operationId } = await residencyFixture();
    expect(() => protocol.validateOperation({ ...envelope, sequence: 0, nonce: randomBytes(24).toString("base64url") })).not.toThrow();
    storage.database.query("UPDATE operations SET fence = fence + 1 WHERE id = ?").run(operationId);
    let code = "";
    try { protocol.validateOperation({ ...envelope, sequence: 1, nonce: randomBytes(24).toString("base64url") }); }
    catch (error) { code = (error as { code?: string }).code ?? ""; }
    expect(code).toBe("stale_fence");
  });

  test("a payload digest mismatch rejects the envelope", async () => {
    const { protocol, envelope } = await residencyFixture();
    let code = "";
    try {
      protocol.validateOperation({ ...envelope, sequence: 0, nonce: randomBytes(24).toString("base64url"), payloadDigest: `sha256:${"0".repeat(64)}` });
    } catch (error) { code = (error as { code?: string }).code ?? ""; }
    expect(code).toBe("authorization_denied");
  });

  test("an expired envelope is rejected", async () => {
    const { protocol, envelope } = await residencyFixture();
    let code = "";
    try {
      protocol.validateOperation({ ...envelope, sequence: 0, nonce: randomBytes(24).toString("base64url"), expiresAt: new Date(0).toISOString() });
    } catch (error) { code = (error as { code?: string }).code ?? ""; }
    expect(code).toBe("expired");
  });

  test("a capability that does not match the operation kind is rejected", async () => {
    const { protocol, envelope } = await residencyFixture();
    let code = "";
    try {
      protocol.validateOperation({ ...envelope, sequence: 0, nonce: randomBytes(24).toString("base64url"), capability: "install" });
    } catch (error) { code = (error as { code?: string }).code ?? ""; }
    expect(code).toBe("authorization_denied");
  });

  test("a policy generation change revokes resident authority for new envelopes", async () => {
    const { storage, service, protocol, envelope } = await residencyFixture();
    service.createInstallPolicy(admin, envelope.computerId, [{ effect: "deny", managers: ["bun"] }]);
    let code = "";
    try { protocol.validateOperation({ ...envelope, sequence: 0, nonce: randomBytes(24).toString("base64url") }); }
    catch (error) { code = (error as { code?: string }).code ?? ""; }
    expect(code).toBe("policy_generation_mismatch");
    void storage;
  });
});

function enrollmentComputer(storage: SQLiteStorage): string {
  const row = storage.database.query("SELECT computer_id FROM resident_bindings LIMIT 1").get() as { computer_id: string } | null;
  if (row === null) throw new Error("Missing resident binding");
  return row.computer_id;
}
