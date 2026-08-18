import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import type { AuthorizationContext, Computer, ProviderAttempt } from "../src/contracts";
import { StaticInstallTicketSigningKeyProvider } from "../src/install-policy";
import { ComputersService } from "../src/service";
import { SQLiteStorage } from "../src/storage";

// Taxonomy lane (contracts-alignment-r2): the daemon/queue vocabulary must be the
// fleet taxonomy from global-hasna-daemon-worker-taxonomy: queue entries are
// `admitted` -> `leased` -> `running` -> terminal; attempts carry a lease with
// generation and fencing token; every terminal attempt produces a terminal
// receipt. These tests assert that vocabulary on the public surfaces.

const admin: AuthorizationContext = { tenantId: "tenant_test", principalId: "principal_admin", scopes: ["computers:admin"], authMethod: "loopback_dev" };

const TAXONOMY_ACTIVE_STATUSES = new Set(["admitted", "leased", "running", "ambiguous"]);

describe("daemon/queue taxonomy vocabulary", () => {
  let storage: SQLiteStorage;
  let service: ComputersService;

  beforeEach(() => {
    storage = new SQLiteStorage(":memory:");
    storage.migrate();
    service = new ComputersService(storage, { ticketSigningKeyProvider: new StaticInstallTicketSigningKeyProvider(randomBytes(32)) });
  });
  afterEach(() => storage.close());

  function create(slug = "taxonomy-primary", ownerPrincipalId = "principal_owner"): Computer {
    return service.createComputer(admin, { slug, provider: "local_machine", ownerPrincipalId, idempotencyKey: `create-${slug}-001` });
  }

  function createOperation(computer: Computer) {
    const operations = storage.listOperations(admin.tenantId, computer.id);
    expect(operations.length).toBeGreaterThan(0);
    return operations[0];
  }

  test("a service-created operation is admitted to the queue", () => {
    const computer = create();
    const operation = createOperation(computer);
    expect(operation.status).toBe("admitted");
    expect(TAXONOMY_ACTIVE_STATUSES.has(operation.status)).toBe(true);
  });

  test("beginning a provider attempt leases it: lease token, lease generation, lease expiry", () => {
    const computer = create();
    const operation = createOperation(computer);
    const attempt: ProviderAttempt = storage.beginProviderAttempt(operation);
    expect(attempt.operationId).toBe(operation.id);
    expect(attempt.leaseToken).toBeTruthy();
    expect(attempt.leaseGeneration).toBeGreaterThanOrEqual(1);
    expect(attempt.leaseExpiresAt).toBeTruthy();
    expect(Date.parse(attempt.leaseExpiresAt as string)).toBeGreaterThan(Date.now());
    expect(attempt.fence).toBe(operation.fence);
    const reloaded = storage.getOperation(admin.tenantId, operation.id);
    expect(reloaded?.status).toBe("running");
  });

  test("the lease heartbeats by renewing its expiry, and a stale lease generation is fenced", () => {
    const computer = create();
    const operation = createOperation(computer);
    const attempt = storage.beginProviderAttempt(operation);
    const firstExpiry = attempt.leaseExpiresAt as string;
    storage.renewProviderAttemptOwnership(attempt);
    expect(attempt.leaseExpiresAt).toBeTruthy();
    expect(Date.parse(attempt.leaseExpiresAt as string)).toBeGreaterThanOrEqual(Date.parse(firstExpiry));
    storage.assertProviderAttemptOwnership(attempt);
    const stale: ProviderAttempt = { ...attempt, leaseGeneration: attempt.leaseGeneration + 1 };
    expect(() => storage.assertProviderAttemptOwnership(stale)).toThrow("lost");
  });

  test("a lost provider outcome marks the operation ambiguous with a taxonomy error code", () => {
    const computer = create();
    const operation = createOperation(computer);
    const attempt = storage.beginProviderAttempt(operation);
    storage.recordProviderOwnershipLost(attempt, { resourceId: "resource_taxonomy" });
    const reloaded = storage.getOperation(admin.tenantId, operation.id);
    expect(reloaded?.status).toBe("ambiguous");
    expect(reloaded?.errorCode).toBe("provider_outcome_ambiguous");
    expect(TAXONOMY_ACTIVE_STATUSES.has(reloaded?.status as string)).toBe(true);
  });

  test("a terminal success records a terminal receipt on the operation", () => {
    const computer = create();
    const operation = createOperation(computer);
    const attempt = storage.beginProviderAttempt(operation);
    const receipt = { lifecycle: "stopped", instanceId: "instance_taxonomy", bootId: "boot_taxonomy", digest: "sha256:" + "c".repeat(64) };
    const completed = storage.completeProviderOperation(operation, attempt, {
      kind: "success", resource: { resourceId: "resource_taxonomy", instanceId: "instance_taxonomy" }, result: receipt,
    });
    expect(completed.status).toBe("succeeded");
    expect(completed.receipt).toEqual(receipt);
  });

  test("attempt identity is stable and monotonic per queue entry", () => {
    const computer = create();
    const operation = createOperation(computer);
    const attempt = storage.beginProviderAttempt(operation);
    expect(attempt.id).toBeTruthy();
    expect(attempt.attemptNumber).toBeGreaterThanOrEqual(1);
    expect(attempt.providerIdempotencyKey).toBe(`provider:${operation.id}`);
    const latest = storage.getProviderAttempt(admin.tenantId, operation.id);
    expect(latest?.id).toBe(attempt.id);
    expect(latest?.attemptNumber).toBe(attempt.attemptNumber);
    const row = storage.database.query(
      "SELECT attempt_number FROM operation_attempts WHERE tenant_id = ? AND operation_id = ?",
    ).get(admin.tenantId, operation.id) as { attempt_number: number } | null;
    expect(row?.attempt_number).toBe(attempt.attemptNumber);
  });

  test("the observation surface reports queue depth and lease health per entry", () => {
    create("taxonomy-depth-a", "principal_owner_a");
    create("taxonomy-depth-b", "principal_owner_b");
    const operations = storage.listOperations(admin.tenantId);
    for (const operation of operations) {
      expect(TAXONOMY_ACTIVE_STATUSES.has(operation.status) || ["succeeded", "failed", "cancelled"].includes(operation.status)).toBe(true);
    }
    const admitted = operations.filter((item) => item.status === "admitted").length;
    expect(admitted).toBe(2);
    const first = operations[0];
    const attempt = storage.beginProviderAttempt(first);
    const attemptLease = storage.getProviderAttempt(admin.tenantId, first.id);
    expect(attemptLease?.leaseToken).toBe(attempt.leaseToken);
    expect(attemptLease?.leaseExpiresAt).toBe(attempt.leaseExpiresAt);
  });

  test("the openapi schema uses taxonomy statuses and names the terminal receipt", () => {
    const openapi = JSON.parse(readFileSync("schemas/openapi.json", "utf8")) as { components: { schemas: { Operation?: { properties?: Record<string, unknown>; required?: string[] } } } };
    const operationSchema = openapi.components.schemas.Operation;
    expect(operationSchema).toBeDefined();
    const status = operationSchema?.properties?.status as { enum?: string[] } | undefined;
    expect(status?.enum).toContain("admitted");
    expect(status?.enum).toContain("leased");
    expect(status?.enum).toContain("ambiguous");
    expect(status?.enum).not.toContain("pending");
    expect(status?.enum).not.toContain("accepted");
    expect(status?.enum).not.toContain("unknown");
    expect(operationSchema?.properties?.receipt).toBeDefined();
    expect(operationSchema?.properties?.result).toBeUndefined();
  });

  test("the persisted schema carries taxonomy statuses after migration", () => {
    const row = storage.database.query("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'operations'").get() as { sql: string };
    expect(row.sql).toContain("'admitted'");
    expect(row.sql).toContain("'leased'");
    expect(row.sql).toContain("'ambiguous'");
    expect(row.sql).not.toContain("'pending'");
    expect(row.sql).not.toContain("'accepted'");
    const attemptRow = storage.database.query("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'operation_attempts'").get() as { sql: string };
    expect(attemptRow.sql).toContain("'ambiguous'");
    const version = storage.database.query("SELECT MAX(version) AS version FROM schema_migrations").get() as { version: number };
    expect(version.version).toBeGreaterThanOrEqual(4);
  });
});
