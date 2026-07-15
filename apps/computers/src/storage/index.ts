import { Database, type SQLQueryBindings } from "bun:sqlite";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { chmodSync, closeSync, constants, existsSync, openSync, readFileSync } from "node:fs";
import {
  ComputersError,
  type AuditCheckpoint,
  type AuditVerification,
  type Computer,
  type ComputerCreateGrant,
  type ComputerStatus,
  type HomeLease,
  type HomeLeaseCapability,
  type InstallPolicyRevision,
  type InstallTicketClaims,
  type Operation,
  type OperationKind,
  type OperationStatus,
  type ProviderAttempt,
  type ProviderBinding,
  type ProviderKind,
  type ProviderOutcome,
  type ResidentBinding,
  type ResidentEnrollment,
  type ResidentIdentity,
  type ResidentOperationEnvelope,
} from "../contracts";

type Row = Record<string, SQLQueryBindings>;

const SQLITE_SCHEMA_VERSION = 1;
const SQLITE_BUSY_TIMEOUT_MS = 250;
const SQLITE_RUNTIME_BUSY_TIMEOUT_MS = 5_000;
const SQLITE_INITIALIZATION_TIMEOUT_MS = 15_000;
const SQLITE_INITIAL_BACKOFF_MS = 2;
const SQLITE_MAX_BACKOFF_MS = 100;

interface SQLiteFailure {
  code?: unknown;
  errno?: unknown;
}

function isSQLiteContention(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const failure = error as SQLiteFailure;
  const code = typeof failure.code === "string" ? failure.code : "";
  const errno = typeof failure.errno === "number" ? failure.errno & 0xff : -1;
  return code === "SQLITE_BUSY" || code.startsWith("SQLITE_BUSY_")
    || code === "SQLITE_LOCKED" || code.startsWith("SQLITE_LOCKED_")
    || errno === 5 || errno === 6;
}

function sleepSync(milliseconds: number): void {
  if (milliseconds <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function preparePersistentDatabaseFile(path: string): void {
  try {
    const descriptor = openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR, 0o600);
    closeSync(descriptor);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  chmodSync(path, 0o600);
}

export interface CreateComputerRecord {
  computer: Computer;
  parentComputerId?: string;
  grantId?: string;
  requestingPrincipalId: string;
  idempotencyKey: string;
  requestHash: string;
}

export interface AuditRecord {
  actorPrincipalId: string;
  action: string;
  data: Record<string, unknown>;
  computerId?: string;
}

export interface MutationResult<T> { value: T; created: boolean; }

export interface StoragePort {
  migrate(): void;
  close(): void;
  ready(): boolean;
  getOrCreateControllerKey(name: string): Uint8Array;
  createComputerGrant(grant: ComputerCreateGrant, audit: AuditRecord): MutationResult<ComputerCreateGrant>;
  getComputerGrant(tenantId: string, id: string): ComputerCreateGrant | undefined;
  listComputerGrants(tenantId: string, principalId?: string): ComputerCreateGrant[];
  createComputer(record: CreateComputerRecord, operation: Operation, policy: InstallPolicyRevision, audit: AuditRecord): MutationResult<Computer>;
  getComputer(tenantId: string, id: string): Computer | undefined;
  listComputers(tenantId: string): Computer[];
  updateComputerStatus(tenantId: string, id: string, status: ComputerStatus): Computer;
  createOperation(operation: Operation, audit: AuditRecord): MutationResult<Operation>;
  getOperation(tenantId: string, id: string): Operation | undefined;
  listOperations(tenantId: string, computerId?: string): Operation[];
  updateOperation(tenantId: string, id: string, status: OperationStatus, result?: Record<string, unknown>, errorCode?: string): Operation;
  beginProviderAttempt(operation: Operation): ProviderAttempt;
  getProviderAttempt(tenantId: string, operationId: string): ProviderAttempt | undefined;
  getProviderBinding(tenantId: string, computerId: string): ProviderBinding | undefined;
  recordProviderUnknown(attempt: ProviderAttempt, outcome: Extract<ProviderOutcome, { kind: "unknown" }>): void;
  completeProviderOperation(operation: Operation, attempt: ProviderAttempt, outcome: Exclude<ProviderOutcome, { kind: "unknown" }>): Operation;
  advanceOperationFence(tenantId: string, operationId: string, expectedFence: number): number;
  assertOperationPolicyCurrent(tenantId: string, operationId: string): void;
  failOperationPolicyFence(tenantId: string, operationId: string): Operation;
  releaseChildReservation(tenantId: string, childComputerId: string): void;
  acquireHomeLease(tenantId: string, computerId: string, expectedOwnerPrincipalId: string, holderId: string, ttlSeconds: number, expectedFence?: number): HomeLease;
  assertHomeFence(tenantId: string, computerId: string, holderId: string, fence: number): void;
  getHomeLeaseCapability(tenantId: string, computerId: string): HomeLeaseCapability | undefined;
  setOperationHomeLease(operationId: string, capability: HomeLeaseCapability): void;
  getOperationHomeLease(tenantId: string, operationId: string): HomeLeaseCapability | undefined;
  assertHomeLeaseCapability(capability: HomeLeaseCapability): void;
  setResidentBinding(binding: Omit<ResidentBinding, "updatedAt"> & { updatedAt?: string }): ResidentBinding;
  getResidentBinding(tenantId: string, computerId: string): ResidentBinding | undefined;
  createEnrollment(enrollment: ResidentEnrollment): ResidentEnrollment;
  consumeEnrollment(tokenHash: string, provider: ProviderKind, instanceId: string, bootId: string, now: string): ResidentEnrollment;
  saveResidentIdentity(identity: ResidentIdentity): void;
  getResidentIdentity(certificateId: string): ResidentIdentity | undefined;
  revokeResidentIdentity(certificateId: string, revokedAt: string): void;
  acceptResidentEnvelope(envelope: ResidentOperationEnvelope, now: string): void;
  createInstallPolicy(revision: InstallPolicyRevision, audit?: AuditRecord): InstallPolicyRevision;
  getInstallPolicy(tenantId: string, computerId: string, generation?: number): InstallPolicyRevision | undefined;
  saveInstallTicket(claims: InstallTicketClaims, signature: string, audit: AuditRecord): void;
  consumeInstallTicketAndCreateOperation(claims: InstallTicketClaims, signature: string, now: string, operation: Operation, audit: AuditRecord): MutationResult<Operation>;
  appendAudit(tenantId: string, actorPrincipalId: string, action: string, data: Record<string, unknown>, computerId?: string): void;
  currentAuditCheckpoint(tenantId: string): AuditCheckpoint | undefined;
  verifyAuditChain(tenantId: string, checkpoint?: AuditCheckpoint): AuditVerification;
}

export function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}

export function sha256(value: unknown): string {
  return `sha256:${createHash("sha256").update(typeof value === "string" ? value : stableJson(value)).digest("hex")}`;
}

export function makeId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 24)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function parseJson(value: unknown): Record<string, unknown> {
  return JSON.parse(String(value)) as Record<string, unknown>;
}

