// agent-authored: SOL consult refused (capacity wall, exact error: "Selected model is at capacity. Please try a different model.");
// no SOL spec received. Test specs authored from direct source analysis of untested surfaces.
import { afterEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import type { AuthorizationContext, PackageSpec } from "../src/contracts";
import { StaticInstallTicketSigningKeyProvider } from "../src/install-policy";
import { ComputersService } from "../src/service";
import { SQLiteStorage } from "../src/storage";

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) require("node:fs").rmSync(directory, { recursive: true, force: true }); });

const spec: PackageSpec = {
  manager: "bun", name: "gap-package", version: "1.0.0", digest: `sha256:${"b".repeat(64)}`,
  registry: "https://registry.example.invalid/", dependencyClosure: [], allowLifecycleScripts: false,
};

function setup() {
  const storage = new SQLiteStorage(":memory:"); storage.migrate();
  const service = new ComputersService(storage, { ticketSigningKeyProvider: new StaticInstallTicketSigningKeyProvider(randomBytes(32)) });
  const admin: AuthorizationContext = { tenantId: "tenant_ticket", principalId: "principal_admin", scopes: ["computers:admin"], authMethod: "bearer" };
  const computer = service.createComputer(admin, { slug: "ticket-lifecycle", provider: "local_machine", ownerPrincipalId: "principal_owner", idempotencyKey: "ticket-lifecycle-create" });
  service.createInstallPolicy(admin, computer.id, [{ effect: "allow", managers: ["bun"] }]);
  const owner: AuthorizationContext = { tenantId: admin.tenantId, principalId: "principal_owner", scopes: ["computers:install"], boundComputerId: computer.id, policyGeneration: 2, authMethod: "bearer" };
  return { storage, service, admin, owner, computer };
}

