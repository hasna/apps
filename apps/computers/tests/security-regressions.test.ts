import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
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
      storage.updateComputerStatus(admin.tenantId, computer.id, "running");
      const attempt = storage.beginProviderAttempt(operation);
      const protocol = new ResidentProtocol(storage);
      storage.setResidentBinding({ tenantId: admin.tenantId, computerId: computer.id, provider: "local_machine", providerResourceId: "resource_secure", instanceId: "instance_secure", bootId: "boot_secure", generation: 1, updatedAt: new Date().toISOString() });
      const enrollment = await protocol.precreateEnrollment(admin.tenantId, computer.id);
      const identity = (await protocol.enroll({ token: enrollment.token, provider: "local_machine", instanceId: "instance_secure", bootId: "boot_secure" })).identity;
      const now = new Date();
      const base: ResidentOperationEnvelope = {
        operationId: operation.id, attemptId: attempt.id, tenantId: admin.tenantId, computerId: computer.id,
        certificateId: identity.certificateId, policyGeneration: computer.policyGeneration, fence: operation.fence, sequence: 0,
        nonce: randomBytes(24).toString("base64url"), issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 60_000).toISOString(),
        capability: "exec", payloadDigest: sha256(operation.request),
      };
      expect(() => protocol.validateOperation({ ...base, attemptId: "pat_not_current", nonce: randomBytes(24).toString("base64url") })).toThrow("Resident authentication failed");
      storage.updateComputerStatus(admin.tenantId, computer.id, "stopped");
      expect(() => protocol.validateOperation({ ...base, nonce: randomBytes(24).toString("base64url") })).toThrow("Resident authentication failed");
      storage.updateComputerStatus(admin.tenantId, computer.id, "running");
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
      storage.database.query(`INSERT INTO computers (id, tenant_id, slug, provider, confinement_class, status, owner_principal_id, policy_generation, data_exfiltration_protection, created_at, updated_at)
        VALUES (?, ?, ?, 'local_vm', 'unverified_vm', 'stopped', ?, 1, 0, ?, ?)`).run("cmp_stock_vm", admin.tenantId, "stock-vm", "principal_stock_vm", now, now);
      expect(() => storage.database.query("UPDATE computers SET confinement_class = 'strict_vm' WHERE tenant_id = ? AND id = ?").run(admin.tenantId, "cmp_stock_vm")).toThrow("unverified_vm");
      storage.database.query(`INSERT INTO operations (id, tenant_id, computer_id, kind, status, policy_generation, idempotency_key, request_json, fence, created_at, updated_at)
        VALUES ('opn_stock_vm', ?, 'cmp_stock_vm', 'create', 'running', 1, 'stock-vm-create', '{}', 0, ?, ?)`).run(admin.tenantId, now, now);
      storage.database.query(`INSERT INTO operation_attempts (id, tenant_id, operation_id, attempt_number, provider_idempotency_key, status, fence, execution_owner_generation, started_at)
        VALUES ('pat_stock_vm', ?, 'opn_stock_vm', 1, 'provider:opn_stock_vm', 'running', 0, 1, ?)`).run(admin.tenantId, now);
      expect(() => storage.database.query(`INSERT INTO provider_assurance
        (tenant_id, computer_id, provider, confinement_class, evidence_json, operation_id, attempt_id, binding_fence, generation, verified_at)
        VALUES (?, 'cmp_stock_vm', 'local_vm', 'strict_vm', '{}', 'opn_stock_vm', 'pat_stock_vm', 0, 1, ?)`)
        .run(admin.tenantId, now)).toThrow("unverified_vm");
      storage.database.query(`INSERT INTO computers (id, tenant_id, slug, provider, confinement_class, status, owner_principal_id, policy_generation, data_exfiltration_protection, created_at, updated_at)
        VALUES ('cmp_stock_vm_other', ?, 'stock-vm-other', 'local_vm', 'unverified_vm', 'stopped', 'principal_stock_vm_other', 1, 0, ?, ?)`).run(admin.tenantId, now, now);
      storage.database.query(`INSERT INTO operations (id, tenant_id, computer_id, kind, status, policy_generation, idempotency_key, request_json, fence, created_at, updated_at)
        VALUES ('opn_stock_vm_other', ?, 'cmp_stock_vm_other', 'create', 'running', 1, 'stock-vm-other-create', '{}', 0, ?, ?)`).run(admin.tenantId, now, now);
      storage.database.query(`INSERT INTO operation_attempts (id, tenant_id, operation_id, attempt_number, provider_idempotency_key, status, fence, execution_owner_generation, started_at)
        VALUES ('pat_stock_vm_other', ?, 'opn_stock_vm_other', 1, 'provider:opn_stock_vm_other', 'running', 0, 1, ?)`).run(admin.tenantId, now);
      expect(() => storage.database.query(`INSERT INTO provider_assurance
        (tenant_id, computer_id, provider, confinement_class, evidence_json, operation_id, attempt_id, binding_fence, generation, verified_at)
        VALUES (?, 'cmp_stock_vm', 'local_vm', 'unverified_vm', '{}', 'opn_stock_vm_other', 'pat_stock_vm_other', 0, 1, ?)`)
        .run(admin.tenantId, now)).toThrow();
      expect(() => storage.database.query(`INSERT INTO provider_assurance
        (tenant_id, computer_id, provider, confinement_class, evidence_json, operation_id, attempt_id, binding_fence, generation, verified_at)
        VALUES (?, 'cmp_stock_vm', 'local_vm', 'unverified_vm', '{}', 'opn_stock_vm', 'pat_stock_vm_other', 0, 1, ?)`)
        .run(admin.tenantId, now)).toThrow();
      expect(() => validateProviderConfinement("local_machine", "strict_vm")).toThrow("Invalid confinementClass");
      expect(() => validateProviderConfinement("local_vm", "strict_vm")).toThrow("Invalid confinementClass");
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

  test("0001 upgrade fences every legacy local VM exactly once and replay preserves post-v3 authority", () => {
    const directory = mkdtempSync(join(process.cwd(), ".test-data-v2-structure-")); temporaryDirectories.push(directory);
    const legacyPath = join(directory, "legacy.db"); const legacy = new Database(legacyPath); legacy.exec(readFileSync("migrations/sqlite/0001_initial.sql", "utf8"));
    const now = new Date().toISOString(); const future = new Date(Date.now() + 60_000).toISOString();
    const legacyComputers = [
      { suffix: "strict", confinement: "strict_vm", status: "running", generation: 1, token: "a" },
      { suffix: "unverified", confinement: "unverified_vm", status: "stopped", generation: 7, token: "b" },
      { suffix: "deleting", confinement: "strict_vm", status: "deleting", generation: 3, token: "c" },
      { suffix: "deleted", confinement: "unverified_vm", status: "deleted", generation: 5, token: "d" },
      { suffix: "provisioning", confinement: "strict_vm", status: "provisioning", generation: 9, token: "e" },
      { suffix: "quarantined", confinement: "unverified_vm", status: "quarantined", generation: 13, token: "f" },
      { suffix: "error", confinement: "strict_vm", status: "error", generation: 17, token: "0" },
    ];
    for (const row of legacyComputers) {
      const computerId = `cmp_legacy_${row.suffix}`; const operationId = `opn_legacy_${row.suffix}`; const attemptId = `pat_legacy_${row.suffix}`;
      legacy.query(`INSERT INTO computers (id, tenant_id, slug, provider, confinement_class, status, owner_principal_id, policy_generation, data_exfiltration_protection, created_at, updated_at)
        VALUES (?, 'tenant_legacy', ?, 'local_vm', ?, ?, ?, ?, 0, ?, ?)`).run(computerId, `legacy-${row.suffix}`, row.confinement, row.status, `principal_${row.suffix}`, row.generation, now, now);
      legacy.query(`INSERT INTO operations (id, tenant_id, computer_id, kind, status, policy_generation, idempotency_key, request_json, fence, created_at, updated_at)
        VALUES (?, 'tenant_legacy', ?, ?, 'running', ?, ?, '{}', 0, ?, ?)`).run(operationId, computerId, row.status === "deleting" || row.status === "deleted" ? "delete" : "create", row.generation, `legacy-${row.suffix}`, now, now);
      legacy.query(`INSERT INTO operation_attempts (id, tenant_id, operation_id, attempt_number, provider_idempotency_key, status, fence, started_at)
        VALUES (?, 'tenant_legacy', ?, 1, ?, 'running', 0, ?)`).run(attemptId, operationId, `provider:${operationId}`, now);
      legacy.query(`INSERT INTO provider_bindings (tenant_id, computer_id, provider, resource_id, operation_id, attempt_id, state, fence, updated_at)
        VALUES ('tenant_legacy', ?, 'local_vm', ?, ?, ?, 'active', 0, ?)`).run(computerId, `resource_${row.suffix}`, operationId, attemptId, now);
      legacy.query("INSERT INTO home_leases (tenant_id, computer_id, holder_id, fence, expires_at, updated_at) VALUES ('tenant_legacy',?,?,1,?,?)")
        .run(computerId, `holder_${row.suffix}`, future, now);
      legacy.query("INSERT INTO operation_home_leases (tenant_id, operation_id, computer_id, home_id, holder_id, fence, expires_at) VALUES ('tenant_legacy',?,?,?,?,1,?)")
        .run(operationId, computerId, `home:${computerId}`, `holder_${row.suffix}`, future);
      legacy.query("INSERT INTO resident_bindings (tenant_id, computer_id, provider, provider_resource_id, instance_id, boot_id, generation, updated_at) VALUES ('tenant_legacy',?,'local_vm',?,?,?,1,?)")
        .run(computerId, `resource_${row.suffix}`, `instance_${row.suffix}`, `boot_${row.suffix}`, now);
      legacy.query(`INSERT INTO resident_enrollments (id, tenant_id, computer_id, expected_provider, expected_instance_id, expected_boot_id, binding_generation, token_hash, expires_at, created_at)
        VALUES (?,'tenant_legacy',?,'local_vm',?,?,1,?,?,?)`).run(`ren_${row.suffix}`, computerId, `instance_${row.suffix}`, `boot_${row.suffix}`, row.token.repeat(64), future, now);
      legacy.query(`INSERT INTO resident_identities (certificate_id, tenant_id, computer_id, provider, instance_id, boot_id, generation, issued_at, binding_generation, expires_at)
        VALUES (?,'tenant_legacy',?,'local_vm',?,?,1,?,1,?)`).run(`cert_${row.suffix}`, computerId, `instance_${row.suffix}`, `boot_${row.suffix}`, now, future);
      legacy.query(`INSERT INTO resident_nonces (tenant_id, computer_id, nonce, operation_id, attempt_id, sequence, expires_at, created_at)
        VALUES ('tenant_legacy',?,?,?,?,0,?,?)`).run(computerId, `nonce_${row.suffix}`, operationId, attemptId, future, now);
    }
    legacy.close();

    const upgraded = new SQLiteStorage(legacyPath);
    try {
      for (const row of legacyComputers) {
        const expectedStatus = row.status === "deleting" || row.status === "deleted" ? row.status : "quarantined";
        expect(upgraded.getComputer("tenant_legacy", `cmp_legacy_${row.suffix}`)).toMatchObject({
          confinementClass: "unverified_vm", status: expectedStatus, policyGeneration: row.generation + 1,
        });
        expect(() => upgraded.assertOperationPolicyCurrent("tenant_legacy", `opn_legacy_${row.suffix}`)).toThrow("Policy generation changed");
      }
      expect(upgraded.database.query(`SELECT
        (SELECT count(*) FROM provider_bindings WHERE tenant_id='tenant_legacy') AS provider_bindings,
        (SELECT count(*) FROM resident_bindings WHERE tenant_id='tenant_legacy') AS resident_bindings,
        (SELECT count(*) FROM resident_nonces WHERE tenant_id='tenant_legacy') AS resident_nonces,
        (SELECT count(*) FROM home_leases WHERE tenant_id='tenant_legacy') AS home_leases,
        (SELECT count(*) FROM operation_home_leases WHERE tenant_id='tenant_legacy') AS operation_home_leases,
        (SELECT count(*) FROM resident_enrollments WHERE tenant_id='tenant_legacy' AND revoked_at IS NULL) AS live_enrollments,
        (SELECT count(*) FROM resident_identities WHERE tenant_id='tenant_legacy' AND revoked_at IS NULL) AS live_identities`).get()).toEqual({
        provider_bindings: 0, resident_bindings: 0, resident_nonces: 0, home_leases: 0, operation_home_leases: 0, live_enrollments: 0, live_identities: 0,
      });
      expect(upgraded.database.query("SELECT count(*) AS count FROM operations WHERE tenant_id='tenant_legacy' AND policy_generation = (SELECT policy_generation - 1 FROM computers WHERE computers.tenant_id=operations.tenant_id AND computers.id=operations.computer_id)").get()).toEqual({ count: 7 });

      upgraded.database.query(`INSERT INTO computers (id, tenant_id, slug, provider, confinement_class, status, owner_principal_id, policy_generation, data_exfiltration_protection, created_at, updated_at)
        VALUES ('cmp_post', 'tenant_post', 'post', 'local_vm', 'unverified_vm', 'running', 'principal_post', 12, 0, ?, ?)`).run(now, now);
      upgraded.database.query(`INSERT INTO operations (id, tenant_id, computer_id, kind, status, policy_generation, idempotency_key, request_json, fence, created_at, updated_at)
        VALUES ('opn_post','tenant_post','cmp_post','create','running',12,'post','{}',9,?,?)`).run(now, now);
      upgraded.database.query(`INSERT INTO operation_attempts (id, tenant_id, operation_id, attempt_number, provider_idempotency_key, status, fence, execution_owner_token, execution_owner_generation, execution_owner_expires_at, started_at)
        VALUES ('pat_post','tenant_post','opn_post',1,'provider:post','running',9,'owner_post',4,?,?)`).run(future, now);
      upgraded.database.query("INSERT INTO home_leases VALUES ('tenant_post','cmp_post','holder_post',9,?,?)").run(future, now);
      upgraded.database.query("INSERT INTO operation_home_leases VALUES ('tenant_post','opn_post','cmp_post','home:cmp_post','holder_post',9,?)").run(future);
      upgraded.database.query("INSERT INTO resident_bindings VALUES ('tenant_post','cmp_post','local_vm','resource_post','instance_post','boot_post',4,?)").run(now);
      upgraded.database.query(`INSERT INTO resident_enrollments (id,tenant_id,computer_id,expected_provider,expected_instance_id,token_hash,expires_at,expected_boot_id,binding_generation,used_at,created_at,revoked_at)
        VALUES ('ren_post','tenant_post','cmp_post','local_vm','instance_post',?,?,'boot_post',4,NULL,?,NULL)`).run("1".repeat(64), future, now);
      upgraded.database.query("INSERT INTO resident_identities VALUES ('cert_post','tenant_post','cmp_post','local_vm','instance_post','boot_post',4,?,4,?,NULL)").run(now, future);
      upgraded.database.query("INSERT INTO resident_nonces VALUES ('tenant_post','cmp_post','nonce_post','opn_post','pat_post',3,?,?)").run(future, now);
      upgraded.database.query("INSERT INTO provider_assurance VALUES ('tenant_post','cmp_post','local_vm','unverified_vm','{\"post\":true}','opn_post','pat_post',9,4,?)").run(now);
      upgraded.database.query("INSERT INTO provider_bindings VALUES ('tenant_post','cmp_post','local_vm','resource_post','instance_post','boot_post','opn_post','pat_post','active',9,?)").run(now);

      const replayRelations = ["computers", "operations", "operation_attempts", "provider_bindings", "operation_home_leases", "home_leases", "resident_bindings", "resident_enrollments", "resident_identities", "resident_nonces", "provider_assurance"];
      const replayBefore = replayRelations.map((relation) => JSON.stringify(upgraded.database.query(`SELECT * FROM ${relation} WHERE tenant_id='tenant_post' ORDER BY rowid`).all()));
      upgraded.migrate();
      const replayAfter = replayRelations.map((relation) => JSON.stringify(upgraded.database.query(`SELECT * FROM ${relation} WHERE tenant_id='tenant_post' ORDER BY rowid`).all()));
      expect(replayAfter).toEqual(replayBefore);
      expect(upgraded.database.query("SELECT count(*) AS count, max(version) AS version FROM schema_migrations").get()).toEqual({ count: 3, version: 3 });
      expect(upgraded.ready()).toBe(true);
    } finally { upgraded.close(); }
  });

  test("SQLite provider-assurance migration rolls back demotion and schema changes on failure", () => {
    const directory = mkdtempSync(join(process.cwd(), ".test-data-v2-rollback-")); temporaryDirectories.push(directory);
    const path = join(directory, "rollback.db"); const database = new Database(path); const now = new Date().toISOString();
    database.exec(readFileSync("migrations/sqlite/0001_initial.sql", "utf8"));
    database.query(`INSERT INTO computers (id, tenant_id, slug, provider, confinement_class, status, owner_principal_id, policy_generation, data_exfiltration_protection, created_at, updated_at)
      VALUES ('cmp_rollback','tenant_rollback','rollback','local_vm','unverified_vm','running','principal_rollback',11,0,?,?)`).run(now, now);
    database.query("INSERT INTO home_leases VALUES ('tenant_rollback','cmp_rollback','holder_rollback',1,?,?)").run(new Date(Date.now() + 60_000).toISOString(), now);
    database.exec("CREATE UNIQUE INDEX operation_attempts_tenant_id_id ON operation_attempts (id)");
    const migrate = database.transaction(() => database.exec(readFileSync("migrations/sqlite/0002_provider_assurance.sql", "utf8")));
    expect(() => migrate.immediate()).toThrow();
    expect(database.query("SELECT confinement_class, status, policy_generation FROM computers WHERE id='cmp_rollback'").get()).toEqual({ confinement_class: "unverified_vm", status: "running", policy_generation: 11 });
    expect(database.query("SELECT count(*) AS count FROM home_leases WHERE computer_id='cmp_rollback'").get()).toEqual({ count: 1 });
    expect(database.query("SELECT max(version) AS version FROM schema_migrations").get()).toEqual({ version: 1 });
    expect(database.query("SELECT 1 FROM pragma_table_info('operation_attempts') WHERE name='execution_owner_token'").get()).toBeNull();
    expect(database.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='provider_assurance'").get()).toBeNull();
    expect(database.query("SELECT 1 FROM sqlite_temp_master WHERE type='table' AND name='provider_assurance_legacy_local_vm'").get()).toBeNull();
    database.close();
  });

  test("corrupted SQLite provider-assurance structure is rejected", () => {
    const directory = mkdtempSync(join(process.cwd(), ".test-data-v2-corrupt-")); temporaryDirectories.push(directory);
    const now = new Date().toISOString();
    const corruptPath = join(directory, "corrupt.db"); const corrupt = new Database(corruptPath); corrupt.exec(readFileSync("migrations/sqlite/0001_initial.sql", "utf8"));
    corrupt.query("INSERT INTO schema_migrations (version, applied_at) VALUES (2, ?)").run(now); corrupt.close();
    expect(() => new SQLiteStorage(corruptPath)).toThrow("Storage initialization failed");

    const missingCheckPath = join(directory, "missing-check.db"); const missingCheck = new Database(missingCheckPath);
    missingCheck.exec(readFileSync("migrations/sqlite/0001_initial.sql", "utf8"));
    missingCheck.exec(readFileSync("migrations/sqlite/0002_provider_assurance.sql", "utf8"));
    missingCheck.exec(`PRAGMA foreign_keys = OFF;
      PRAGMA legacy_alter_table = ON;
      ALTER TABLE computers RENAME TO computers_original;
      CREATE TABLE computers (
        id TEXT NOT NULL, tenant_id TEXT NOT NULL, slug TEXT NOT NULL,
        provider TEXT NOT NULL CHECK (provider IN ('local_machine', 'local_vm', 'aws_ec2')),
        confinement_class TEXT NOT NULL CHECK (1),
        status TEXT NOT NULL CHECK (status IN ('provisioning', 'stopped', 'running', 'quarantined', 'deleting', 'deleted', 'error')),
        owner_principal_id TEXT NOT NULL,
        policy_generation INTEGER NOT NULL DEFAULT 1 CHECK (policy_generation > 0),
        data_exfiltration_protection INTEGER NOT NULL CHECK (data_exfiltration_protection IN (0, 1)),
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        PRIMARY KEY (tenant_id, id), UNIQUE (tenant_id, slug)
      );
      DROP TABLE computers_original;
      CREATE UNIQUE INDEX computers_one_active_owner ON computers (tenant_id, owner_principal_id)
        WHERE status NOT IN ('deleted', 'deleting');
      CREATE UNIQUE INDEX computers_assurance_provider_key ON computers (tenant_id, id, provider);
      CREATE TRIGGER computers_local_vm_unverified_insert
        BEFORE INSERT ON computers WHEN NEW.provider = 'local_vm' AND NEW.confinement_class <> 'unverified_vm'
        BEGIN SELECT RAISE(ABORT, 'stock local_vm must remain unverified_vm'); END;
      CREATE TRIGGER computers_local_vm_unverified_update
        BEFORE UPDATE OF provider, confinement_class ON computers WHEN NEW.provider = 'local_vm' AND NEW.confinement_class <> 'unverified_vm'
        BEGIN SELECT RAISE(ABORT, 'stock local_vm must remain unverified_vm'); END;`);
    missingCheck.query(`INSERT INTO computers
      (id, tenant_id, slug, provider, confinement_class, status, owner_principal_id, policy_generation, data_exfiltration_protection, created_at, updated_at)
      VALUES ('cmp_missing_check', 'tenant_missing_check', 'missing-check', 'local_machine', 'strict_vm', 'stopped', 'principal_missing_check', 1, 0, ?, ?)`).run(now, now);
    missingCheck.close();
    expect(() => new SQLiteStorage(missingCheckPath)).toThrow("Storage initialization failed");
  });

  test("schema readiness rejects a comment-substituted execution owner generation check", () => {
    const directory = mkdtempSync(join(process.cwd(), ".test-data-v2-owner-generation-check-")); temporaryDirectories.push(directory);
    const path = join(directory, "comment-substituted-check.db");
    const database = new Database(path);
    const expectedDefinition = "execution_owner_generation INTEGER NOT NULL DEFAULT 0 CHECK (execution_owner_generation >= 0);";
    const commentSubstitution = "execution_owner_generation INTEGER NOT NULL DEFAULT 0 /* execution_owner_generation INTEGER NOT NULL DEFAULT 0 CHECK (execution_owner_generation >= 0) */;";
    const migration = readFileSync("migrations/sqlite/0002_provider_assurance.sql", "utf8");
    expect(migration.includes(expectedDefinition)).toBe(true);
    database.exec(readFileSync("migrations/sqlite/0001_initial.sql", "utf8"));
    database.exec(migration.replace(expectedDefinition, commentSubstitution));
    const now = new Date().toISOString();
    database.query(`INSERT INTO computers
      (id, tenant_id, slug, provider, confinement_class, status, owner_principal_id, policy_generation, data_exfiltration_protection, created_at, updated_at)
      VALUES ('cmp_owner_generation_probe', 'tenant_owner_generation_probe', 'owner-generation-probe', 'local_machine', 'dedicated_machine', 'stopped', 'principal_owner_generation_probe', 1, 0, ?, ?)`)
      .run(now, now);
    database.query(`INSERT INTO operations
      (id, tenant_id, computer_id, kind, status, policy_generation, idempotency_key, request_json, fence, created_at, updated_at)
      VALUES ('opn_owner_generation_probe', 'tenant_owner_generation_probe', 'cmp_owner_generation_probe', 'create', 'running', 1, 'owner-generation-probe', '{}', 0, ?, ?)`)
      .run(now, now);
    database.query(`INSERT INTO operation_attempts
      (id, tenant_id, operation_id, attempt_number, provider_idempotency_key, status, fence, execution_owner_generation, started_at)
      VALUES ('pat_owner_generation_probe', 'tenant_owner_generation_probe', 'opn_owner_generation_probe', 1, 'provider:owner-generation-probe', 'running', 0, -7, ?)`)
      .run(now);
    expect(database.query("SELECT execution_owner_generation FROM operation_attempts WHERE id = 'pat_owner_generation_probe'").get())
      .toEqual({ execution_owner_generation: -7 });
    database.close();

    expect(() => new SQLiteStorage(path)).toThrow("Storage initialization failed");
  });

  test("provider binding provenance migration preserves valid data and rolls back invalid data", () => {
    const directory = mkdtempSync(join(process.cwd(), ".test-data-v3-provider-bindings-")); temporaryDirectories.push(directory);
    const now = new Date().toISOString();
    const makeV2 = (path: string): Database => {
      const database = new Database(path);
      database.exec("PRAGMA foreign_keys = ON");
      database.exec(readFileSync("migrations/sqlite/0001_initial.sql", "utf8"));
      database.exec(readFileSync("migrations/sqlite/0002_provider_assurance.sql", "utf8"));
      for (const suffix of ["a", "b"]) {
        database.query(`INSERT INTO computers
          (id, tenant_id, slug, provider, confinement_class, status, owner_principal_id, policy_generation, data_exfiltration_protection, created_at, updated_at)
          VALUES (?, 'tenant_binding', ?, 'local_machine', 'dedicated_machine', 'stopped', ?, 1, 0, ?, ?)`)
          .run(`cmp_binding_${suffix}`, `binding-${suffix}`, `principal_binding_${suffix}`, now, now);
        database.query(`INSERT INTO operations
          (id, tenant_id, computer_id, kind, status, policy_generation, idempotency_key, request_json, fence, created_at, updated_at)
          VALUES (?, 'tenant_binding', ?, 'create', 'succeeded', 1, ?, '{}', 0, ?, ?)`)
          .run(`opn_binding_${suffix}`, `cmp_binding_${suffix}`, `binding-create-${suffix}`, now, now);
        database.query(`INSERT INTO operation_attempts
          (id, tenant_id, operation_id, attempt_number, provider_idempotency_key, status, fence, execution_owner_generation, started_at, completed_at)
          VALUES (?, 'tenant_binding', ?, 1, ?, 'succeeded', 0, 0, ?, ?)`)
          .run(`pat_binding_${suffix}`, `opn_binding_${suffix}`, `provider:binding-${suffix}`, now, now);
      }
      return database;
    };

    const validPath = join(directory, "valid.db");
    const valid = makeV2(validPath);
    valid.query(`INSERT INTO provider_bindings
      (tenant_id, computer_id, provider, resource_id, operation_id, attempt_id, state, fence, updated_at)
      VALUES ('tenant_binding','cmp_binding_a','local_machine','resource_binding_a','opn_binding_a','pat_binding_a','active',0,?)`).run(now);
    valid.close();
    const upgraded = new SQLiteStorage(validPath);
    try {
      expect(upgraded.ready()).toBe(true);
      expect(upgraded.getProviderBinding("tenant_binding", "cmp_binding_a")).toMatchObject({
        provider: "local_machine", operationId: "opn_binding_a", attemptId: "pat_binding_a",
      });
      expect(upgraded.database.query("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 3 });
    } finally { upgraded.close(); }

    const invalidPath = join(directory, "invalid.db");
    const invalid = makeV2(invalidPath);
    invalid.query(`INSERT INTO provider_bindings
      (tenant_id, computer_id, provider, resource_id, operation_id, attempt_id, state, fence, updated_at)
      VALUES ('tenant_binding','cmp_binding_a','local_machine','resource_binding_invalid','opn_binding_b','pat_binding_b','active',0,?)`).run(now);
    invalid.close();
    expect(() => new SQLiteStorage(invalidPath)).toThrow("Storage initialization failed");
    const preserved = new Database(invalidPath, { readonly: true, strict: true });
    try {
      expect(preserved.query("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 2 });
      expect(preserved.query("SELECT computer_id, operation_id, attempt_id FROM provider_bindings").get()).toEqual({
        computer_id: "cmp_binding_a", operation_id: "opn_binding_b", attempt_id: "pat_binding_b",
      });
      expect(preserved.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'provider_bindings_v3'").get()).toBeNull();
    } finally { preserved.close(false); }
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
      storage.updateComputerStatus(admin.tenantId, computer.id, "running");
      const attempt = storage.beginProviderAttempt(operation);
      const protocol = new ResidentProtocol(storage);
      storage.setResidentBinding({ tenantId: admin.tenantId, computerId: computer.id, provider: "local_machine", providerResourceId: "resource_policy_fence", instanceId: "instance_policy_fence", bootId: "boot_policy_fence", generation: 1, updatedAt: new Date().toISOString() });
      const enrollment = await protocol.precreateEnrollment(admin.tenantId, computer.id);
      const identity = (await protocol.enroll({ token: enrollment.token, provider: "local_machine", instanceId: "instance_policy_fence", bootId: "boot_policy_fence" })).identity;
      const now = new Date();
      const staleEnvelope: ResidentOperationEnvelope = {
        operationId: operation.id, attemptId: attempt.id, tenantId: admin.tenantId, computerId: computer.id,
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
      const reconcileAbsent = async (): Promise<ProviderOutcome> => { providerCalls += 1; return { kind: "definite_failure", code: "not_found", message: "No external operation exists" }; };
      const fake: ProviderPort = {
        kind: "local_machine", readiness: async () => ({ provider: "local_machine", configured: true, ready: true, confinementClass: "dedicated_machine", controls: {}, limitations: [] }),
        create: unavailable, start: unavailable, stop: unavailable, quarantine: unavailable, delete: unavailable, restore: unavailable, reconcile: reconcileAbsent,
      };
      const providers = createProviderPorts(); providers.local_machine = fake;
      const worker = new OperationWorker(storage, providers);
      expect(await worker.runTenant(admin.tenantId)).toBe(1);
      expect(providerCalls).toBe(0);
      expect(() => storage.completeProviderOperation(operation, attempt, {
        kind: "success", resource: { resourceId: "resource_policy_fence" }, result: { lifecycle: "stopped" },
      })).toThrow("fenced");
      storage.recordProviderUnknown(attempt, {
        kind: "unknown", providerOperationId: attempt.providerIdempotencyKey,
        resource: { resourceId: "resource_policy_fence" }, message: "Original owner observed a fenced provider completion",
      });
      await worker.runTenant(admin.tenantId);
      expect(providerCalls).toBe(1);
      expect(storage.getOperation(admin.tenantId, operation.id)?.errorCode).toBe("policy_generation_mismatch");
    } finally { storage.close(); }
  });

  test("policy mutation racing a provider success preserves observed state and requires reconciliation", async () => {
    const { storage, service, computer } = setup();
    try {
      const initial = storage.listOperations(admin.tenantId, computer.id)[0];
      if (initial === undefined) throw new Error("missing create operation");
      const initialAttempt = storage.beginProviderAttempt(initial);
      storage.completeProviderOperation(initial, initialAttempt, { kind: "success", resource: { resourceId: "resource_policy_race" }, result: { lifecycle: "stopped" } });
      storage.acquireHomeLease(admin.tenantId, computer.id, computer.ownerPrincipalId, "controller_policy_race", 60, 0);
      const start = service.requestLifecycle({ ...ownerFor(computer), scopes: [...owner.scopes, "computers:operate"] }, computer.id, "start", "policy-race-start");
      const success = async (): Promise<ProviderOutcome> => {
        service.createInstallPolicy(admin, computer.id, [{ effect: "deny" }]);
        return { kind: "success", resource: { resourceId: "resource_policy_race" }, result: { lifecycle: "running", started: true } };
      };
      let reconciles = 0; let quarantines = 0;
      const unused = async (): Promise<ProviderOutcome> => ({ kind: "definite_failure", code: "unused", message: "unused" });
      const fake: ProviderPort = {
        kind: "local_machine", readiness: async () => ({ provider: "local_machine", configured: true, ready: true, confinementClass: "dedicated_machine", controls: {}, limitations: [] }),
        create: unused, start: success, stop: unused,
        quarantine: async () => { quarantines += 1; return { kind: "success", resource: { resourceId: "resource_policy_race" }, result: { lifecycle: "quarantined", quarantined: true } }; },
        delete: unused, restore: unused,
        reconcile: async () => { reconciles += 1; return { kind: "success", resource: { resourceId: "resource_policy_race" }, result: { lifecycle: "running", running: true } }; },
      };
      const providers = createProviderPorts(); providers.local_machine = fake;
      const worker = new OperationWorker(storage, providers);
      await worker.runTenant(admin.tenantId);
      expect(storage.getComputer(admin.tenantId, computer.id)?.status).toBe("stopped");
      expect(storage.getOperation(admin.tenantId, start.id)?.status).toBe("unknown");
      expect(storage.getProviderBinding(admin.tenantId, computer.id)?.state).toBe("unknown");
      await worker.runTenant(admin.tenantId);
      expect(reconciles).toBe(1);
      expect(quarantines).toBe(1);
      expect(storage.getOperation(admin.tenantId, start.id)).toMatchObject({ status: "failed", errorCode: "policy_generation_mismatch" });
      expect(storage.getComputer(admin.tenantId, computer.id)?.status).toBe("stopped");
    } finally { storage.close(); }
  });
});