function computerFromRow(row: Row): Computer {
  return {
    id: String(row.id), tenantId: String(row.tenant_id), slug: String(row.slug), provider: String(row.provider) as Computer["provider"],
    confinementClass: String(row.confinement_class) as Computer["confinementClass"], status: String(row.status) as ComputerStatus,
    ownerPrincipalId: String(row.owner_principal_id), policyGeneration: Number(row.policy_generation),
    dataExfiltrationProtection: Boolean(row.data_exfiltration_protection), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

function operationFromRow(row: Row): Operation {
  const operation: Operation = {
    id: String(row.id), tenantId: String(row.tenant_id), computerId: String(row.computer_id), kind: String(row.kind) as OperationKind,
    status: String(row.status) as OperationStatus, policyGeneration: Number(row.policy_generation), idempotencyKey: String(row.idempotency_key),
    request: parseJson(row.request_json), fence: Number(row.fence), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
  if (row.prior_computer_status !== null && row.prior_computer_status !== undefined) operation.priorComputerStatus = String(row.prior_computer_status) as ComputerStatus;
  if (row.desired_computer_status !== null && row.desired_computer_status !== undefined) operation.desiredComputerStatus = String(row.desired_computer_status) as ComputerStatus;
  if (row.result_json !== null && row.result_json !== undefined) operation.result = parseJson(row.result_json);
  if (row.error_code !== null && row.error_code !== undefined) operation.errorCode = String(row.error_code);
  return operation;
}

function enrollmentFromRow(row: Row): ResidentEnrollment {
  const value: ResidentEnrollment = {
    id: String(row.id), tenantId: String(row.tenant_id), computerId: String(row.computer_id), expectedProvider: String(row.expected_provider) as ProviderKind,
    expectedInstanceId: String(row.expected_instance_id), expectedBootId: String(row.expected_boot_id), bindingGeneration: Number(row.binding_generation),
    tokenHash: String(row.token_hash), expiresAt: String(row.expires_at),
  };
  if (row.used_at !== null && row.used_at !== undefined) value.usedAt = String(row.used_at);
  return value;
}

function bindingFromRow(row: Row): ResidentBinding {
  return {
    tenantId: String(row.tenant_id), computerId: String(row.computer_id), provider: String(row.provider) as ProviderKind,
    providerResourceId: String(row.provider_resource_id), instanceId: String(row.instance_id), bootId: String(row.boot_id),
    generation: Number(row.generation), updatedAt: String(row.updated_at),
  };
}

function attemptFromRow(row: Row): ProviderAttempt {
  const attempt: ProviderAttempt = {
    id: String(row.id), tenantId: String(row.tenant_id), operationId: String(row.operation_id), attemptNumber: Number(row.attempt_number),
    providerIdempotencyKey: String(row.provider_idempotency_key), status: String(row.status) as ProviderAttempt["status"],
    fence: Number(row.fence), startedAt: String(row.started_at),
  };
  if (row.provider_operation_id !== null && row.provider_operation_id !== undefined) attempt.providerOperationId = String(row.provider_operation_id);
  if (row.resource_json !== null && row.resource_json !== undefined) attempt.resource = JSON.parse(String(row.resource_json)) as NonNullable<ProviderAttempt["resource"]>;
  if (row.completed_at !== null && row.completed_at !== undefined) attempt.completedAt = String(row.completed_at);
  return attempt;
}

function providerBindingFromRow(row: Row): ProviderBinding {
  const resource: ProviderBinding["resource"] = { resourceId: String(row.resource_id) };
  if (row.instance_id !== null && row.instance_id !== undefined) resource.instanceId = String(row.instance_id);
  if (row.boot_id !== null && row.boot_id !== undefined) resource.bootId = String(row.boot_id);
  return {
    tenantId: String(row.tenant_id), computerId: String(row.computer_id), provider: String(row.provider) as ProviderKind,
    resource, operationId: String(row.operation_id), attemptId: String(row.attempt_id),
    state: String(row.state) as ProviderBinding["state"], fence: Number(row.fence), updatedAt: String(row.updated_at),
  };
}

function identityFromRow(row: Row): ResidentIdentity {
  const value: ResidentIdentity = {
    certificateId: String(row.certificate_id), tenantId: String(row.tenant_id), computerId: String(row.computer_id),
    provider: String(row.provider) as ProviderKind, instanceId: String(row.instance_id), bootId: String(row.boot_id), generation: Number(row.generation),
    bindingGeneration: Number(row.binding_generation), issuedAt: String(row.issued_at), expiresAt: String(row.expires_at),
  };
  if (row.revoked_at !== null && row.revoked_at !== undefined) value.revokedAt = String(row.revoked_at);
  return value;
}

function grantFromRow(row: Row): ComputerCreateGrant {
  const grant: ComputerCreateGrant = {
    id: String(row.id), tenantId: String(row.tenant_id), principalId: String(row.principal_id),
    ownerPrincipalId: String(row.owner_principal_id), parentComputerId: String(row.parent_computer_id),
    allowedProviders: JSON.parse(String(row.allowed_providers_json)) as ProviderKind[], limit: Number(row.limit_count),
    allowedChildOwnerPrincipalIds: JSON.parse(String(row.allowed_child_owners_json)) as string[],
    allowedRegions: JSON.parse(String(row.allowed_regions_json)) as string[], allowedProfileIds: JSON.parse(String(row.allowed_profile_ids_json)) as string[],
    maxStorageGiB: Number(row.max_storage_gib), maxUptimeSeconds: Number(row.max_uptime_seconds), maxBudgetMicros: Number(row.max_budget_micros),
    active: Boolean(row.active), generation: Number(row.generation), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
  if (row.expires_at !== null && row.expires_at !== undefined) grant.expiresAt = String(row.expires_at);
  return grant;
}

function constantTimeDigestEqual(left: string, right: string): boolean {
  if (!/^sha256:[a-f0-9]{64}$/.test(left) || !/^sha256:[a-f0-9]{64}$/.test(right)) return false;
  return timingSafeEqual(Buffer.from(left.slice(7), "hex"), Buffer.from(right.slice(7), "hex"));
}

export class SQLiteStorage implements StoragePort {
  readonly database: Database;
  readonly #persistent: boolean;
  readonly #path: string;

  constructor(path = ":memory:") {
    this.#path = path;
    this.#persistent = path !== ":memory:";
    if (this.#persistent) preparePersistentDatabaseFile(path);
    this.database = new Database(path, { create: true, strict: true });
    try {
      this.database.exec(`PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);
      this.#initializeAndVerify();
    } catch (error) {
      try { this.database.close(false); } catch { /* preserve the initialization failure */ }
      this.#protectControllerFiles();
      if (error instanceof ComputersError) throw error;
      throw new ComputersError("storage_error", "Storage initialization failed", 500);
    }
  }

  migrate(): void {
    this.#initializeAndVerify();
  }

  #initializeAndVerify(): void {
    const deadline = performance.now() + SQLITE_INITIALIZATION_TIMEOUT_MS;
    this.database.exec(`PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);
    this.database.exec("PRAGMA foreign_keys = ON");

    if (this.#persistent) {
      let journal = this.#withContentionRetry(() => this.database.query("PRAGMA journal_mode").get() as Row | null, deadline);
      if (journal === null || String(journal.journal_mode).toLowerCase() !== "wal") {
        journal = this.#withContentionRetry(() => this.database.query("PRAGMA journal_mode = WAL").get() as Row | null, deadline);
      }
      if (journal === null || String(journal.journal_mode).toLowerCase() !== "wal") throw new ComputersError("storage_error", "Storage initialization failed", 500);
    }
    this.#withContentionRetry(() => this.database.exec("PRAGMA synchronous = FULL"), deadline);

    const sourceUrl = new URL("../../migrations/sqlite/0001_initial.sql", import.meta.url);
    const packedUrl = new URL("../migrations/sqlite/0001_initial.sql", import.meta.url);
    const migrationUrl = existsSync(sourceUrl) ? sourceUrl : packedUrl;
    const migration = readFileSync(migrationUrl, "utf8");
    const transaction = this.database.transaction(() => {
      const table = this.database.query("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").get() as Row | null;
      if (table !== null) {
        const current = this.database.query("SELECT MAX(version) AS version FROM schema_migrations").get() as Row | null;
        if (current !== null && Number(current.version) === SQLITE_SCHEMA_VERSION) return;
      }
      this.database.exec(migration);
    });
    if (!this.#schemaIsCurrent(deadline)) this.#withContentionRetry(() => transaction.immediate(), deadline);
    this.#verifyConnection(deadline);
    this.database.exec(`PRAGMA busy_timeout = ${SQLITE_RUNTIME_BUSY_TIMEOUT_MS}`);
    this.#protectControllerFiles();
  }

  close(): void { this.database.close(false); }

  ready(): boolean {
    try {
      const journal = this.database.query("PRAGMA journal_mode").get() as Row | null;
      const foreignKeys = this.database.query("PRAGMA foreign_keys").get() as Row | null;
      const migration = this.database.query("SELECT MAX(version) AS version FROM schema_migrations").get() as Row | null;
      const integrity = this.database.query("PRAGMA integrity_check").get() as Row | null;
      const expectedJournal = this.#persistent ? "wal" : "memory";
      return journal !== null && String(journal.journal_mode).toLowerCase() === expectedJournal
        && foreignKeys !== null && Number(foreignKeys.foreign_keys) === 1
        && migration !== null && Number(migration.version) === SQLITE_SCHEMA_VERSION
        && integrity !== null && Object.values(integrity)[0] === "ok";
    } catch { return false; }
  }

  getOrCreateControllerKey(name: string): Uint8Array {
    if (!this.#persistent) throw new ComputersError("authentication_required", "Controller signing key configuration is required", 500);
    if (!/^[a-z][a-z0-9_]{2,63}$/.test(name)) throw new ComputersError("invalid_request", "Invalid controller key name", 500);
    const transaction = this.database.transaction(() => {
      const existing = this.database.query("SELECT key_material FROM controller_keys WHERE name = ?").get(name) as Row | null;
      if (existing !== null && existing.key_material instanceof Uint8Array) return new Uint8Array(existing.key_material);
      const key = randomBytes(32);
      this.database.query("INSERT INTO controller_keys (name, key_material, created_at) VALUES (?, ?, ?)").run(name, key, nowIso());
      this.#protectControllerFiles();
      return new Uint8Array(key);
    });
    return transaction.immediate();
  }

  createComputerGrant(grant: ComputerCreateGrant, audit: AuditRecord): MutationResult<ComputerCreateGrant> {
    const transaction = this.database.transaction(() => {
      try {
        this.database.query(`INSERT INTO computer_create_grants
          (tenant_id, id, principal_id, owner_principal_id, parent_computer_id, allowed_providers_json,
           allowed_child_owners_json, allowed_regions_json, allowed_profile_ids_json, max_storage_gib, max_uptime_seconds, max_budget_micros,
           limit_count, active, generation, expires_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          grant.tenantId, grant.id, grant.principalId, grant.ownerPrincipalId, grant.parentComputerId, stableJson(grant.allowedProviders),
          stableJson(grant.allowedChildOwnerPrincipalIds), stableJson(grant.allowedRegions), stableJson(grant.allowedProfileIds),
          grant.maxStorageGiB, grant.maxUptimeSeconds, grant.maxBudgetMicros, grant.limit, grant.active ? 1 : 0, grant.generation,
          grant.expiresAt ?? null, grant.createdAt, grant.updatedAt,
        );
      } catch (error) {
        if (String(error).includes("UNIQUE constraint failed")) throw new ComputersError("conflict", "An active Computer creation grant already exists", 409);
        throw error;
      }
      this.#appendAuditInTransaction(grant.tenantId, audit);
      return { value: grant, created: true };
    });
    return transaction.immediate();
  }

  getComputerGrant(tenantId: string, id: string): ComputerCreateGrant | undefined {
    const row = this.database.query("SELECT * FROM computer_create_grants WHERE tenant_id = ? AND id = ?").get(tenantId, id) as Row | null;
    return row === null ? undefined : grantFromRow(row);
  }

  listComputerGrants(tenantId: string, principalId?: string): ComputerCreateGrant[] {
    const rows = principalId === undefined
      ? this.database.query("SELECT * FROM computer_create_grants WHERE tenant_id = ? ORDER BY created_at, id").all(tenantId)
      : this.database.query("SELECT * FROM computer_create_grants WHERE tenant_id = ? AND principal_id = ? ORDER BY created_at, id").all(tenantId, principalId);
    return (rows as Row[]).map(grantFromRow);
  }

  createComputer(record: CreateComputerRecord, operation: Operation, policy: InstallPolicyRevision, audit: AuditRecord): MutationResult<Computer> {
    const transaction = this.database.transaction(() => {
      const existing = this.database.query("SELECT request_hash, response_json FROM idempotency_keys WHERE tenant_id = ? AND namespace = 'computer:create' AND idempotency_key = ?").get(record.computer.tenantId, record.idempotencyKey) as Row | null;
      if (existing !== null) {
        if (existing.request_hash !== record.requestHash) throw new ComputersError("conflict", "Idempotency key was used with a different request", 409);
        return { value: JSON.parse(String(existing.response_json)) as Computer, created: false };
      }
      if (record.parentComputerId !== undefined) {
        if (record.grantId === undefined) throw new ComputersError("authorization_denied", "Authorization denied", 403);
        const parent = this.database.query("SELECT id, owner_principal_id, policy_generation FROM computers WHERE tenant_id = ? AND id = ? AND status NOT IN ('deleted','deleting')").get(record.computer.tenantId, record.parentComputerId) as Row | null;
        if (parent === null) throw new ComputersError("authorization_denied", "Authorization denied", 403);
        const grant = this.database.query(`SELECT * FROM computer_create_grants
          WHERE tenant_id = ? AND id = ? AND principal_id = ? AND owner_principal_id = ? AND parent_computer_id = ? AND active = 1 AND generation = ?`)
          .get(record.computer.tenantId, record.grantId, record.requestingPrincipalId, String(parent.owner_principal_id), record.parentComputerId, Number(parent.policy_generation)) as Row | null;
        if (grant === null || (grant.expires_at !== null && Date.parse(String(grant.expires_at)) <= Date.parse(record.computer.createdAt))) {
          throw new ComputersError("authorization_denied", "Authorization denied", 403);
        }
        const allowedProviders = JSON.parse(String(grant.allowed_providers_json)) as ProviderKind[];
        const childOwners = JSON.parse(String(grant.allowed_child_owners_json)) as string[];
        const regions = JSON.parse(String(grant.allowed_regions_json)) as string[];
        const profiles = JSON.parse(String(grant.allowed_profile_ids_json)) as string[];
        const request = operation.request;
        if (!allowedProviders.includes(record.computer.provider) || !childOwners.includes(record.computer.ownerPrincipalId)
          || !regions.includes(String(request.region)) || !profiles.includes(String(request.profileId))
          || Number(request.storageGiB) > Number(grant.max_storage_gib) || Number(request.uptimeSeconds) > Number(grant.max_uptime_seconds)
          || Number(request.budgetMicros) > Number(grant.max_budget_micros)) throw new ComputersError("authorization_denied", "Authorization denied", 403);
        const count = this.database.query("SELECT COUNT(*) AS count FROM child_reservations WHERE tenant_id = ? AND grant_id = ? AND state IN ('reserved','active')")
          .get(record.computer.tenantId, record.grantId) as Row;
        if (Number(count.count) >= Number(grant.limit_count)) throw new ComputersError("quota_exceeded", "Computer creation quota exceeded", 409);
      } else if (record.grantId !== undefined) {
        throw new ComputersError("invalid_request", "A grant requires a parent Computer", 400);
      }
      try {
        this.database.query(`INSERT INTO computers (id, tenant_id, slug, provider, confinement_class, status, owner_principal_id, policy_generation, data_exfiltration_protection, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(record.computer.id, record.computer.tenantId, record.computer.slug, record.computer.provider,
          record.computer.confinementClass, record.computer.status, record.computer.ownerPrincipalId, record.computer.policyGeneration,
          record.computer.dataExfiltrationProtection ? 1 : 0, record.computer.createdAt, record.computer.updatedAt);
        this.database.query("INSERT INTO assignments (id, tenant_id, computer_id, principal_id, active, generation, created_at) VALUES (?, ?, ?, ?, 1, 1, ?)")
          .run(makeId("asn"), record.computer.tenantId, record.computer.id, record.computer.ownerPrincipalId, record.computer.createdAt);
        if (record.parentComputerId !== undefined) {
          this.database.query("INSERT INTO child_reservations (id, tenant_id, parent_computer_id, grant_id, child_computer_id, idempotency_key, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)")
            .run(makeId("res"), record.computer.tenantId, record.parentComputerId, record.grantId ?? "", record.computer.id, record.idempotencyKey, record.computer.createdAt, record.computer.updatedAt);
        }
      } catch (error) {
        if (String(error).includes("UNIQUE constraint failed")) throw new ComputersError("conflict", "Computer conflicts with an active assignment or slug", 409);
        throw error;
      }
      const expiresAt = new Date(Date.parse(record.computer.createdAt) + 24 * 60 * 60 * 1000).toISOString();
      this.database.query("INSERT INTO idempotency_keys (tenant_id, namespace, idempotency_key, request_hash, response_json, created_at, expires_at) VALUES (?, 'computer:create', ?, ?, ?, ?, ?)")
        .run(record.computer.tenantId, record.idempotencyKey, record.requestHash, stableJson(record.computer), record.computer.createdAt, expiresAt);
      this.database.query("INSERT INTO install_policy_revisions (id, tenant_id, computer_id, generation, digest, rules_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(policy.id, policy.tenantId, policy.computerId, policy.generation, policy.digest, stableJson(policy.rules), policy.createdAt);
      this.#insertOperation(operation);
      this.#appendAuditInTransaction(record.computer.tenantId, audit);
      return { value: record.computer, created: true };
    });
    return transaction.immediate();
  }

  getComputer(tenantId: string, id: string): Computer | undefined {
    const row = this.database.query("SELECT * FROM computers WHERE tenant_id = ? AND id = ?").get(tenantId, id) as Row | null;
    return row === null ? undefined : computerFromRow(row);
  }

  listComputers(tenantId: string): Computer[] {
    return (this.database.query("SELECT * FROM computers WHERE tenant_id = ? AND status != 'deleted' ORDER BY created_at, id").all(tenantId) as Row[]).map(computerFromRow);
  }

  updateComputerStatus(tenantId: string, id: string, status: ComputerStatus): Computer {
    const updatedAt = nowIso();
    const result = this.database.query("UPDATE computers SET status = ?, updated_at = ? WHERE tenant_id = ? AND id = ?").run(status, updatedAt, tenantId, id);
    if (result.changes !== 1) throw new ComputersError("not_found", "Computer not found", 404);
    const computer = this.getComputer(tenantId, id);
    if (computer === undefined) throw new ComputersError("storage_error", "Storage consistency error", 500);
    return computer;
  }

  createOperation(operation: Operation, audit: AuditRecord): MutationResult<Operation> {
    const transaction = this.database.transaction(() => {
      const existing = this.database.query("SELECT * FROM operations WHERE tenant_id = ? AND computer_id = ? AND kind = ? AND idempotency_key = ?")
        .get(operation.tenantId, operation.computerId, operation.kind, operation.idempotencyKey) as Row | null;
      if (existing !== null) {
        const value = operationFromRow(existing);
        if (stableJson(value.request) !== stableJson(operation.request)) throw new ComputersError("conflict", "Idempotency key was used with a different request", 409);
        return { value, created: false };
      }
      this.#insertOperation(operation);
      this.#appendAuditInTransaction(operation.tenantId, audit);
      return { value: operation, created: true };
    });
    return transaction.immediate();
  }

  getOperation(tenantId: string, id: string): Operation | undefined {
    const row = this.database.query("SELECT * FROM operations WHERE tenant_id = ? AND id = ?").get(tenantId, id) as Row | null;
    return row === null ? undefined : operationFromRow(row);
  }

  listOperations(tenantId: string, computerId?: string): Operation[] {
    const rows = computerId === undefined
      ? this.database.query("SELECT * FROM operations WHERE tenant_id = ? ORDER BY created_at, id").all(tenantId)
      : this.database.query("SELECT * FROM operations WHERE tenant_id = ? AND computer_id = ? ORDER BY created_at, id").all(tenantId, computerId);
    return (rows as Row[]).map(operationFromRow);
  }

  updateOperation(tenantId: string, id: string, status: OperationStatus, result?: Record<string, unknown>, errorCode?: string): Operation {
    const updatedAt = nowIso();
    const outcome = this.database.query("UPDATE operations SET status = ?, result_json = ?, error_code = ?, updated_at = ? WHERE tenant_id = ? AND id = ?")
      .run(status, result === undefined ? null : stableJson(result), errorCode ?? null, updatedAt, tenantId, id);
    if (outcome.changes !== 1) throw new ComputersError("not_found", "Operation not found", 404);
    const operation = this.getOperation(tenantId, id);
    if (operation === undefined) throw new ComputersError("storage_error", "Storage consistency error", 500);
    return operation;
  }

  beginProviderAttempt(operation: Operation): ProviderAttempt {
    const transaction = this.database.transaction(() => {
      const existing = this.database.query("SELECT * FROM operation_attempts WHERE tenant_id = ? AND operation_id = ? ORDER BY attempt_number DESC LIMIT 1")
        .get(operation.tenantId, operation.id) as Row | null;
      if (existing !== null) return attemptFromRow(existing);
      const now = nowIso();
      const attempt: ProviderAttempt = {
        id: makeId("pat"), tenantId: operation.tenantId, operationId: operation.id, attemptNumber: 1,
        providerIdempotencyKey: `provider:${operation.id}`, status: "running", fence: operation.fence, startedAt: now,
      };
      this.database.query(`INSERT INTO operation_attempts
        (id, tenant_id, operation_id, attempt_number, provider_idempotency_key, status, fence, started_at)
        VALUES (?, ?, ?, ?, ?, 'running', ?, ?)`).run(attempt.id, attempt.tenantId, attempt.operationId, attempt.attemptNumber,
        attempt.providerIdempotencyKey, attempt.fence, attempt.startedAt);
      this.database.query("UPDATE operations SET status = 'running', updated_at = ? WHERE tenant_id = ? AND id = ? AND status IN ('pending','accepted')")
        .run(now, operation.tenantId, operation.id);
      return attempt;
    });
    return transaction.immediate();
  }

  getProviderAttempt(tenantId: string, operationId: string): ProviderAttempt | undefined {
    const row = this.database.query("SELECT * FROM operation_attempts WHERE tenant_id = ? AND operation_id = ? ORDER BY attempt_number DESC LIMIT 1")
      .get(tenantId, operationId) as Row | null;
    return row === null ? undefined : attemptFromRow(row);
  }

  getProviderBinding(tenantId: string, computerId: string): ProviderBinding | undefined {
    const row = this.database.query("SELECT * FROM provider_bindings WHERE tenant_id = ? AND computer_id = ?").get(tenantId, computerId) as Row | null;
    return row === null ? undefined : providerBindingFromRow(row);
  }

  recordProviderUnknown(attempt: ProviderAttempt, outcome: Extract<ProviderOutcome, { kind: "unknown" }>): void {
    const transaction = this.database.transaction(() => {
      const now = nowIso();
      const current = this.database.query(`SELECT a.status AS attempt_status, a.operation_id, a.fence AS attempt_fence,
        o.computer_id, o.kind, o.status AS operation_status, c.provider
        FROM operation_attempts a JOIN operations o ON o.tenant_id = a.tenant_id AND o.id = a.operation_id
        JOIN computers c ON c.tenant_id = o.tenant_id AND c.id = o.computer_id
        WHERE a.tenant_id = ? AND a.id = ?`).get(attempt.tenantId, attempt.id) as Row | null;
      if (current === null || current.operation_id !== attempt.operationId || Number(current.attempt_fence) !== attempt.fence
        || !["running", "unknown"].includes(String(current.attempt_status))) throw new ComputersError("conflict", "Provider attempt is not reconcilable", 409);
      const firstUnknown = current.attempt_status === "running";
      this.database.query("UPDATE operation_attempts SET status = 'unknown', provider_operation_id = ?, resource_json = ? WHERE tenant_id = ? AND id = ? AND status IN ('running','unknown')")
        .run(outcome.providerOperationId, outcome.resource === undefined ? null : stableJson(outcome.resource), attempt.tenantId, attempt.id);
      this.database.query("UPDATE operations SET status = 'unknown', error_code = 'provider_outcome_unknown', updated_at = ? WHERE tenant_id = ? AND id = ? AND status IN ('running','unknown')")
        .run(now, attempt.tenantId, attempt.operationId);
      if (outcome.resource !== undefined) this.#upsertProviderBindingInTransaction({
        tenantId: attempt.tenantId, computerId: String(current.computer_id), provider: String(current.provider) as ProviderKind,
        resource: outcome.resource, operationId: attempt.operationId, attemptId: attempt.id, state: "unknown", fence: attempt.fence, updatedAt: now,
      });
      if (firstUnknown) this.#appendAuditInTransaction(attempt.tenantId, {
        actorPrincipalId: "principal_worker", action: `computer.${String(current.kind)}.unknown`,
        data: { operationId: attempt.operationId, attemptId: attempt.id, providerOperationId: outcome.providerOperationId }, computerId: String(current.computer_id),
      });
    });
    transaction.immediate();
  }

  completeProviderOperation(operation: Operation, attempt: ProviderAttempt, outcome: Exclude<ProviderOutcome, { kind: "unknown" }>): Operation {
    const transaction = this.database.transaction(() => {
      const now = nowIso();
      const success = outcome.kind === "success";
      const result = success ? outcome.result : undefined;
      const errorCode = success ? null : outcome.code;
      const current = this.database.query(`SELECT a.status AS attempt_status, a.operation_id, a.fence AS attempt_fence,
        o.status AS operation_status, o.fence AS operation_fence, o.policy_generation AS operation_generation,
        c.policy_generation AS computer_generation, c.provider
        FROM operation_attempts a JOIN operations o ON o.tenant_id = a.tenant_id AND o.id = a.operation_id
        JOIN computers c ON c.tenant_id = o.tenant_id AND c.id = o.computer_id
        WHERE a.tenant_id = ? AND a.id = ?`).get(attempt.tenantId, attempt.id) as Row | null;
      if (current === null || current.operation_id !== operation.id || Number(current.attempt_fence) !== attempt.fence) {
        throw new ComputersError("conflict", "Provider attempt does not match operation", 409);
      }
      if (["succeeded", "failed"].includes(String(current.attempt_status))) {
        const existing = this.getOperation(operation.tenantId, operation.id);
        if (existing === undefined) throw new ComputersError("storage_error", "Storage consistency error", 500);
        return existing;
      }
      if (Number(current.operation_generation) !== Number(current.computer_generation) || Number(current.operation_fence) !== attempt.fence) {
        if (!success) {
          this.database.query("UPDATE operation_attempts SET status = 'failed', resource_json = ?, completed_at = ? WHERE tenant_id = ? AND id = ? AND status IN ('running','unknown')")
            .run(outcome.resource === undefined ? null : stableJson(outcome.resource), now, attempt.tenantId, attempt.id);
          this.database.query("UPDATE operations SET status = 'failed', error_code = 'policy_generation_mismatch', updated_at = ? WHERE tenant_id = ? AND id = ? AND status IN ('running','unknown')")
            .run(now, operation.tenantId, operation.id);
          this.#appendAuditInTransaction(operation.tenantId, {
            actorPrincipalId: "principal_worker", action: `computer.${operation.kind}.failed`,
            data: { operationId: operation.id, attemptId: attempt.id, outcome: outcome.kind, fenced: true }, computerId: operation.computerId,
          });
          const fenced = this.getOperation(operation.tenantId, operation.id);
          if (fenced === undefined) throw new ComputersError("storage_error", "Storage consistency error", 500);
          return fenced;
        }
        throw new ComputersError("policy_generation_mismatch", "Provider result is fenced by a newer policy generation", 409);
      }
      const attemptUpdate = this.database.query("UPDATE operation_attempts SET status = ?, resource_json = ?, completed_at = ? WHERE tenant_id = ? AND id = ? AND status IN ('running','unknown')")
        .run(success ? "succeeded" : "failed", outcome.resource === undefined ? null : stableJson(outcome.resource), now, attempt.tenantId, attempt.id);
      if (attemptUpdate.changes !== 1) throw new ComputersError("conflict", "Provider attempt was completed concurrently", 409);
      const operationUpdate = this.database.query("UPDATE operations SET status = ?, result_json = ?, error_code = ?, updated_at = ? WHERE tenant_id = ? AND id = ? AND status IN ('running','unknown') AND fence = ? AND policy_generation = ?")
        .run(success ? "succeeded" : "failed", result === undefined ? null : stableJson(result), errorCode, now, operation.tenantId, operation.id, attempt.fence, operation.policyGeneration);
      if (operationUpdate.changes !== 1) throw new ComputersError("conflict", "Operation was completed concurrently", 409);
      if (success && operation.desiredComputerStatus !== undefined) {
        this.database.query("UPDATE computers SET status = ?, updated_at = ? WHERE tenant_id = ? AND id = ?")
          .run(operation.desiredComputerStatus, now, operation.tenantId, operation.computerId);
      } else if (!success && operation.priorComputerStatus !== undefined) {
        const failedStatus = operation.kind === "create" ? "error" : operation.priorComputerStatus;
        this.database.query("UPDATE computers SET status = ?, updated_at = ? WHERE tenant_id = ? AND id = ?")
          .run(failedStatus, now, operation.tenantId, operation.computerId);
      }
      const bindingResource = outcome.resource ?? this.getProviderBinding(operation.tenantId, operation.computerId)?.resource;
      if (bindingResource !== undefined) this.#upsertProviderBindingInTransaction({
        tenantId: operation.tenantId, computerId: operation.computerId, provider: String(current.provider) as ProviderKind,
        resource: bindingResource, operationId: operation.id, attemptId: attempt.id,
        state: success ? (operation.kind === "delete" ? "released" : "active") : (operation.kind === "create" ? "released" : this.getProviderBinding(operation.tenantId, operation.computerId)?.state ?? "released"),
        fence: attempt.fence, updatedAt: now,
      });
      if (success && operation.kind === "create" && outcome.resource !== undefined && outcome.resource.instanceId !== undefined && outcome.resource.bootId !== undefined) {
        this.#setResidentBindingInTransaction({
          tenantId: operation.tenantId, computerId: operation.computerId,
          provider: String(operation.request.provider) as ProviderKind, providerResourceId: outcome.resource.resourceId,
          instanceId: outcome.resource.instanceId, bootId: outcome.resource.bootId, generation: operation.policyGeneration, updatedAt: now,
        });
      }
      if (!success && operation.kind === "create") {
        this.database.query("UPDATE child_reservations SET state = 'released', updated_at = ? WHERE tenant_id = ? AND child_computer_id = ? AND state IN ('reserved','active')")
          .run(now, operation.tenantId, operation.computerId);
      }
      this.#appendAuditInTransaction(operation.tenantId, {
        actorPrincipalId: "principal_worker", action: success ? `computer.${operation.kind}.succeeded` : `computer.${operation.kind}.failed`,
        data: { operationId: operation.id, attemptId: attempt.id, outcome: outcome.kind }, computerId: operation.computerId,
      });
      const updated = this.getOperation(operation.tenantId, operation.id);
      if (updated === undefined) throw new ComputersError("storage_error", "Storage consistency error", 500);
      return updated;
    });
    return transaction.immediate();
  }

  advanceOperationFence(tenantId: string, operationId: string, expectedFence: number): number {
    const outcome = this.database.query("UPDATE operations SET fence = fence + 1, updated_at = ? WHERE tenant_id = ? AND id = ? AND fence = ?")
      .run(nowIso(), tenantId, operationId, expectedFence);
    if (outcome.changes !== 1) throw new ComputersError("stale_fence", "Stale operation fence", 409);
    return expectedFence + 1;
  }

  assertOperationPolicyCurrent(tenantId: string, operationId: string): void {
    const row = this.database.query(`SELECT o.policy_generation AS operation_generation, c.policy_generation AS computer_generation
      FROM operations o JOIN computers c ON c.tenant_id = o.tenant_id AND c.id = o.computer_id
      WHERE o.tenant_id = ? AND o.id = ?`).get(tenantId, operationId) as Row | null;
    if (row === null) throw new ComputersError("not_found", "Operation not found", 404);
    if (Number(row.operation_generation) !== Number(row.computer_generation)) {
      throw new ComputersError("policy_generation_mismatch", "Policy generation changed before operation execution", 409);
    }
  }

  failOperationPolicyFence(tenantId: string, operationId: string): Operation {
    const transaction = this.database.transaction(() => {
      const row = this.database.query(`SELECT o.status, o.error_code, o.kind, o.computer_id,
        o.policy_generation AS operation_generation, c.policy_generation AS computer_generation
        FROM operations o JOIN computers c ON c.tenant_id = o.tenant_id AND c.id = o.computer_id
        WHERE o.tenant_id = ? AND o.id = ?`).get(tenantId, operationId) as Row | null;
      if (row === null) throw new ComputersError("not_found", "Operation not found", 404);
      if (row.status === "failed" && row.error_code === "policy_generation_mismatch") {
        const existing = this.getOperation(tenantId, operationId);
        if (existing === undefined) throw new ComputersError("storage_error", "Storage consistency error", 500);
        return existing;
      }
      if (Number(row.operation_generation) === Number(row.computer_generation)) {
        throw new ComputersError("conflict", "Operation policy generation is current", 409);
      }
      if (!["pending", "accepted", "running", "unknown"].includes(String(row.status))) {
        throw new ComputersError("conflict", "Operation cannot be failed by a policy fence", 409);
      }
      const now = nowIso();
      const update = this.database.query(`UPDATE operations SET status = 'failed', error_code = 'policy_generation_mismatch',
        result_json = NULL, updated_at = ? WHERE tenant_id = ? AND id = ? AND status IN ('pending','accepted','running','unknown')`)
        .run(now, tenantId, operationId);
      if (update.changes !== 1) throw new ComputersError("conflict", "Operation was fenced concurrently", 409);
      this.database.query(`UPDATE operation_attempts SET status = 'failed', completed_at = ?
        WHERE tenant_id = ? AND operation_id = ? AND status IN ('running','unknown')`).run(now, tenantId, operationId);
      this.#appendAuditInTransaction(tenantId, {
        actorPrincipalId: "principal_worker", action: `computer.${String(row.kind)}.failed`,
        data: { operationId, outcome: "policy_generation_mismatch", fenced: true }, computerId: String(row.computer_id),
      });
      const operation = this.getOperation(tenantId, operationId);
      if (operation === undefined) throw new ComputersError("storage_error", "Storage consistency error", 500);
      return operation;
    });
    return transaction.immediate();
  }

  releaseChildReservation(tenantId: string, childComputerId: string): void {
    this.database.query("UPDATE child_reservations SET state = 'released', updated_at = ? WHERE tenant_id = ? AND child_computer_id = ? AND state IN ('reserved','active')")
      .run(nowIso(), tenantId, childComputerId);
  }

  acquireHomeLease(tenantId: string, computerId: string, expectedOwnerPrincipalId: string, holderId: string, ttlSeconds: number, expectedFence?: number): HomeLease {
    if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 3600) throw new ComputersError("invalid_request", "Invalid lease TTL", 400);
    const transaction = this.database.transaction(() => {
      const computer = this.database.query("SELECT owner_principal_id FROM computers WHERE tenant_id = ? AND id = ? AND status NOT IN ('deleted','deleting')").get(tenantId, computerId) as Row | null;
      if (computer === null || computer.owner_principal_id !== expectedOwnerPrincipalId) throw new ComputersError("authorization_denied", "Home lease denied", 403);
      const current = this.database.query("SELECT * FROM home_leases WHERE tenant_id = ? AND computer_id = ?").get(tenantId, computerId) as Row | null;
      const now = nowIso();
      if (current !== null) {
        const currentFence = Number(current.fence);
        if (expectedFence === undefined) throw new ComputersError("stale_fence", "Home lease renewal requires expected fence", 409);
        if (expectedFence !== currentFence) throw new ComputersError("stale_fence", "Stale home lease fence", 409);
        if (Date.parse(String(current.expires_at)) > Date.parse(now) && current.holder_id !== holderId) throw new ComputersError("conflict", "Home already has an active writer", 409);
      } else if (expectedFence !== undefined && expectedFence !== 0) {
        throw new ComputersError("stale_fence", "Stale home lease fence", 409);
      }
      const fence = current === null ? 1 : Number(current.fence) + 1;
      const expiresAt = new Date(Date.parse(now) + ttlSeconds * 1000).toISOString();
      this.database.query(`INSERT INTO home_leases (tenant_id, computer_id, holder_id, fence, expires_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (tenant_id, computer_id) DO UPDATE SET holder_id = excluded.holder_id, fence = excluded.fence, expires_at = excluded.expires_at, updated_at = excluded.updated_at`)
        .run(tenantId, computerId, holderId, fence, expiresAt, now);
      this.#appendAuditInTransaction(tenantId, {
        actorPrincipalId: holderId, action: "home_lease.acquired", data: { holderId, fence, expiresAt }, computerId,
      });
      return { tenantId, computerId, holderId, fence, expiresAt };
    });
    return transaction.immediate();
  }

  assertHomeFence(tenantId: string, computerId: string, holderId: string, fence: number): void {
    const row = this.database.query("SELECT holder_id, fence, expires_at FROM home_leases WHERE tenant_id = ? AND computer_id = ?").get(tenantId, computerId) as Row | null;
    if (row === null || row.holder_id !== holderId || Number(row.fence) !== fence || Date.parse(String(row.expires_at)) <= Date.now()) {
      throw new ComputersError("stale_fence", "Stale home lease fence", 409);
    }
  }

  getHomeLeaseCapability(tenantId: string, computerId: string): HomeLeaseCapability | undefined {
    const row = this.database.query("SELECT holder_id, fence, expires_at FROM home_leases WHERE tenant_id = ? AND computer_id = ?").get(tenantId, computerId) as Row | null;
    if (row === null || Date.parse(String(row.expires_at)) <= Date.now()) return undefined;
    return { tenantId, computerId, homeId: `home:${computerId}`, holderId: String(row.holder_id), fence: Number(row.fence), expiresAt: String(row.expires_at) };
  }

  setOperationHomeLease(operationId: string, capability: HomeLeaseCapability): void {
    if (capability.homeId !== `home:${capability.computerId}`) throw new ComputersError("invalid_request", "Invalid home lease capability", 400);
    this.assertHomeLeaseCapability(capability);
    const transaction = this.database.transaction(() => {
      this.assertHomeLeaseCapability(capability);
      const operation = this.database.query("SELECT tenant_id, computer_id FROM operations WHERE tenant_id = ? AND id = ?").get(capability.tenantId, operationId) as Row | null;
      if (operation === null || operation.computer_id !== capability.computerId) {
        throw new ComputersError("authorization_denied", "Home lease capability does not match operation", 403);
      }
      this.database.query(`INSERT INTO operation_home_leases (tenant_id, operation_id, computer_id, home_id, holder_id, fence, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (tenant_id, operation_id) DO UPDATE SET
        computer_id = excluded.computer_id, home_id = excluded.home_id, holder_id = excluded.holder_id, fence = excluded.fence, expires_at = excluded.expires_at`)
        .run(capability.tenantId, operationId, capability.computerId, capability.homeId, capability.holderId, capability.fence, capability.expiresAt);
      this.#appendAuditInTransaction(capability.tenantId, {
        actorPrincipalId: capability.holderId, action: "home_lease.capability_bound", data: { operationId, fence: capability.fence }, computerId: capability.computerId,
      });
    });
    transaction.immediate();
  }

  getOperationHomeLease(tenantId: string, operationId: string): HomeLeaseCapability | undefined {
    const row = this.database.query("SELECT * FROM operation_home_leases WHERE tenant_id = ? AND operation_id = ?").get(tenantId, operationId) as Row | null;
    if (row === null) return undefined;
    return { tenantId, computerId: String(row.computer_id), homeId: String(row.home_id), holderId: String(row.holder_id), fence: Number(row.fence), expiresAt: String(row.expires_at) };
  }

  assertHomeLeaseCapability(capability: HomeLeaseCapability): void {
    if (capability.homeId !== `home:${capability.computerId}` || Date.parse(capability.expiresAt) <= Date.now()) throw new ComputersError("stale_fence", "Stale home lease capability", 409);
    this.assertHomeFence(capability.tenantId, capability.computerId, capability.holderId, capability.fence);
  }

  createEnrollment(enrollment: ResidentEnrollment): ResidentEnrollment {
    const transaction = this.database.transaction(() => {
      const binding = this.getResidentBinding(enrollment.tenantId, enrollment.computerId);
      if (binding === undefined || binding.provider !== enrollment.expectedProvider || binding.instanceId !== enrollment.expectedInstanceId
        || binding.bootId !== enrollment.expectedBootId || binding.generation !== enrollment.bindingGeneration) {
        throw new ComputersError("authorization_denied", "Resident binding is not current", 403);
      }
      this.database.query(`INSERT INTO resident_enrollments
        (id, tenant_id, computer_id, expected_provider, expected_instance_id, expected_boot_id, binding_generation, token_hash, expires_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(enrollment.id, enrollment.tenantId, enrollment.computerId, enrollment.expectedProvider, enrollment.expectedInstanceId,
          enrollment.expectedBootId, enrollment.bindingGeneration, enrollment.tokenHash, enrollment.expiresAt, nowIso());
      this.#appendAuditInTransaction(enrollment.tenantId, {
        actorPrincipalId: "principal_controller", action: "resident.enrollment_precreated",
        data: { enrollmentId: enrollment.id, bindingGeneration: enrollment.bindingGeneration, expiresAt: enrollment.expiresAt }, computerId: enrollment.computerId,
      });
      return enrollment;
    });
    return transaction.immediate();
  }

  consumeEnrollment(tokenHash: string, provider: ProviderKind, instanceId: string, bootId: string, now: string): ResidentEnrollment {
    const transaction = this.database.transaction(() => {
      const row = this.database.query("SELECT * FROM resident_enrollments WHERE token_hash = ?").get(tokenHash) as Row | null;
      if (row === null) throw new ComputersError("authentication_required", "Enrollment denied", 401);
      if (row.used_at !== null || Date.parse(String(row.expires_at)) <= Date.parse(now)) throw new ComputersError(row.used_at === null ? "expired" : "replay_detected", "Enrollment denied", 401);
      const binding = this.database.query("SELECT * FROM resident_bindings WHERE tenant_id = ? AND computer_id = ?")
        .get(String(row.tenant_id), String(row.computer_id)) as Row | null;
      if (binding === null || row.expected_provider !== provider || row.expected_instance_id !== instanceId || row.expected_boot_id !== bootId
        || binding.provider !== provider || binding.instance_id !== instanceId || binding.boot_id !== bootId
        || Number(binding.generation) !== Number(row.binding_generation)) throw new ComputersError("authentication_required", "Enrollment denied", 401);
      const update = this.database.query("UPDATE resident_enrollments SET used_at = ? WHERE id = ? AND used_at IS NULL").run(now, String(row.id));
      if (update.changes !== 1) throw new ComputersError("replay_detected", "Enrollment denied", 401);
      this.#appendAuditInTransaction(String(row.tenant_id), {
        actorPrincipalId: "principal_resident", action: "resident.enrollment_consumed",
        data: { enrollmentId: String(row.id), bindingGeneration: Number(row.binding_generation) }, computerId: String(row.computer_id),
      });
      return enrollmentFromRow({ ...row, used_at: now });
    });
    return transaction.immediate();
  }

  saveResidentIdentity(identity: ResidentIdentity): void {
    const transaction = this.database.transaction(() => {
      const binding = this.database.query("SELECT * FROM resident_bindings WHERE tenant_id = ? AND computer_id = ?")
        .get(identity.tenantId, identity.computerId) as Row | null;
      if (binding === null || binding.provider !== identity.provider || binding.instance_id !== identity.instanceId || binding.boot_id !== identity.bootId
        || Number(binding.generation) !== identity.bindingGeneration) throw new ComputersError("authentication_required", "Enrollment denied", 401);
      this.database.query("UPDATE resident_identities SET revoked_at = ? WHERE tenant_id = ? AND computer_id = ? AND revoked_at IS NULL")
        .run(identity.issuedAt, identity.tenantId, identity.computerId);
      this.database.query(`INSERT INTO resident_identities (certificate_id, tenant_id, computer_id, provider, instance_id, boot_id, generation, binding_generation, issued_at, expires_at, revoked_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(identity.certificateId, identity.tenantId, identity.computerId, identity.provider, identity.instanceId,
        identity.bootId, identity.generation, identity.bindingGeneration, identity.issuedAt, identity.expiresAt, identity.revokedAt ?? null);
      this.#appendAuditInTransaction(identity.tenantId, {
        actorPrincipalId: "principal_controller", action: "resident.identity_issued",
        data: { certificateId: identity.certificateId, bindingGeneration: identity.bindingGeneration, expiresAt: identity.expiresAt }, computerId: identity.computerId,
      });
    });
    transaction.immediate();
  }

  setResidentBinding(binding: Omit<ResidentBinding, "updatedAt"> & { updatedAt?: string }): ResidentBinding {
    const value: ResidentBinding = { ...binding, updatedAt: binding.updatedAt ?? nowIso() };
    const transaction = this.database.transaction(() => {
      this.#setResidentBindingInTransaction(value);
      this.#appendAuditInTransaction(value.tenantId, {
        actorPrincipalId: "principal_controller", action: "resident.binding_set",
        data: { provider: value.provider, providerResourceId: value.providerResourceId, generation: value.generation }, computerId: value.computerId,
      });
      return value;
    });
    return transaction.immediate();
  }

  getResidentBinding(tenantId: string, computerId: string): ResidentBinding | undefined {
    const row = this.database.query("SELECT * FROM resident_bindings WHERE tenant_id = ? AND computer_id = ?").get(tenantId, computerId) as Row | null;
    return row === null ? undefined : bindingFromRow(row);
  }

  getResidentIdentity(certificateId: string): ResidentIdentity | undefined {
    const row = this.database.query("SELECT * FROM resident_identities WHERE certificate_id = ?").get(certificateId) as Row | null;
    return row === null ? undefined : identityFromRow(row);
  }

  revokeResidentIdentity(certificateId: string, revokedAt: string): void {
    const transaction = this.database.transaction(() => {
      const identity = this.database.query("SELECT tenant_id, computer_id FROM resident_identities WHERE certificate_id = ? AND revoked_at IS NULL").get(certificateId) as Row | null;
      if (identity === null) throw new ComputersError("not_found", "Resident identity not found", 404);
      const outcome = this.database.query("UPDATE resident_identities SET revoked_at = ? WHERE certificate_id = ? AND revoked_at IS NULL").run(revokedAt, certificateId);
      if (outcome.changes !== 1) throw new ComputersError("not_found", "Resident identity not found", 404);
      this.#appendAuditInTransaction(String(identity.tenant_id), {
        actorPrincipalId: "principal_controller", action: "resident.identity_revoked", data: { certificateId }, computerId: String(identity.computer_id),
      });
    });
    transaction.immediate();
  }

  acceptResidentEnvelope(envelope: ResidentOperationEnvelope, now: string): void {
    const identity = this.getResidentIdentity(envelope.certificateId);
    if (identity === undefined || identity.revokedAt !== undefined || Date.parse(identity.expiresAt) <= Date.parse(now)) throw new ComputersError("authentication_required", "Resident authentication failed", 401);
    if (identity.tenantId !== envelope.tenantId || identity.computerId !== envelope.computerId) throw new ComputersError("authentication_required", "Resident authentication failed", 401);
    const computer = this.getComputer(envelope.tenantId, envelope.computerId);
    if (computer === undefined) throw new ComputersError("authentication_required", "Resident authentication failed", 401);
    const binding = this.getResidentBinding(envelope.tenantId, envelope.computerId);
    if (binding === undefined || binding.provider !== identity.provider || binding.instanceId !== identity.instanceId || binding.bootId !== identity.bootId
      || binding.generation !== identity.bindingGeneration) throw new ComputersError("authentication_required", "Resident authentication failed", 401);
    if (identity.generation !== computer.policyGeneration || computer.policyGeneration !== envelope.policyGeneration) throw new ComputersError("policy_generation_mismatch", "Resident operation rejected", 409);
    const operation = this.getOperation(envelope.tenantId, envelope.operationId);
    if (operation === undefined || operation.computerId !== envelope.computerId) throw new ComputersError("authorization_denied", "Resident operation rejected", 403);
    if (operation.policyGeneration !== computer.policyGeneration || operation.policyGeneration !== envelope.policyGeneration) throw new ComputersError("policy_generation_mismatch", "Resident operation rejected", 409);
    const allowedKinds: Record<ResidentOperationEnvelope["capability"], OperationKind[]> = {
      exec: ["exec"], install: ["install"], status: ["create", "start", "stop", "quarantine", "delete", "exec", "install", "snapshot", "restore"],
      cancel: ["create", "start", "stop", "quarantine", "delete", "exec", "install", "snapshot", "restore"],
    };
    const capabilityKinds = allowedKinds[envelope.capability];
    if (capabilityKinds === undefined || !capabilityKinds.includes(operation.kind)) throw new ComputersError("authorization_denied", "Resident operation rejected", 403);
    if (!constantTimeDigestEqual(envelope.payloadDigest, sha256(operation.request))) throw new ComputersError("authorization_denied", "Resident operation rejected", 403);
    if (envelope.fence !== operation.fence) throw new ComputersError("stale_fence", "Resident operation rejected", 409);
    if (Date.parse(envelope.issuedAt) > Date.parse(now) + 30_000 || Date.parse(envelope.expiresAt) <= Date.parse(now)) throw new ComputersError("expired", "Resident operation rejected", 409);
    const transaction = this.database.transaction(() => {
      const previous = this.database.query("SELECT MAX(sequence) AS sequence FROM resident_nonces WHERE tenant_id = ? AND computer_id = ? AND operation_id = ? AND attempt_id = ?")
        .get(envelope.tenantId, envelope.computerId, envelope.operationId, envelope.attemptId) as Row;
      const expectedSequence = previous.sequence === null ? 0 : Number(previous.sequence) + 1;
      if (envelope.sequence !== expectedSequence) throw new ComputersError("replay_detected", "Resident operation rejected", 409);
      try {
        this.database.query("INSERT INTO resident_nonces (tenant_id, computer_id, nonce, operation_id, attempt_id, sequence, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
          .run(envelope.tenantId, envelope.computerId, envelope.nonce, envelope.operationId, envelope.attemptId, envelope.sequence, envelope.expiresAt, now);
      } catch (error) {
        if (String(error).includes("UNIQUE constraint failed")) throw new ComputersError("replay_detected", "Resident operation rejected", 409);
        throw error;
      }
      this.#appendAuditInTransaction(envelope.tenantId, {
        actorPrincipalId: envelope.certificateId, action: "resident.operation_accepted",
        data: { operationId: envelope.operationId, attemptId: envelope.attemptId, sequence: envelope.sequence, capability: envelope.capability }, computerId: envelope.computerId,
      });
    });
    transaction.immediate();
  }

  createInstallPolicy(revision: InstallPolicyRevision, audit?: AuditRecord): InstallPolicyRevision {
    const transaction = this.database.transaction(() => {
      const computer = this.database.query("SELECT policy_generation FROM computers WHERE tenant_id = ? AND id = ?").get(revision.tenantId, revision.computerId) as Row | null;
      if (computer === null) throw new ComputersError("not_found", "Computer not found", 404);
      const currentGeneration = Number(computer.policy_generation);
      if (revision.generation !== currentGeneration && revision.generation !== currentGeneration + 1) throw new ComputersError("policy_generation_mismatch", "Policy generation is not monotonic", 409);
      this.database.query("INSERT INTO install_policy_revisions (id, tenant_id, computer_id, generation, digest, rules_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(revision.id, revision.tenantId, revision.computerId, revision.generation, revision.digest, stableJson(revision.rules), revision.createdAt);
      if (revision.generation === currentGeneration + 1) {
        this.database.query("UPDATE computers SET policy_generation = ?, updated_at = ? WHERE tenant_id = ? AND id = ? AND policy_generation = ?")
          .run(revision.generation, revision.createdAt, revision.tenantId, revision.computerId, currentGeneration);
        this.database.query("UPDATE operations SET fence = fence + 1, updated_at = ? WHERE tenant_id = ? AND computer_id = ? AND policy_generation < ? AND status IN ('pending','accepted','running','unknown')")
          .run(revision.createdAt, revision.tenantId, revision.computerId, revision.generation);
        this.database.query("UPDATE computer_create_grants SET active = 0, updated_at = ? WHERE tenant_id = ? AND parent_computer_id = ? AND generation < ? AND active = 1")
          .run(revision.createdAt, revision.tenantId, revision.computerId, revision.generation);
        this.database.query("UPDATE grants SET revoked_at = ? WHERE tenant_id = ? AND computer_id = ? AND revoked_at IS NULL AND (policy_generation IS NULL OR policy_generation < ?)")
          .run(revision.createdAt, revision.tenantId, revision.computerId, revision.generation);
        this.database.query("UPDATE sessions SET revoked_at = ? WHERE tenant_id = ? AND principal_id IN (SELECT principal_id FROM assignments WHERE tenant_id = ? AND computer_id = ? AND active = 1) AND revoked_at IS NULL")
          .run(revision.createdAt, revision.tenantId, revision.tenantId, revision.computerId);
      }
      if (audit !== undefined) this.#appendAuditInTransaction(revision.tenantId, audit);
      return revision;
    });
    return transaction.immediate();
  }

  getInstallPolicy(tenantId: string, computerId: string, generation?: number): InstallPolicyRevision | undefined {
    const row = generation === undefined
      ? this.database.query("SELECT * FROM install_policy_revisions WHERE tenant_id = ? AND computer_id = ? ORDER BY generation DESC LIMIT 1").get(tenantId, computerId) as Row | null
      : this.database.query("SELECT * FROM install_policy_revisions WHERE tenant_id = ? AND computer_id = ? AND generation = ?").get(tenantId, computerId, generation) as Row | null;
    if (row === null) return undefined;
    return { id: String(row.id), tenantId: String(row.tenant_id), computerId: String(row.computer_id), generation: Number(row.generation), digest: String(row.digest), rules: JSON.parse(String(row.rules_json)) as InstallPolicyRevision["rules"], createdAt: String(row.created_at) };
  }

  saveInstallTicket(claims: InstallTicketClaims, signature: string, audit: AuditRecord): void {
    const transaction = this.database.transaction(() => {
      this.database.query(`INSERT INTO install_tickets (id, tenant_id, computer_id, policy_revision_id, policy_generation, policy_digest, spec_digest, claims_json, signature, nonce, expires_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(claims.ticketId, claims.tenantId, claims.computerId, claims.policyRevisionId, claims.policyGeneration,
        claims.policyDigest, claims.specDigest, stableJson(claims), signature, claims.nonce, claims.expiresAt, claims.issuedAt);
      this.#appendAuditInTransaction(claims.tenantId, audit);
    });
    transaction.immediate();
  }

  consumeInstallTicketAndCreateOperation(claims: InstallTicketClaims, signature: string, now: string, operation: Operation, audit: AuditRecord): MutationResult<Operation> {
    const transaction = this.database.transaction(() => {
      const existing = this.database.query("SELECT * FROM operations WHERE tenant_id = ? AND computer_id = ? AND kind = 'install' AND idempotency_key = ?")
        .get(operation.tenantId, operation.computerId, operation.idempotencyKey) as Row | null;
      if (existing !== null) {
        const value = operationFromRow(existing);
        if (stableJson(value.request) !== stableJson(operation.request)) throw new ComputersError("conflict", "Idempotency key was used with a different request", 409);
        return { value, created: false };
      }
      const row = this.database.query("SELECT * FROM install_tickets WHERE id = ? AND tenant_id = ? AND computer_id = ?")
        .get(claims.ticketId, claims.tenantId, claims.computerId) as Row | null;
      if (row === null) throw new ComputersError("authorization_denied", "Install ticket rejected", 403);
      if (row.signature !== signature) throw new ComputersError("authorization_denied", "Install ticket rejected", 403);
      if (row.consumed_at !== null) throw new ComputersError("replay_detected", "Install ticket rejected", 409);
      if (Date.parse(String(row.expires_at)) <= Date.parse(now)) throw new ComputersError("expired", "Install ticket rejected", 409);
      if (stableJson(JSON.parse(String(row.claims_json))) !== stableJson(claims)) throw new ComputersError("authorization_denied", "Install ticket rejected", 403);
      const computer = this.getComputer(claims.tenantId, claims.computerId);
      if (computer === undefined || computer.policyGeneration !== claims.policyGeneration) throw new ComputersError("policy_generation_mismatch", "Install ticket rejected", 409);
      const updated = this.database.query("UPDATE install_tickets SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL").run(now, claims.ticketId);
      if (updated.changes !== 1) throw new ComputersError("replay_detected", "Install ticket rejected", 409);
      this.#insertOperation(operation);
      this.#appendAuditInTransaction(operation.tenantId, audit);
      return { value: operation, created: true };
    });
    return transaction.immediate();
  }

  appendAudit(tenantId: string, actorPrincipalId: string, action: string, data: Record<string, unknown>, computerId?: string): void {
    const audit: AuditRecord = { actorPrincipalId, action, data };
    if (computerId !== undefined) audit.computerId = computerId;
    const transaction = this.database.transaction(() => this.#appendAuditInTransaction(tenantId, audit));
    transaction.immediate();
  }

  currentAuditCheckpoint(tenantId: string): AuditCheckpoint | undefined {
    const row = this.database.query("SELECT sequence, event_hash, created_at FROM audit_events WHERE tenant_id = ? ORDER BY sequence DESC LIMIT 1").get(tenantId) as Row | null;
    return row === null ? undefined : { tenantId, sequence: Number(row.sequence), eventHash: String(row.event_hash), createdAt: String(row.created_at) };
  }

  verifyAuditChain(tenantId: string, checkpoint?: AuditCheckpoint): AuditVerification {
    const rows = this.database.query("SELECT * FROM audit_events WHERE tenant_id = ? ORDER BY sequence").all(tenantId) as Row[];
    let previousHash = `sha256:${"0".repeat(64)}`;
    let previousSequence = 0;
    for (const row of rows) {
      const sequence = Number(row.sequence);
      if (sequence <= previousSequence || String(row.previous_hash) !== previousHash) return { valid: false, anchored: checkpoint !== undefined, eventCount: rows.length, error: "audit_chain_order_or_link_mismatch" };
      const data = JSON.parse(String(row.data_json)) as Record<string, unknown>;
      const expected = sha256({
        id: String(row.id), tenantId, actorPrincipalId: String(row.actor_principal_id), computerId: row.computer_id === null ? null : String(row.computer_id),
        action: String(row.action), data, previousHash, createdAt: String(row.created_at),
      });
      if (!constantTimeDigestEqual(String(row.event_hash), expected)) return { valid: false, anchored: checkpoint !== undefined, eventCount: rows.length, error: "audit_event_hash_mismatch" };
      previousHash = expected; previousSequence = sequence;
    }
    if (checkpoint !== undefined && (checkpoint.tenantId !== tenantId || checkpoint.sequence !== previousSequence || checkpoint.eventHash !== previousHash)) {
      return { valid: false, anchored: true, eventCount: rows.length, error: "audit_checkpoint_mismatch" };
    }
    return { valid: true, anchored: checkpoint !== undefined, eventCount: rows.length };
  }

  #insertOperation(operation: Operation): void {
    this.database.query(`INSERT INTO operations
      (id, tenant_id, computer_id, kind, status, policy_generation, idempotency_key, request_json, prior_computer_status, desired_computer_status, fence, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      operation.id, operation.tenantId, operation.computerId, operation.kind, operation.status, operation.policyGeneration, operation.idempotencyKey,
      stableJson(operation.request), operation.priorComputerStatus ?? null, operation.desiredComputerStatus ?? null, operation.fence, operation.createdAt, operation.updatedAt,
    );
  }

  #appendAuditInTransaction(tenantId: string, audit: AuditRecord): void {
    const previous = this.database.query("SELECT event_hash FROM audit_events WHERE tenant_id = ? ORDER BY sequence DESC LIMIT 1").get(tenantId) as Row | null;
    const previousHash = previous === null ? `sha256:${"0".repeat(64)}` : String(previous.event_hash);
    const createdAt = nowIso();
    const id = makeId("aud");
    const computerId = audit.computerId ?? null;
    const eventHash = sha256({ id, tenantId, actorPrincipalId: audit.actorPrincipalId, computerId, action: audit.action, data: audit.data, previousHash, createdAt });
    this.database.query("INSERT INTO audit_events (id, tenant_id, actor_principal_id, computer_id, action, data_json, previous_hash, event_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, tenantId, audit.actorPrincipalId, computerId, audit.action, stableJson(audit.data), previousHash, eventHash, createdAt);
    this.database.query("INSERT INTO outbox_events (id, tenant_id, topic, payload_json, created_at) VALUES (?, ?, 'audit.appended', ?, ?)")
      .run(makeId("out"), tenantId, stableJson({ auditEventId: id, eventHash }), createdAt);
  }

  #setResidentBindingInTransaction(binding: ResidentBinding): void {
    const computer = this.database.query("SELECT provider FROM computers WHERE tenant_id = ? AND id = ?").get(binding.tenantId, binding.computerId) as Row | null;
    if (computer === null || computer.provider !== binding.provider) throw new ComputersError("authorization_denied", "Resident binding rejected", 403);
    const current = this.database.query("SELECT generation FROM resident_bindings WHERE tenant_id = ? AND computer_id = ?").get(binding.tenantId, binding.computerId) as Row | null;
    if (current !== null && binding.generation <= Number(current.generation)) throw new ComputersError("stale_fence", "Resident binding generation must increase", 409);
    this.database.query(`INSERT INTO resident_bindings (tenant_id, computer_id, provider, provider_resource_id, instance_id, boot_id, generation, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (tenant_id, computer_id) DO UPDATE SET provider = excluded.provider,
      provider_resource_id = excluded.provider_resource_id, instance_id = excluded.instance_id, boot_id = excluded.boot_id,
      generation = excluded.generation, updated_at = excluded.updated_at`).run(binding.tenantId, binding.computerId, binding.provider,
      binding.providerResourceId, binding.instanceId, binding.bootId, binding.generation, binding.updatedAt);
    this.database.query("UPDATE resident_identities SET revoked_at = ? WHERE tenant_id = ? AND computer_id = ? AND revoked_at IS NULL")
      .run(binding.updatedAt, binding.tenantId, binding.computerId);
  }

  #upsertProviderBindingInTransaction(binding: ProviderBinding): void {
    this.database.query(`INSERT INTO provider_bindings
      (tenant_id, computer_id, provider, resource_id, instance_id, boot_id, operation_id, attempt_id, state, fence, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (tenant_id, computer_id) DO UPDATE SET provider = excluded.provider, resource_id = excluded.resource_id,
      instance_id = excluded.instance_id, boot_id = excluded.boot_id, operation_id = excluded.operation_id,
      attempt_id = excluded.attempt_id, state = excluded.state, fence = excluded.fence, updated_at = excluded.updated_at`)
      .run(binding.tenantId, binding.computerId, binding.provider, binding.resource.resourceId, binding.resource.instanceId ?? null,
        binding.resource.bootId ?? null, binding.operationId, binding.attemptId, binding.state, binding.fence, binding.updatedAt);
  }

  #protectControllerFiles(): void {
    if (!this.#persistent) return;
    for (const path of [this.#path, `${this.#path}-wal`, `${this.#path}-shm`]) if (existsSync(path)) chmodSync(path, 0o600);
  }

  #verifyConnection(deadline: number): void {
    const journal = this.#withContentionRetry(() => this.database.query("PRAGMA journal_mode").get() as Row | null, deadline);
    const foreignKeys = this.database.query("PRAGMA foreign_keys").get() as Row | null;
    const migration = this.#withContentionRetry(() => this.database.query("SELECT MAX(version) AS version FROM schema_migrations").get() as Row | null, deadline);
    const integrity = this.#withContentionRetry(() => this.database.query("PRAGMA integrity_check").get() as Row | null, deadline);
    const expectedJournal = this.#persistent ? "wal" : "memory";
    if (journal === null || String(journal.journal_mode).toLowerCase() !== expectedJournal
      || foreignKeys === null || Number(foreignKeys.foreign_keys) !== 1
      || migration === null || Number(migration.version) !== SQLITE_SCHEMA_VERSION
      || integrity === null || Object.values(integrity)[0] !== "ok") {
      throw new ComputersError("storage_error", "Storage initialization failed", 500);
    }
  }

  #schemaIsCurrent(deadline: number): boolean {
    return this.#withContentionRetry(() => {
      const table = this.database.query("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").get() as Row | null;
      if (table === null) return false;
      const current = this.database.query("SELECT MAX(version) AS version FROM schema_migrations").get() as Row | null;
      return current !== null && Number(current.version) === SQLITE_SCHEMA_VERSION;
    }, deadline);
  }

  #withContentionRetry<T>(operation: () => T, deadline: number): T {
    let backoff = SQLITE_INITIAL_BACKOFF_MS;
    for (;;) {
      try {
        return operation();
      } catch (error) {
        if (!isSQLiteContention(error)) throw error;
        const remaining = deadline - performance.now();
        if (remaining <= 0) throw new ComputersError("storage_error", "Storage temporarily unavailable", 503);
        const jitter = randomBytes(2).readUInt16BE(0) % (backoff + 1);
        sleepSync(Math.min(remaining, backoff + jitter));
        backoff = Math.min(backoff * 2, SQLITE_MAX_BACKOFF_MS);
      }
    }
  }
}
