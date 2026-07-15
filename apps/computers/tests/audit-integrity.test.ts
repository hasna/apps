import { describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { AuditCheckpointManager } from "../src/audit";
import type { AuditCheckpoint, AuditCheckpointSink, AuthorizationContext } from "../src/contracts";
import { StaticInstallTicketSigningKeyProvider } from "../src/install-policy";
import { ComputersService } from "../src/service";
import { SQLiteStorage } from "../src/storage";

const admin: AuthorizationContext = { tenantId: "tenant_audit", principalId: "principal_admin", scopes: ["computers:admin"], authMethod: "bearer" };

function fixture(): { storage: SQLiteStorage; computerId: string } {
  const storage = new SQLiteStorage(":memory:"); storage.migrate();
  const service = new ComputersService(storage, { ticketSigningKeyProvider: new StaticInstallTicketSigningKeyProvider(randomBytes(32)) });
  const computer = service.createComputer(admin, { slug: "audit", provider: "local_machine", ownerPrincipalId: "principal_owner", idempotencyKey: "audit-create-001" });
  storage.appendAudit(admin.tenantId, admin.principalId, "audit.marker.one", { marker: 1 }, computer.id);
  storage.appendAudit(admin.tenantId, admin.principalId, "audit.marker.two", { marker: 2 }, computer.id);
  return { storage, computerId: computer.id };
}

describe("audit transaction and external checkpoint contract", () => {
  test("detects forged insertion, deletion, reordering, content mutation, and anchored truncation", () => {
    const mutations: Array<(storage: SQLiteStorage) => void> = [
      (storage) => {
        storage.database.query(`INSERT INTO audit_events
          (id, tenant_id, actor_principal_id, action, data_json, previous_hash, event_hash, created_at)
          VALUES (?, ?, ?, ?, '{}', ?, ?, ?)`)
          .run("aud_forged_insertion", admin.tenantId, admin.principalId, "audit.forged", `sha256:${"0".repeat(64)}`, `sha256:${"1".repeat(64)}`, new Date().toISOString());
      },
      (storage) => {
        storage.database.exec("DROP TRIGGER audit_events_no_delete");
        storage.database.query("DELETE FROM audit_events WHERE sequence = (SELECT MIN(sequence) + 1 FROM audit_events WHERE tenant_id = ?)").run(admin.tenantId);
      },
      (storage) => {
        storage.database.exec("DROP TRIGGER audit_events_no_update");
        storage.database.query("UPDATE audit_events SET sequence = sequence + 1000 WHERE sequence = (SELECT MIN(sequence) FROM audit_events WHERE tenant_id = ?)").run(admin.tenantId);
      },
      (storage) => {
        storage.database.exec("DROP TRIGGER audit_events_no_update");
        storage.database.query("UPDATE audit_events SET action = 'audit.rewritten' WHERE sequence = (SELECT MAX(sequence) FROM audit_events WHERE tenant_id = ?)").run(admin.tenantId);
      },
    ];
    for (const mutate of mutations) {
      const { storage } = fixture();
      try {
        expect(storage.verifyAuditChain(admin.tenantId).valid).toBe(true);
        mutate(storage);
        expect(storage.verifyAuditChain(admin.tenantId).valid).toBe(false);
      } finally { storage.close(); }
    }
    const { storage } = fixture();
    try {
      const checkpoint = storage.currentAuditCheckpoint(admin.tenantId);
      if (checkpoint === undefined) throw new Error("missing checkpoint");
      storage.database.exec("DROP TRIGGER audit_events_no_delete");
      storage.database.query("DELETE FROM audit_events WHERE sequence = (SELECT MAX(sequence) FROM audit_events WHERE tenant_id = ?)").run(admin.tenantId);
      expect(storage.verifyAuditChain(admin.tenantId).valid).toBe(true);
      expect(storage.verifyAuditChain(admin.tenantId, checkpoint)).toMatchObject({ valid: false, anchored: true, error: "audit_checkpoint_mismatch" });
    } finally { storage.close(); }
  });

  test("reports local-only truth and writes checkpoints only through a configured durable sink", async () => {
    const { storage } = fixture();
    try {
      const local = new AuditCheckpointManager(storage);
      expect(await local.readiness()).toMatchObject({ configured: false, ready: true, independentlyAnchored: false });
      await expect(local.writeCheckpoint(admin.tenantId)).rejects.toThrow("not configured");
      const written: AuditCheckpoint[] = [];
      const sink: AuditCheckpointSink = {
        readiness: async () => ({ configured: true, ready: true, durable: true, limitations: [] }),
        write: async (checkpoint) => { written.push(checkpoint); },
      };
      const external = new AuditCheckpointManager(storage, sink);
      expect(await external.readiness()).toMatchObject({ configured: true, ready: true, independentlyAnchored: true });
      const checkpoint = await external.writeCheckpoint(admin.tenantId);
      expect(written).toEqual([checkpoint]);
      expect(external.verify(admin.tenantId, checkpoint)).toMatchObject({ valid: true, anchored: true });
    } finally { storage.close(); }
  });

  test("an audit append failure rolls back a home-lease security mutation", () => {
    const { storage, computerId } = fixture();
    try {
      storage.database.exec("CREATE TRIGGER fail_security_audit BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT, 'checkpoint unavailable'); END;");
      expect(() => storage.acquireHomeLease(admin.tenantId, computerId, "principal_owner", "controller_audit", 60, 0)).toThrow("checkpoint unavailable");
      expect(storage.getHomeLeaseCapability(admin.tenantId, computerId)).toBeUndefined();
    } finally { storage.close(); }
  });

  test("an audit append failure rolls back provider result, binding, and Computer transition", () => {
    const { storage, computerId } = fixture();
    try {
      const operation = storage.listOperations(admin.tenantId, computerId).find((item) => item.kind === "create");
      if (operation === undefined) throw new Error("missing create operation");
      const attempt = storage.beginProviderAttempt(operation);
      storage.database.exec("CREATE TRIGGER fail_provider_audit BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT, 'audit append failed'); END;");
      expect(() => storage.completeProviderOperation(operation, attempt, { kind: "success", resource: { resourceId: "resource_audit_atomic" }, result: {} })).toThrow("audit append failed");
      expect(storage.getOperation(admin.tenantId, operation.id)?.status).toBe("running");
      expect(storage.getProviderAttempt(admin.tenantId, operation.id)?.status).toBe("running");
      expect(storage.getComputer(admin.tenantId, computerId)?.status).toBe("provisioning");
      expect(storage.getProviderBinding(admin.tenantId, computerId)).toBeUndefined();
    } finally { storage.close(); }
  });
});