describe("install ticket lifecycle edge conditions", () => {
  test("an expired ticket is rejected at apply and remains unconsumed", () => {
    const { storage, service, owner, computer } = setup();
    const ticket = service.installPlan(owner, computer.id, spec).ticket ?? "";
    expect(ticket).not.toBe("");
    storage.database.query("UPDATE install_tickets SET expires_at = ? WHERE computer_id = ?").run(new Date(0).toISOString(), computer.id);
    expect(() => service.installApply(owner, computer.id, ticket, "install-expired-apply")).toThrow("Install ticket rejected");
    expect(storage.database.query("SELECT COUNT(*) AS count FROM operations WHERE kind = 'install'").get() as { count: number }).toEqual({ count: 0 });
    const row = storage.database.query("SELECT consumed_at FROM install_tickets WHERE computer_id = ?").get(computer.id) as { consumed_at: string | null } | null;
    expect(row?.consumed_at).toBeNull();
  });

  test("a tampered ticket is rejected at verify without consuming the stored ticket", () => {
    const { storage, service, owner, computer } = setup();
    const ticket = service.installPlan(owner, computer.id, spec).ticket ?? "";
    const [payload, signature] = ticket.split(".");
    const claims = JSON.parse(Buffer.from(payload as string, "base64url").toString("utf8")) as Record<string, unknown>;
    claims.name = "tampered-package";
    const tampered = `${Buffer.from(JSON.stringify(claims)).toString("base64url")}.${signature as string}`;
    expect(() => service.installApply(owner, computer.id, tampered, "install-tampered-apply")).toThrow("Install ticket rejected");
    expect(() => service.installApply(owner, computer.id, `${payload as string}.${"A".repeat(43)}`, "install-tampered-sig-apply")).toThrow("Install ticket rejected");
    const row = storage.database.query("SELECT consumed_at FROM install_tickets WHERE computer_id = ?").get(computer.id) as { consumed_at: string | null } | null;
    expect(row?.consumed_at).toBeNull();
    const valid = service.installApply(owner, computer.id, ticket, "install-tampered-then-valid");
    expect(valid.kind).toBe("install");
  });

  test("replaying a consumed ticket with a fresh idempotency key is rejected", () => {
    const { storage, service, owner, computer } = setup();
    const ticket = service.installPlan(owner, computer.id, spec).ticket ?? "";
    const first = service.installApply(owner, computer.id, ticket, "install-replay-key-one");
    expect(first.status).toBe("admitted");
    const row = storage.database.query("SELECT consumed_at FROM install_tickets WHERE computer_id = ?").get(computer.id) as { consumed_at: string | null } | null;
    expect(row?.consumed_at).not.toBeNull();
    expect(() => service.installApply(owner, computer.id, ticket, "install-replay-key-two")).toThrow("Install ticket rejected");
  });

  test("the same ticket and idempotency key returns the same operation without a second write", () => {
    const { storage, service, owner, computer } = setup();
    const ticket = service.installPlan(owner, computer.id, spec).ticket ?? "";
    const first = service.installApply(owner, computer.id, ticket, "install-idempotent-apply");
    const second = service.installApply(owner, computer.id, ticket, "install-idempotent-apply");
    expect(second.id).toBe(first.id);
    expect(storage.database.query("SELECT COUNT(*) AS count FROM operations WHERE kind = 'install'").get() as { count: number }).toEqual({ count: 1 });
  });

  test("the same idempotency key with a different ticket conflicts", () => {
    const { service, owner, computer } = setup();
    const firstSpec: PackageSpec = { ...spec, name: "gap-package-one" };
    const secondSpec: PackageSpec = { ...spec, name: "gap-package-two" };
    const firstTicket = service.installPlan(owner, computer.id, firstSpec).ticket ?? "";
    const secondTicket = service.installPlan(owner, computer.id, secondSpec).ticket ?? "";
    service.installApply(owner, computer.id, firstTicket, "install-conflict-key");
    expect(() => service.installApply(owner, computer.id, secondTicket, "install-conflict-key")).toThrow("Idempotency key was used with a different request");
  });

  test("a policy generation change between issue and apply rejects the ticket", () => {
    const { storage, service, admin, owner, computer } = setup();
    const ticket = service.installPlan(owner, computer.id, spec).ticket ?? "";
    service.createInstallPolicy(admin, computer.id, [{ effect: "allow", managers: ["bun", "npm"] }]);
    const generation = storage.database.query("SELECT policy_generation FROM computers WHERE id = ?").get(computer.id) as { policy_generation: number };
    expect(generation.policy_generation).toBe(3);
    const refreshedOwner: AuthorizationContext = { ...owner, policyGeneration: 3 };
    expect(() => service.installApply(refreshedOwner, computer.id, ticket, "install-stale-policy-apply")).toThrow("Install ticket rejected");
  });

  test("a ticket issued for one computer is rejected on another", () => {
    const { service, admin, owner, computer } = setup();
    const other = service.createComputer(admin, { slug: "ticket-other", provider: "local_machine", ownerPrincipalId: "principal_other", idempotencyKey: "ticket-other-create" });
    service.createInstallPolicy(admin, other.id, [{ effect: "allow", managers: ["bun"] }]);
    const otherOwner: AuthorizationContext = { tenantId: admin.tenantId, principalId: "principal_other", scopes: ["computers:install"], boundComputerId: other.id, policyGeneration: 2, authMethod: "bearer" };
    const ticket = service.installPlan(owner, computer.id, spec).ticket ?? "";
    expect(() => service.installApply(otherOwner, other.id, ticket, "install-cross-computer-apply")).toThrow("Install ticket rejected");
  });

  test("an install ticket carries an audit trail that verifies as a chain", () => {
    const { storage, service, owner, computer } = setup();
    const ticket = service.installPlan(owner, computer.id, spec).ticket ?? "";
    service.installApply(owner, computer.id, ticket, "install-audit-apply");
    const verification = storage.verifyAuditChain(owner.tenantId);
    expect(verification.valid).toBe(true);
    expect(verification.eventCount).toBeGreaterThanOrEqual(3);
    const issued = storage.database.query("SELECT COUNT(*) AS count FROM audit_events WHERE action = 'install.ticket_issued'").get() as { count: number };
    const applied = storage.database.query("SELECT COUNT(*) AS count FROM audit_events WHERE action = 'install.apply_requested'").get() as { count: number };
    expect(issued.count).toBe(1);
    expect(applied.count).toBe(1);
  });
});
