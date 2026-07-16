import { Database, type SQLQueryBindings } from "bun:sqlite";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { chmodSync, closeSync, constants, existsSync, openSync, readFileSync } from "node:fs";
import { types as utilTypes } from "node:util";
import {
  ComputersError,
  BUILTIN_LOCAL_MACHINE_PROFILE_DOCUMENT,
  RESERVED_PROFILE_IDS,
  type AuditCheckpoint,
  type AuditVerification,
  type Computer,
  type ComputerCreateGrant,
  type ComputerProfile,
  type ComputerVolume,
  type ComputerStatus,
  type HomeLease,
  type HomeLeaseCapability,
  type InstallPolicyRevision,
  type InstallTicketClaims,
  type Operation,
  type OperationKind,
  type OperationStatus,
  type ProviderAttempt,
  type ProviderAssuranceRecord,
  type ProviderBinding,
  type ProviderKind,
  type ProviderOutcome,
  type ResidentBinding,
  type ResidentEnrollment,
  type ResidentIdentity,
  type ResidentOperationEnvelope,
} from "../contracts";
import {
  inspectProviderMalformedOutcome,
  inspectProviderOutcome,
  inspectProviderResource,
  validateProviderAssurance,
  type ProviderMalformedOutcome,
} from "../providers";
import { validateProviderConfinement } from "../validation";

type Row = Record<string, SQLQueryBindings>;

const SQLITE_SCHEMA_VERSION = 3;
const SQLITE_BUSY_TIMEOUT_MS = 250;
const SQLITE_RUNTIME_BUSY_TIMEOUT_MS = 5_000;
const SQLITE_INITIALIZATION_TIMEOUT_MS = 15_000;
const SQLITE_INITIAL_BACKOFF_MS = 2;
const SQLITE_MAX_BACKOFF_MS = 100;
// The longest current local provider path is bounded below 25 minutes (create +
// inspection + cleanup). A 35-minute lease leaves ten minutes of scheduler and
// shutdown grace; the worker renews it every minute while it owns the attempt.
export const PROVIDER_ATTEMPT_LEASE_MS = 35 * 60 * 1000;

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

function isSQLiteConstraint(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const failure = error as SQLiteFailure;
  const code = typeof failure.code === "string" ? failure.code : "";
  const errno = typeof failure.errno === "number" ? failure.errno & 0xff : -1;
  return code === "SQLITE_CONSTRAINT" || code.startsWith("SQLITE_CONSTRAINT_") || errno === 19;
}

function isActiveLifecycleConstraint(error: unknown): boolean {
  return isSQLiteConstraint(error) && error instanceof Error
    && error.message === "UNIQUE constraint failed: operations.tenant_id, operations.computer_id";
}

type ObservedLifecycle = Extract<ComputerStatus, "running" | "stopped" | "quarantined" | "deleted">;

type CompletedComputerStatusResolution =
  | { kind: "not_required" }
  | { kind: "observed"; status: ObservedLifecycle }
  | { kind: "invalid" };

const MAX_STORAGE_SNAPSHOT_DEPTH = 64;
const MAX_STORAGE_SNAPSHOT_NODES = 100_000;
const MAX_STORAGE_SNAPSHOT_BYTES = 1024 * 1024;

type JsonSnapshot = { valid: true; value: unknown } | { valid: false };

interface JsonSnapshotState {
  readonly seen: Set<object>;
  nodes: number;
}

function snapshotJsonData(value: unknown, state: JsonSnapshotState, depth = 0): JsonSnapshot {
  state.nodes += 1;
  if (state.nodes > MAX_STORAGE_SNAPSHOT_NODES || depth > MAX_STORAGE_SNAPSHOT_DEPTH) return { valid: false };
  if (value === null || typeof value === "string" || typeof value === "boolean") return { valid: true, value };
  if (typeof value === "number") return Number.isFinite(value) ? { valid: true, value } : { valid: false };
  if (typeof value !== "object" || utilTypes.isProxy(value) || state.seen.has(value)) return { valid: false };
  state.seen.add(value);
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) return { valid: false };
      const lengthDescriptor = descriptors.length;
      if (lengthDescriptor === undefined || !("value" in lengthDescriptor)
        || !Number.isSafeInteger(lengthDescriptor.value) || Number(lengthDescriptor.value) < 0) return { valid: false };
      const length = Number(lengthDescriptor.value);
      const snapshot: unknown[] = [];
      for (let index = 0; index < length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) return { valid: false };
        const item = snapshotJsonData(descriptor.value, state, depth + 1);
        if (!item.valid) return item;
        snapshot.push(item.value);
      }
      for (const key of Reflect.ownKeys(descriptors)) {
        if (typeof key !== "string" || (key !== "length" && !/^(0|[1-9]\d*)$/.test(key))) return { valid: false };
        const descriptor = descriptors[key];
        if (descriptor !== undefined && !("value" in descriptor)) return { valid: false };
      }
      return { valid: true, value: snapshot };
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return { valid: false };
    const snapshot: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of Reflect.ownKeys(descriptors)) {
      if (typeof key !== "string") return { valid: false };
      const descriptor = descriptors[key];
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) return { valid: false };
      const item = snapshotJsonData(descriptor.value, state, depth + 1);
      if (!item.valid) return item;
      snapshot[key] = item.value;
    }
    return { valid: true, value: snapshot };
  } catch {
    return { valid: false };
  } finally {
    state.seen.delete(value);
  }
}

function isWithinSnapshotByteLimit(value: unknown, limit: number): boolean {
  const encoder = new TextEncoder();
  let bytes = 0;
  const add = (text: string): boolean => {
    if (text.length > limit - bytes) return false;
    bytes += encoder.encode(text).byteLength;
    return bytes <= limit;
  };
  const visit = (item: unknown): boolean => {
    if (item === null) return add("null");
    if (typeof item === "string") return add(JSON.stringify(item));
    if (typeof item === "number") return add(Object.is(item, -0) ? "0" : String(item));
    if (typeof item === "boolean") return add(item ? "true" : "false");
    if (Array.isArray(item)) {
      if (!add("[")) return false;
      for (let index = 0; index < item.length; index += 1) {
        if (index !== 0 && !add(",")) return false;
        if (!visit(item[index])) return false;
      }
      return add("]");
    }
    if (typeof item !== "object" || item === null || !add("{")) return false;
    const record = item as Record<string, unknown>;
    let index = 0;
    for (const key of Object.keys(record)) {
      if (index !== 0 && !add(",")) return false;
      if (!add(JSON.stringify(key)) || !add(":") || !visit(record[key])) return false;
      index += 1;
    }
    return add("}");
  };
  return visit(value);
}

function snapshotJsonRecord(value: unknown): Record<string, unknown> | undefined {
  try {
    const snapshot = snapshotJsonData(value, { seen: new Set(), nodes: 0 });
    if (!snapshot.valid || typeof snapshot.value !== "object" || snapshot.value === null || Array.isArray(snapshot.value)) return undefined;
    if (!isWithinSnapshotByteLimit(snapshot.value, MAX_STORAGE_SNAPSHOT_BYTES)) return undefined;
    return snapshot.value as Record<string, unknown>;
  } catch { return undefined; }
}

function resolveCompletedComputerStatus(operation: Operation, result: unknown): CompletedComputerStatusResolution {
  const requested = operation.desiredComputerStatus;
  if (requested === undefined) return { kind: "not_required" };
  if (typeof result !== "object" || result === null || utilTypes.isProxy(result) || Array.isArray(result)) return { kind: "invalid" };
  const lifecycleProperty = Object.getOwnPropertyDescriptor(result, "lifecycle");
  if (lifecycleProperty === undefined || !lifecycleProperty.enumerable || !("value" in lifecycleProperty)) return { kind: "invalid" };
  const observed = lifecycleProperty.value;
  if (typeof observed !== "string" || !["running", "stopped", "quarantined", "deleted"].includes(observed)) {
    return { kind: "invalid" };
  }
  const lifecycle = observed as ObservedLifecycle;
  const accepted = operation.kind === "create"
    ? lifecycle === requested
    : operation.kind === "start" || operation.kind === "restore"
      ? lifecycle === "running"
      : operation.kind === "stop"
        ? lifecycle === "stopped" || lifecycle === "quarantined"
        : operation.kind === "quarantine"
          ? lifecycle === "quarantined"
          : operation.kind === "delete" && lifecycle === "deleted";
  if (!accepted) return { kind: "invalid" };
  return { kind: "observed", status: lifecycle };
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
export interface ProviderAttemptClaim { attempt: ProviderAttempt; mode: "perform" | "reconcile" | "busy"; policyFenced?: boolean; }

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
  createLifecycleOperation(operation: Operation, allowedStatuses: readonly ComputerStatus[], audit: AuditRecord): MutationResult<Operation>;
  getOperation(tenantId: string, id: string): Operation | undefined;
  listOperations(tenantId: string, computerId?: string): Operation[];
  updateOperation(tenantId: string, id: string, status: OperationStatus, result?: Record<string, unknown>, errorCode?: string): Operation;
  beginProviderAttempt(operation: Operation): ProviderAttempt;
  claimProviderAttempt(operation: Operation): ProviderAttemptClaim;
  renewProviderAttemptOwnership(attempt: ProviderAttempt): void;
  assertProviderAttemptOwnership(attempt: ProviderAttempt): void;
  recordProviderOwnershipLost(attempt: ProviderAttempt, resource?: ProviderOutcome["resource"]): void;
  getProviderAttempt(tenantId: string, operationId: string): ProviderAttempt | undefined;
  getProviderBinding(tenantId: string, computerId: string): ProviderBinding | undefined;
  getProviderAssurance(tenantId: string, computerId: string): ProviderAssuranceRecord | undefined;
  listComputerVolumes(tenantId: string, computerId: string): ComputerVolume[];
  createProfile(profile: ComputerProfile, audit: AuditRecord): MutationResult<ComputerProfile>;
  getProfile(tenantId: string, id: string): ComputerProfile | undefined;
  listProfiles(tenantId: string): ComputerProfile[];
  recordProviderUnknown(attempt: ProviderAttempt, outcome: Extract<ProviderOutcome, { kind: "unknown" }>): void;
  recordProviderMalformed(attempt: ProviderAttempt, outcome: ProviderMalformedOutcome): void;
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
    fence: Number(row.fence), executionOwnerGeneration: Number(row.execution_owner_generation ?? 0), startedAt: String(row.started_at),
  };
  if (row.provider_operation_id !== null && row.provider_operation_id !== undefined) attempt.providerOperationId = String(row.provider_operation_id);
  if (row.resource_json !== null && row.resource_json !== undefined) attempt.resource = JSON.parse(String(row.resource_json)) as NonNullable<ProviderAttempt["resource"]>;
  if (row.execution_owner_token !== null && row.execution_owner_token !== undefined) attempt.executionOwnerToken = String(row.execution_owner_token);
  if (row.execution_owner_expires_at !== null && row.execution_owner_expires_at !== undefined) attempt.executionOwnerExpiresAt = String(row.execution_owner_expires_at);
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

function assuranceFromRow(row: Row): ProviderAssuranceRecord {
  const evidence = validateProviderAssurance(JSON.parse(String(row.evidence_json)));
  return {
    ...evidence, tenantId: String(row.tenant_id), computerId: String(row.computer_id), provider: String(row.provider) as ProviderKind,
    operationId: String(row.operation_id), attemptId: String(row.attempt_id), bindingFence: Number(row.binding_fence),
    generation: Number(row.generation), verifiedAt: String(row.verified_at),
  };
}

function volumeFromRow(row: Row): ComputerVolume {
  const volume: ComputerVolume = {
    id: String(row.id), tenantId: String(row.tenant_id), computerId: String(row.computer_id), kind: String(row.kind) as ComputerVolume["kind"],
    fence: Number(row.fence), state: String(row.state) as ComputerVolume["state"], createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
  if (row.provider_ref !== null && row.provider_ref !== undefined) volume.providerRef = String(row.provider_ref);
  return volume;
}

function profileFromRow(row: Row): ComputerProfile {
  return {
    id: String(row.id), tenantId: String(row.tenant_id), name: String(row.name), generation: Number(row.generation),
    digest: String(row.digest), document: JSON.parse(String(row.document_json)) as ComputerProfile["document"], createdAt: String(row.revision_created_at),
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
  #schemaBehaviorVerified = false;

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
    this.#schemaBehaviorVerified = false;
    const deadline = performance.now() + SQLITE_INITIALIZATION_TIMEOUT_MS;
    this.database.exec(`PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);
    this.database.exec("PRAGMA foreign_keys = ON");
    this.database.exec("PRAGMA ignore_check_constraints = OFF");

    if (this.#persistent) {
      let journal = this.#withContentionRetry(() => this.database.query("PRAGMA journal_mode").get() as Row | null, deadline);
      if (journal === null || String(journal.journal_mode).toLowerCase() !== "wal") {
        journal = this.#withContentionRetry(() => this.database.query("PRAGMA journal_mode = WAL").get() as Row | null, deadline);
      }
      if (journal === null || String(journal.journal_mode).toLowerCase() !== "wal") throw new ComputersError("storage_error", "Storage initialization failed", 500);
    }
    this.#withContentionRetry(() => this.database.exec("PRAGMA synchronous = FULL"), deadline);

    const migrationNames = ["0001_initial.sql", "0002_provider_assurance.sql", "0003_provider_binding_provenance.sql"];
    const migrations = migrationNames.map((name, index) => {
      const version = index + 1;
      const sourceUrl = new URL(`../../migrations/sqlite/${name}`, import.meta.url);
      const packedUrl = new URL(`../migrations/sqlite/${name}`, import.meta.url);
      return { version, sql: readFileSync(existsSync(sourceUrl) ? sourceUrl : packedUrl, "utf8") };
    });
    const transaction = this.database.transaction(() => {
      const history = this.#migrationHistory();
      if (history === undefined) {
        const existingSchema = this.database.query("SELECT 1 AS present FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' LIMIT 1").get() as Row | null;
        if (existingSchema !== null) throw new ComputersError("storage_error", "Storage initialization failed", 500);
      }
      const current = history === undefined ? 0 : history.length;
      if (history !== undefined && !this.#validMigrationHistory(history, true)) {
        throw new ComputersError("storage_error", "Storage initialization failed", 500);
      }
      for (const migration of migrations) {
        if (migration.version <= current) continue;
        const providerBindingCount = migration.version === 3
          ? Number((this.database.query("SELECT COUNT(*) AS count FROM provider_bindings").get() as Row).count)
          : undefined;
        if (migration.version === 3 && !this.#providerBindingsHaveValidProvenance()) {
          throw new ComputersError("storage_error", "Storage initialization failed", 500);
        }
        this.database.exec(migration.sql);
        if (migration.version === 3) {
          const migratedCount = Number((this.database.query("SELECT COUNT(*) AS count FROM provider_bindings").get() as Row).count);
          const migratedVersion = Number((this.database.query("SELECT MAX(version) AS version FROM schema_migrations").get() as Row).version);
          if (migratedCount !== providerBindingCount || migratedVersion !== 3 || !this.#providerBindingsHaveValidProvenance()) {
            throw new ComputersError("storage_error", "Storage initialization failed", 500);
          }
        }
      }
      const migratedHistory = this.#migrationHistory();
      if (migratedHistory === undefined || !this.#validMigrationHistory(migratedHistory, false)) {
        throw new ComputersError("storage_error", "Storage initialization failed", 500);
      }
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
      const ignoredChecks = this.database.query("PRAGMA ignore_check_constraints").get() as Row | null;
      const migrationHistory = this.#migrationHistory();
      const integrity = this.database.query("PRAGMA integrity_check").get() as Row | null;
      const foreignKeyViolations = this.database.query("PRAGMA foreign_key_check").all();
      const expectedJournal = this.#persistent ? "wal" : "memory";
      return journal !== null && String(journal.journal_mode).toLowerCase() === expectedJournal
        && foreignKeys !== null && Number(foreignKeys.foreign_keys) === 1
        && ignoredChecks !== null && Number(ignoredChecks.ignore_check_constraints) === 0
        && migrationHistory !== undefined && this.#validMigrationHistory(migrationHistory, false)
        && integrity !== null && Object.values(integrity)[0] === "ok"
        && foreignKeyViolations.length === 0
        && this.#schemaBehaviorVerified && this.#schemaV3IsStructural() && this.#schemaV3HasNoUnsafeRows();
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
    const requestProperty = Object.getOwnPropertyDescriptor(operation, "request");
    const request = requestProperty !== undefined && requestProperty.enumerable && "value" in requestProperty
      ? snapshotJsonRecord(requestProperty.value)
      : undefined;
    if (request === undefined) throw new ComputersError("invalid_request", "Computer profile binding is invalid", 400);
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
        const expiresAt = grant?.expires_at === null || grant?.expires_at === undefined ? undefined : Date.parse(String(grant.expires_at));
        if (grant === null || (expiresAt !== undefined && (!Number.isFinite(expiresAt) || expiresAt <= Date.parse(record.computer.createdAt)))) {
          throw new ComputersError("authorization_denied", "Authorization denied", 403);
        }
        const allowedProviders = JSON.parse(String(grant.allowed_providers_json)) as ProviderKind[];
        const childOwners = JSON.parse(String(grant.allowed_child_owners_json)) as string[];
        const regions = JSON.parse(String(grant.allowed_regions_json)) as string[];
        const profiles = JSON.parse(String(grant.allowed_profile_ids_json)) as string[];
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
      const binding = request.profile;
      if (typeof binding !== "object" || binding === null || Array.isArray(binding)
        || Object.keys(binding).sort().join(",") !== "digest,document,generation,id") throw new ComputersError("invalid_request", "Computer profile binding is invalid", 400);
      const bound = binding as Record<string, unknown>;
      if (bound.id !== request.profileId || !Number.isSafeInteger(bound.generation) || Number(bound.generation) < 1
        || typeof bound.digest !== "string" || typeof bound.document !== "object" || bound.document === null || Array.isArray(bound.document)
        || bound.digest !== sha256(bound.document) || (bound.document as Record<string, unknown>).provider !== record.computer.provider) {
        throw new ComputersError("invalid_request", "Computer profile binding is invalid", 400);
      }
      if (bound.id === "profile_default" || bound.id === "profile_adopted") {
        if (record.computer.provider !== "local_machine" || Number(bound.generation) !== 1
          || stableJson(bound.document) !== stableJson(BUILTIN_LOCAL_MACHINE_PROFILE_DOCUMENT)) throw new ComputersError("invalid_request", "Computer profile binding is invalid", 400);
      } else {
        const revision = this.database.query("SELECT digest, document_json FROM profile_revisions WHERE tenant_id = ? AND profile_id = ? AND generation = ?")
          .get(record.computer.tenantId, String(bound.id), Number(bound.generation)) as Row | null;
        if (revision === null || revision.digest !== bound.digest || stableJson(JSON.parse(String(revision.document_json))) !== stableJson(bound.document)) {
          throw new ComputersError("invalid_request", "Computer profile revision is not current", 400);
        }
      }
      // Trust-boundary quota invariant (defense in depth with ComputersService.createComputer): the
      // quota-charged storageGiB must cover the home disk the bound local_vm profile will provision.
      // Enforced transactionally here, using the already validated request profile binding and exact
      // integer bounds, before any Computer/assignment/reservation/idempotency/operation write, so a
      // bypassed or drifted service guard cannot persist an under-declared local_vm Computer.
      const boundDocument = bound.document as Record<string, unknown>;
      if (boundDocument.provider === "local_vm"
        && (!Number.isSafeInteger(request.storageGiB) || !Number.isSafeInteger(boundDocument.homeDiskGiB)
          || Number(request.storageGiB) < Number(boundDocument.homeDiskGiB))) {
        throw new ComputersError("invalid_request", "Requested storageGiB must cover the bound profile home disk", 400, { field: "storageGiB", reason: "below_profile_home_disk" });
      }
      try {
        this.database.query(`INSERT INTO computers (id, tenant_id, slug, provider, confinement_class, status, owner_principal_id, policy_generation, data_exfiltration_protection, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(record.computer.id, record.computer.tenantId, record.computer.slug, record.computer.provider,
          record.computer.confinementClass, record.computer.status, record.computer.ownerPrincipalId, record.computer.policyGeneration,
          record.computer.dataExfiltrationProtection ? 1 : 0, record.computer.createdAt, record.computer.updatedAt);
        this.database.query("INSERT INTO assignments (id, tenant_id, computer_id, principal_id, active, generation, created_at) VALUES (?, ?, ?, ?, 1, 1, ?)")
          .run(makeId("asn"), record.computer.tenantId, record.computer.id, record.computer.ownerPrincipalId, record.computer.createdAt);
        for (const kind of ["root", "home"] as const) this.database.query(`INSERT INTO volumes
          (id, tenant_id, computer_id, kind, fence, state, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 'pending', ?, ?)`)
          .run(makeId("vol"), record.computer.tenantId, record.computer.id, kind, record.computer.createdAt, record.computer.updatedAt);
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
      this.#insertOperation(operation, request);
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

  createLifecycleOperation(operation: Operation, allowedStatuses: readonly ComputerStatus[], audit: AuditRecord): MutationResult<Operation> {
    if (!["start", "stop", "quarantine", "delete"].includes(operation.kind) || allowedStatuses.length === 0) {
      throw new ComputersError("invalid_request", "Invalid lifecycle operation", 400);
    }
    const transaction = this.database.transaction(() => {
      const existing = this.database.query(`SELECT * FROM operations WHERE tenant_id = ? AND computer_id = ?
        AND kind IN ('start','stop','quarantine','delete') AND idempotency_key = ?`)
        .get(operation.tenantId, operation.computerId, operation.idempotencyKey) as Row | null;
      if (existing !== null) {
        const value = operationFromRow(existing);
        if (value.kind !== operation.kind || stableJson(value.request) !== stableJson(operation.request)) {
          throw new ComputersError("conflict", "Idempotency key was used with a different request", 409);
        }
        return { value, created: false };
      }
      const activeLifecycle = () => this.database.query(`SELECT 1 FROM operations WHERE tenant_id = ? AND computer_id = ?
        AND kind IN ('create','start','stop','quarantine','delete','restore')
        AND status IN ('pending','accepted','running','unknown') LIMIT 1`)
        .get(operation.tenantId, operation.computerId) as Row | null;
      if (activeLifecycle() !== null) throw new ComputersError("conflict", "Computer already has an active lifecycle operation", 409);
      const current = this.database.query("SELECT status FROM computers WHERE tenant_id = ? AND id = ?")
        .get(operation.tenantId, operation.computerId) as Row | null;
      if (current === null) throw new ComputersError("not_found", "Computer not found", 404);
      const status = String(current.status) as ComputerStatus;
      if (!allowedStatuses.includes(status)) throw new ComputersError("conflict", `Computer cannot ${operation.kind} from ${status}`, 409);
      const capability = operation.kind === "start" ? this.getHomeLeaseCapability(operation.tenantId, operation.computerId) : undefined;
      if (operation.kind === "start" && capability === undefined) throw new ComputersError("stale_fence", "Start requires a current home lease capability", 409);
      try {
        this.#insertOperation(operation);
      } catch (error) {
        if (!isActiveLifecycleConstraint(error)) throw error;
        if (activeLifecycle() === null) throw error;
        throw new ComputersError("conflict", "Computer already has an active lifecycle operation", 409);
      }
      if (capability !== undefined) this.#setOperationHomeLeaseInTransaction(operation.id, capability);
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
    return this.claimProviderAttempt(operation).attempt;
  }

  claimProviderAttempt(operation: Operation): ProviderAttemptClaim {
    const transaction = this.database.transaction(() => {
      const stored = this.database.query(`SELECT o.computer_id, o.kind, o.status, o.policy_generation, o.idempotency_key,
        o.fence AS operation_fence, c.policy_generation AS computer_generation
        FROM operations o JOIN computers c ON c.tenant_id = o.tenant_id AND c.id = o.computer_id
        WHERE o.tenant_id = ? AND o.id = ?`).get(operation.tenantId, operation.id) as Row | null;
      if (stored === null) throw new ComputersError("not_found", "Operation not found", 404);
      if (stored.computer_id !== operation.computerId || stored.kind !== operation.kind
        || Number(stored.policy_generation) !== operation.policyGeneration || stored.idempotency_key !== operation.idempotencyKey) {
        throw new ComputersError("conflict", "Provider attempt operation identity is stale", 409);
      }
      const existing = this.database.query("SELECT * FROM operation_attempts WHERE tenant_id = ? AND operation_id = ? ORDER BY attempt_number DESC LIMIT 1")
        .get(operation.tenantId, operation.id) as Row | null;
      const active = ["pending", "accepted", "running", "unknown"].includes(String(stored.status));
      const policyFenced = Number(stored.policy_generation) !== Number(stored.computer_generation);
      const storedFence = Number(stored.operation_fence);
      if (!active) {
        if (existing !== null) return { attempt: attemptFromRow(existing), mode: "busy" as const };
        throw new ComputersError("conflict", "Operation is not available for provider execution", 409);
      }
      if (policyFenced && existing === null) {
        throw new ComputersError("policy_generation_mismatch", "Policy generation changed before operation execution", 409);
      }
      if (!policyFenced && storedFence !== operation.fence) {
        throw new ComputersError("stale_fence", "Stale operation fence", 409);
      }
      const now = nowIso();
      const executionOwnerToken = makeId("own");
      const executionOwnerExpiresAt = new Date(Date.parse(now) + PROVIDER_ATTEMPT_LEASE_MS).toISOString();
      if (existing !== null) {
        const attempt = attemptFromRow(existing);
        const validFencedReconciliation = policyFenced && attempt.fence < storedFence
          && (operation.fence === attempt.fence || operation.fence === storedFence);
        if (attempt.fence !== operation.fence && !validFencedReconciliation) {
          throw new ComputersError("stale_fence", "Stale provider attempt fence", 409);
        }
        if (["succeeded", "failed"].includes(attempt.status)
          || (attempt.executionOwnerToken !== undefined && attempt.executionOwnerExpiresAt !== undefined
            && Date.parse(attempt.executionOwnerExpiresAt) > Date.parse(now))) return { attempt, mode: "busy" as const };
        const executionOwnerGeneration = attempt.executionOwnerGeneration + 1;
        const claimed = this.database.query(`UPDATE operation_attempts SET execution_owner_token = ?, execution_owner_generation = ?, execution_owner_expires_at = ?
          WHERE tenant_id = ? AND id = ? AND status IN ('running','unknown')
          AND (execution_owner_token IS NULL OR execution_owner_expires_at IS NULL OR execution_owner_expires_at <= ?)`)
          .run(executionOwnerToken, executionOwnerGeneration, executionOwnerExpiresAt, operation.tenantId, attempt.id, now);
        if (claimed.changes !== 1) {
          const current = this.database.query("SELECT * FROM operation_attempts WHERE tenant_id = ? AND id = ?").get(operation.tenantId, attempt.id) as Row | null;
          if (current === null) throw new ComputersError("storage_error", "Provider attempt disappeared during claim", 500);
          return { attempt: attemptFromRow(current), mode: "busy" as const, ...(policyFenced ? { policyFenced: true } : {}) };
        }
        return { attempt: { ...attempt, executionOwnerToken, executionOwnerGeneration, executionOwnerExpiresAt }, mode: "reconcile" as const,
          ...(policyFenced ? { policyFenced: true } : {}) };
      }
      const attempt: ProviderAttempt = {
        id: makeId("pat"), tenantId: operation.tenantId, operationId: operation.id, attemptNumber: 1,
        providerIdempotencyKey: `provider:${operation.id}`, status: "running", fence: operation.fence,
        executionOwnerToken, executionOwnerGeneration: 1, executionOwnerExpiresAt, startedAt: now,
      };
      this.database.query(`INSERT INTO operation_attempts
        (id, tenant_id, operation_id, attempt_number, provider_idempotency_key, status, fence, execution_owner_token, execution_owner_generation, execution_owner_expires_at, started_at)
        VALUES (?, ?, ?, ?, ?, 'running', ?, ?, ?, ?, ?)`).run(attempt.id, attempt.tenantId, attempt.operationId, attempt.attemptNumber,
        attempt.providerIdempotencyKey, attempt.fence, executionOwnerToken, attempt.executionOwnerGeneration, executionOwnerExpiresAt, attempt.startedAt);
      const started = this.database.query(`UPDATE operations SET status = 'running', updated_at = ?
        WHERE tenant_id = ? AND id = ? AND status IN ('pending','accepted') AND fence = ? AND policy_generation = ?
        AND policy_generation = (SELECT policy_generation FROM computers WHERE tenant_id = ? AND id = operations.computer_id)`)
        .run(now, operation.tenantId, operation.id, operation.fence, operation.policyGeneration, operation.tenantId);
      if (started.changes !== 1) throw new ComputersError("policy_generation_mismatch", "Policy generation changed before operation execution", 409);
      return { attempt, mode: "perform" as const };
    });
    return transaction.immediate();
  }

  renewProviderAttemptOwnership(attempt: ProviderAttempt): void {
    if (attempt.executionOwnerToken === undefined) throw new ComputersError("conflict", "Provider attempt has no execution owner", 409);
    const expiresAt = new Date(Date.now() + PROVIDER_ATTEMPT_LEASE_MS).toISOString();
    const renewed = this.database.query(`UPDATE operation_attempts SET execution_owner_expires_at = ?
      WHERE tenant_id = ? AND id = ? AND operation_id = ? AND fence = ? AND status IN ('running','unknown')
      AND execution_owner_token = ? AND execution_owner_generation = ? AND execution_owner_expires_at > ?`)
      .run(expiresAt, attempt.tenantId, attempt.id, attempt.operationId, attempt.fence, attempt.executionOwnerToken, attempt.executionOwnerGeneration, nowIso());
    if (renewed.changes !== 1) throw new ComputersError("conflict", "Provider attempt execution ownership was lost", 409);
    attempt.executionOwnerExpiresAt = expiresAt;
  }

  assertProviderAttemptOwnership(attempt: ProviderAttempt): void {
    if (attempt.executionOwnerToken === undefined || attempt.executionOwnerExpiresAt === undefined || attempt.executionOwnerGeneration < 1) {
      throw new ComputersError("conflict", "Provider attempt has no execution owner", 409);
    }
    const row = this.database.query(`SELECT 1 AS current FROM operation_attempts
      WHERE tenant_id = ? AND id = ? AND operation_id = ? AND fence = ? AND status IN ('running','unknown')
      AND execution_owner_token = ? AND execution_owner_generation = ? AND execution_owner_expires_at > ?`)
      .get(attempt.tenantId, attempt.id, attempt.operationId, attempt.fence, attempt.executionOwnerToken, attempt.executionOwnerGeneration, nowIso()) as Row | null;
    if (row === null) throw new ComputersError("conflict", "Provider attempt execution ownership was lost", 409);
  }

  recordProviderOwnershipLost(attempt: ProviderAttempt, resource?: ProviderOutcome["resource"]): void {
    const safeResource = resource === undefined ? undefined : inspectProviderResource(resource);
    const transaction = this.database.transaction(() => {
      const now = nowIso();
      const current = this.database.query(`SELECT a.status AS attempt_status, o.status AS operation_status, o.computer_id, o.kind, c.provider
        FROM operation_attempts a JOIN operations o ON o.tenant_id = a.tenant_id AND o.id = a.operation_id
        JOIN computers c ON c.tenant_id = o.tenant_id AND c.id = o.computer_id
        WHERE a.tenant_id = ? AND a.id = ? AND a.operation_id = ? AND a.fence = ?`)
        .get(attempt.tenantId, attempt.id, attempt.operationId, attempt.fence) as Row | null;
      if (current === null || !["running", "unknown"].includes(String(current.attempt_status))
        || !["running", "unknown"].includes(String(current.operation_status))) return;
      this.database.query("UPDATE operations SET status = 'unknown', error_code = 'provider_outcome_unknown', updated_at = ? WHERE tenant_id = ? AND id = ? AND status IN ('running','unknown')")
        .run(now, attempt.tenantId, attempt.operationId);
      this.#revokeResidentAuthorityInTransaction(attempt.tenantId, String(current.computer_id), now);
      this.database.query("UPDATE computers SET status = 'quarantined', updated_at = ? WHERE tenant_id = ? AND id = ? AND status NOT IN ('deleted','deleting')")
        .run(now, attempt.tenantId, String(current.computer_id));
      if (safeResource !== undefined) this.#upsertProviderBindingInTransaction({ tenantId: attempt.tenantId, computerId: String(current.computer_id),
        provider: String(current.provider) as ProviderKind, resource: safeResource, operationId: attempt.operationId, attemptId: attempt.id, state: "unknown", fence: attempt.fence, updatedAt: now });
    });
    transaction.immediate();
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

  getProviderAssurance(tenantId: string, computerId: string): ProviderAssuranceRecord | undefined {
    const row = this.database.query("SELECT * FROM provider_assurance WHERE tenant_id = ? AND computer_id = ?").get(tenantId, computerId) as Row | null;
    return row === null ? undefined : assuranceFromRow(row);
  }

  listComputerVolumes(tenantId: string, computerId: string): ComputerVolume[] {
    return (this.database.query("SELECT * FROM volumes WHERE tenant_id = ? AND computer_id = ? ORDER BY kind").all(tenantId, computerId) as Row[]).map(volumeFromRow);
  }

  createProfile(profile: ComputerProfile, audit: AuditRecord): MutationResult<ComputerProfile> {
    if (RESERVED_PROFILE_IDS.includes(profile.id)) throw new ComputersError("invalid_request", "Profile id is reserved for a built-in profile", 400);
    const transaction = this.database.transaction(() => {
      const existing = this.getProfile(profile.tenantId, profile.id);
      if (existing !== undefined) {
        if (existing.digest !== profile.digest || existing.name !== profile.name) throw new ComputersError("conflict", "Profile id already exists", 409);
        return { value: existing, created: false };
      }
      try {
        this.database.query("INSERT INTO profiles (id, tenant_id, name, created_at) VALUES (?, ?, ?, ?)")
          .run(profile.id, profile.tenantId, profile.name, profile.createdAt);
        this.database.query(`INSERT INTO profile_revisions
          (id, profile_id, tenant_id, generation, digest, document_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
          .run(makeId("prv"), profile.id, profile.tenantId, profile.generation, profile.digest, stableJson(profile.document), profile.createdAt);
      } catch (error) {
        if (String(error).includes("UNIQUE constraint failed")) throw new ComputersError("conflict", "Profile name or revision already exists", 409);
        throw error;
      }
      this.#appendAuditInTransaction(profile.tenantId, audit);
      return { value: profile, created: true };
    });
    return transaction.immediate();
  }

  getProfile(tenantId: string, id: string): ComputerProfile | undefined {
    const row = this.database.query(`SELECT p.id, p.tenant_id, p.name, r.generation, r.digest, r.document_json,
      r.created_at AS revision_created_at FROM profiles p JOIN profile_revisions r ON r.profile_id = p.id AND r.tenant_id = p.tenant_id
      WHERE p.tenant_id = ? AND p.id = ? ORDER BY r.generation DESC LIMIT 1`).get(tenantId, id) as Row | null;
    return row === null ? undefined : profileFromRow(row);
  }

  listProfiles(tenantId: string): ComputerProfile[] {
    return (this.database.query(`SELECT p.id, p.tenant_id, p.name, r.generation, r.digest, r.document_json,
      r.created_at AS revision_created_at FROM profiles p JOIN profile_revisions r ON r.profile_id = p.id AND r.tenant_id = p.tenant_id
      WHERE p.tenant_id = ? AND r.generation = (SELECT MAX(r2.generation) FROM profile_revisions r2 WHERE r2.tenant_id = p.tenant_id AND r2.profile_id = p.id)
      ORDER BY p.name, p.id`).all(tenantId) as Row[]).map(profileFromRow);
  }

  recordProviderUnknown(attempt: ProviderAttempt, outcome: Extract<ProviderOutcome, { kind: "unknown" }>): void {
    const inspection = inspectProviderOutcome(outcome);
    if (inspection.kind === "valid" && inspection.outcome.kind === "unknown") {
      this.#recordProviderIndeterminate(attempt, inspection.outcome, false);
      return;
    }
    const resource = inspection.kind === "malformed" ? inspection.resource : inspection.outcome.resource;
    this.recordProviderMalformed(attempt, {
      kind: "malformed", providerOperationId: attempt.providerOperationId ?? attempt.providerIdempotencyKey,
      message: "Provider returned a malformed outcome",
      ...(resource === undefined ? {} : { resource }),
    });
  }

  recordProviderMalformed(attempt: ProviderAttempt, outcome: ProviderMalformedOutcome): void {
    const inspection = inspectProviderMalformedOutcome(outcome);
    this.#recordProviderIndeterminate(attempt, {
      kind: "malformed",
      providerOperationId: inspection.providerOperationId ?? attempt.providerOperationId ?? attempt.providerIdempotencyKey,
      message: inspection.message ?? "Provider returned a malformed outcome",
      ...(inspection.resource === undefined ? {} : { resource: inspection.resource }),
    }, true);
  }

  #recordProviderIndeterminate(attempt: ProviderAttempt, outcome: Extract<ProviderOutcome, { kind: "unknown" }> | ProviderMalformedOutcome,
    preserveComputerState: boolean): void {
    const transaction = this.database.transaction(() => {
      const now = nowIso();
      const current = this.database.query(`SELECT a.status AS attempt_status, a.operation_id, a.fence AS attempt_fence,
        a.execution_owner_token, a.execution_owner_generation, a.execution_owner_expires_at, o.computer_id, o.kind, o.status AS operation_status, c.provider
        FROM operation_attempts a JOIN operations o ON o.tenant_id = a.tenant_id AND o.id = a.operation_id
        JOIN computers c ON c.tenant_id = o.tenant_id AND c.id = o.computer_id
        WHERE a.tenant_id = ? AND a.id = ?`).get(attempt.tenantId, attempt.id) as Row | null;
      if (current === null || current.operation_id !== attempt.operationId || Number(current.attempt_fence) !== attempt.fence
        || attempt.executionOwnerToken === undefined || current.execution_owner_token !== attempt.executionOwnerToken
        || Number(current.execution_owner_generation) !== attempt.executionOwnerGeneration || Date.parse(String(current.execution_owner_expires_at)) <= Date.parse(now)
        || !["running", "unknown"].includes(String(current.attempt_status))) throw new ComputersError("conflict", "Provider attempt is not reconcilable", 409);
      const firstUnknown = current.attempt_status === "running";
      this.database.query("UPDATE operation_attempts SET status = 'unknown', provider_operation_id = ?, resource_json = ?, execution_owner_token = NULL, execution_owner_expires_at = NULL WHERE tenant_id = ? AND id = ? AND status IN ('running','unknown') AND execution_owner_token = ? AND execution_owner_generation = ?")
        .run(outcome.providerOperationId, outcome.resource === undefined ? null : stableJson(outcome.resource), attempt.tenantId, attempt.id, attempt.executionOwnerToken, attempt.executionOwnerGeneration);
      this.database.query("UPDATE operations SET status = 'unknown', error_code = 'provider_outcome_unknown', updated_at = ? WHERE tenant_id = ? AND id = ? AND status IN ('running','unknown')")
        .run(now, attempt.tenantId, attempt.operationId);
      const bindingResource = outcome.resource ?? this.getProviderBinding(attempt.tenantId, String(current.computer_id))?.resource;
      if (bindingResource !== undefined) this.#upsertProviderBindingInTransaction({
        tenantId: attempt.tenantId, computerId: String(current.computer_id), provider: String(current.provider) as ProviderKind,
        resource: bindingResource, operationId: attempt.operationId, attemptId: attempt.id, state: "unknown", fence: attempt.fence, updatedAt: now,
      });
      const authorityRevoked = this.#revokeIndeterminateAuthorityIfNeededInTransaction(attempt.tenantId,
        String(current.computer_id), String(current.kind), String(current.provider), now);
      if (authorityRevoked) {
        if (!preserveComputerState) {
          this.database.query("UPDATE computers SET status = 'quarantined', updated_at = ? WHERE tenant_id = ? AND id = ? AND status NOT IN ('deleted','deleting')")
            .run(now, attempt.tenantId, String(current.computer_id));
        }
      }
      if (firstUnknown) this.#appendAuditInTransaction(attempt.tenantId, {
        actorPrincipalId: "principal_worker", action: `computer.${String(current.kind)}.unknown`,
        data: {
          operationId: attempt.operationId, attemptId: attempt.id, providerOperationId: outcome.providerOperationId,
          ...(preserveComputerState ? { provenance: "malformed_provider_outcome" } : {}),
        }, computerId: String(current.computer_id),
      });
    });
    transaction.immediate();
  }

  completeProviderOperation(operationInput: Operation, attempt: ProviderAttempt, outcomeInput: Exclude<ProviderOutcome, { kind: "unknown" }>): Operation {
    if (operationInput.tenantId !== attempt.tenantId || operationInput.id !== attempt.operationId) {
      throw new ComputersError("conflict", "Provider attempt does not match operation", 409);
    }
    const inspection = inspectProviderOutcome(outcomeInput);
    if (inspection.kind === "malformed") {
      this.recordProviderMalformed(attempt, {
        kind: "malformed", providerOperationId: attempt.providerOperationId ?? attempt.providerIdempotencyKey,
        message: inspection.message, ...(inspection.resource === undefined ? {} : { resource: inspection.resource }),
      });
      const updated = this.getOperation(attempt.tenantId, attempt.operationId);
      if (updated === undefined) throw new ComputersError("storage_error", "Storage consistency error", 500);
      return updated;
    }
    if (inspection.outcome.kind === "unknown") {
      this.recordProviderUnknown(attempt, inspection.outcome);
      const updated = this.getOperation(attempt.tenantId, attempt.operationId);
      if (updated === undefined) throw new ComputersError("storage_error", "Storage consistency error", 500);
      return updated;
    }
    const outcome = inspection.outcome;
    const transaction = this.database.transaction(() => {
      const now = nowIso();
      const success = outcome.kind === "success";
      const result = success ? snapshotJsonRecord(outcome.result) : undefined;
      const errorCode = success ? null : outcome.code;
      const operation = this.getOperation(attempt.tenantId, attempt.operationId);
      if (operation === undefined) throw new ComputersError("storage_error", "Storage consistency error", 500);
      const current = this.database.query(`SELECT a.status AS attempt_status, a.operation_id, a.fence AS attempt_fence,
        o.status AS operation_status, o.fence AS operation_fence, o.policy_generation AS operation_generation,
        c.policy_generation AS computer_generation, c.provider, a.execution_owner_token, a.execution_owner_generation, a.execution_owner_expires_at
        FROM operation_attempts a JOIN operations o ON o.tenant_id = a.tenant_id AND o.id = a.operation_id
        JOIN computers c ON c.tenant_id = o.tenant_id AND c.id = o.computer_id
        WHERE a.tenant_id = ? AND a.id = ?`).get(attempt.tenantId, attempt.id) as Row | null;
      if (current === null || current.operation_id !== operation.id || Number(current.attempt_fence) !== attempt.fence
        || attempt.executionOwnerToken === undefined || current.execution_owner_token !== attempt.executionOwnerToken
        || Number(current.execution_owner_generation) !== attempt.executionOwnerGeneration || Date.parse(String(current.execution_owner_expires_at)) <= Date.parse(now)) {
        throw new ComputersError("conflict", "Provider attempt does not match operation", 409);
      }
      if (["succeeded", "failed"].includes(String(current.attempt_status))) {
        const existing = this.getOperation(operation.tenantId, operation.id);
        if (existing === undefined) throw new ComputersError("storage_error", "Storage consistency error", 500);
        return existing;
      }
      if (Number(current.operation_generation) !== Number(current.computer_generation) || Number(current.operation_fence) !== attempt.fence) {
        if (!success) {
          this.database.query("UPDATE operation_attempts SET status = 'failed', resource_json = ?, execution_owner_expires_at = NULL, completed_at = ? WHERE tenant_id = ? AND id = ? AND status IN ('running','unknown') AND execution_owner_token = ? AND execution_owner_generation = ?")
            .run(outcome.resource === undefined ? null : stableJson(outcome.resource), now, attempt.tenantId, attempt.id, attempt.executionOwnerToken, attempt.executionOwnerGeneration);
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
      if (success && (operation.kind === "start" || operation.kind === "restore")) {
        const lease = this.database.query(`SELECT ol.computer_id, ol.home_id, ol.holder_id, ol.fence, ol.expires_at,
          hl.holder_id AS current_holder_id, hl.fence AS current_fence, hl.expires_at AS current_expires_at
          FROM operation_home_leases ol LEFT JOIN home_leases hl
            ON hl.tenant_id = ol.tenant_id AND hl.computer_id = ol.computer_id
          WHERE ol.tenant_id = ? AND ol.operation_id = ?`).get(operation.tenantId, operation.id) as Row | null;
        if (lease === null || lease.computer_id !== operation.computerId || lease.home_id !== `home:${operation.computerId}`
          || lease.holder_id !== lease.current_holder_id || Number(lease.fence) !== Number(lease.current_fence)
          || String(lease.expires_at) !== String(lease.current_expires_at) || Date.parse(String(lease.current_expires_at)) <= Date.parse(now)) {
          throw new ComputersError("stale_fence", "Provider result is fenced by a newer home lease", 409);
        }
      }
      const lifecycleResolution = success
        ? resolveCompletedComputerStatus(operation, result)
        : { kind: "not_required" } as const;
      if (success && lifecycleResolution.kind === "invalid") {
        const firstUnknown = current.attempt_status === "running";
        const attemptUpdate = this.database.query(`UPDATE operation_attempts
          SET status = 'unknown', resource_json = ?, execution_owner_token = NULL, execution_owner_expires_at = NULL
          WHERE tenant_id = ? AND id = ? AND status IN ('running','unknown')
          AND execution_owner_token = ? AND execution_owner_generation = ?`)
          .run(outcome.resource === undefined ? null : stableJson(outcome.resource), attempt.tenantId, attempt.id,
            attempt.executionOwnerToken, attempt.executionOwnerGeneration);
        if (attemptUpdate.changes !== 1) throw new ComputersError("conflict", "Provider attempt was completed concurrently", 409);
        const operationUpdate = this.database.query(`UPDATE operations
          SET status = 'unknown', result_json = NULL, error_code = 'provider_outcome_unknown', updated_at = ?
          WHERE tenant_id = ? AND id = ? AND status IN ('running','unknown') AND fence = ? AND policy_generation = ?`)
          .run(now, operation.tenantId, operation.id, attempt.fence, operation.policyGeneration);
        if (operationUpdate.changes !== 1) throw new ComputersError("conflict", "Operation was completed concurrently", 409);
        const bindingResource = outcome.resource ?? this.getProviderBinding(operation.tenantId, operation.computerId)?.resource;
        if (bindingResource !== undefined) this.#upsertProviderBindingInTransaction({
          tenantId: operation.tenantId, computerId: operation.computerId, provider: String(current.provider) as ProviderKind,
          resource: bindingResource, operationId: operation.id, attemptId: attempt.id, state: "unknown", fence: attempt.fence, updatedAt: now,
        });
        this.#revokeIndeterminateAuthorityIfNeededInTransaction(operation.tenantId, operation.computerId,
          operation.kind, String(current.provider), now);
        if (firstUnknown) this.#appendAuditInTransaction(operation.tenantId, {
          actorPrincipalId: "principal_worker", action: `computer.${operation.kind}.unknown`,
          data: { operationId: operation.id, attemptId: attempt.id, outcome: "success", reason: "invalid_observed_lifecycle" },
          computerId: operation.computerId,
        });
        const updated = this.getOperation(operation.tenantId, operation.id);
        if (updated === undefined) throw new ComputersError("storage_error", "Storage consistency error", 500);
        return updated;
      }
      const terminalComputerStatus = lifecycleResolution.kind === "observed" ? lifecycleResolution.status : undefined;
      const attemptUpdate = this.database.query("UPDATE operation_attempts SET status = ?, resource_json = ?, execution_owner_expires_at = NULL, completed_at = ? WHERE tenant_id = ? AND id = ? AND status IN ('running','unknown') AND execution_owner_token = ? AND execution_owner_generation = ?")
        .run(success ? "succeeded" : "failed", outcome.resource === undefined ? null : stableJson(outcome.resource), now, attempt.tenantId, attempt.id, attempt.executionOwnerToken, attempt.executionOwnerGeneration);
      if (attemptUpdate.changes !== 1) throw new ComputersError("conflict", "Provider attempt was completed concurrently", 409);
      const operationUpdate = this.database.query("UPDATE operations SET status = ?, result_json = ?, error_code = ?, updated_at = ? WHERE tenant_id = ? AND id = ? AND status IN ('running','unknown') AND fence = ? AND policy_generation = ?")
        .run(success ? "succeeded" : "failed", result === undefined ? null : stableJson(result), errorCode, now, operation.tenantId, operation.id, attempt.fence, operation.policyGeneration);
      if (operationUpdate.changes !== 1) throw new ComputersError("conflict", "Operation was completed concurrently", 409);
      if (success && terminalComputerStatus !== undefined) {
        this.database.query("UPDATE computers SET status = ?, updated_at = ? WHERE tenant_id = ? AND id = ?")
          .run(terminalComputerStatus, now, operation.tenantId, operation.computerId);
        // Safe retirement: once a Computer is durably deleted, retire its active assignment so the
        // released owner can be assigned a new Computer (e.g. re-adopting the same physical host).
        // The one-active-Computer-per-owner policy is preserved because the assignment stays active
        // for every non-deleted status, mirroring the computers_one_active_owner partial index.
        if (terminalComputerStatus === "deleted") {
          this.database.query("UPDATE assignments SET active = 0, ended_at = ? WHERE tenant_id = ? AND computer_id = ? AND active = 1")
            .run(now, operation.tenantId, operation.computerId);
        }
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
      if (success && result?.assurance !== undefined) {
        const evidence = validateProviderAssurance(result.assurance);
        validateProviderConfinement(String(current.provider) as ProviderKind, evidence.confinementClass);
        this.database.query(`INSERT INTO provider_assurance
          (tenant_id, computer_id, provider, confinement_class, evidence_json, operation_id, attempt_id, binding_fence, generation, verified_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (tenant_id, computer_id) DO UPDATE SET provider = excluded.provider,
          confinement_class = excluded.confinement_class, evidence_json = excluded.evidence_json,
          operation_id = excluded.operation_id, attempt_id = excluded.attempt_id,
          binding_fence = excluded.binding_fence, generation = excluded.generation, verified_at = excluded.verified_at
          WHERE excluded.generation >= provider_assurance.generation AND excluded.binding_fence >= provider_assurance.binding_fence`)
          .run(operation.tenantId, operation.computerId, String(current.provider), evidence.confinementClass,
            stableJson(evidence), operation.id, attempt.id, attempt.fence, operation.policyGeneration, now);
        this.database.query("UPDATE computers SET confinement_class = ?, updated_at = ? WHERE tenant_id = ? AND id = ?")
          .run(evidence.confinementClass, now, operation.tenantId, operation.computerId);
      }
      if (success && result?.volumes !== undefined && typeof result.volumes === "object" && result.volumes !== null && !Array.isArray(result.volumes)) {
        const volumes = result.volumes as Record<string, unknown>;
        for (const kind of ["root", "home"] as const) {
          const reference = volumes[kind];
          if (typeof reference === "string" && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,511}$/.test(reference)) {
            const state = operation.kind === "delete"
              ? (kind === "home" && result.retainHome === true ? "detached" : "deleted")
              : (kind === "home" && result.homeUsable !== true ? "detached" : "attached");
            this.database.query("UPDATE volumes SET provider_ref = ?, fence = fence + 1, state = ?, updated_at = ? WHERE tenant_id = ? AND computer_id = ? AND kind = ?")
              .run(reference, state, now, operation.tenantId, operation.computerId, kind);
          }
        }
      }
      if (success && result?.residentBindingVerified === true && operation.kind !== "delete" && outcome.resource !== undefined && outcome.resource.instanceId !== undefined && outcome.resource.bootId !== undefined) {
        const previous = this.database.query("SELECT generation FROM resident_bindings WHERE tenant_id = ? AND computer_id = ?")
          .get(operation.tenantId, operation.computerId) as Row | null;
        this.#setResidentBindingInTransaction({
          tenantId: operation.tenantId, computerId: operation.computerId,
          provider: String(current.provider) as ProviderKind, providerResourceId: outcome.resource.resourceId,
          instanceId: outcome.resource.instanceId, bootId: outcome.resource.bootId, generation: previous === null ? 1 : Number(previous.generation) + 1, updatedAt: now,
        });
      }
      if (success && ["stop", "quarantine", "delete"].includes(operation.kind)) {
        this.#revokeResidentAuthorityInTransaction(operation.tenantId, operation.computerId, now);
      }
      if (!success && operation.kind === "create") {
        this.database.query("UPDATE child_reservations SET state = 'released', updated_at = ? WHERE tenant_id = ? AND child_computer_id = ? AND state IN ('reserved','active')")
          .run(now, operation.tenantId, operation.computerId);
      }
      this.#appendAuditInTransaction(operation.tenantId, {
        actorPrincipalId: "principal_worker", action: success ? `computer.${operation.kind}.succeeded` : `computer.${operation.kind}.failed`,
        data: { operationId: operation.id, attemptId: attempt.id, outcome: outcome.kind,
          ...(success && terminalComputerStatus !== undefined ? { computerStatus: terminalComputerStatus } : {}) }, computerId: operation.computerId,
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
      this.#setOperationHomeLeaseInTransaction(operationId, capability);
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

  #setOperationHomeLeaseInTransaction(operationId: string, capability: HomeLeaseCapability): void {
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
      if (row.revoked_at !== null || row.used_at !== null || Date.parse(String(row.expires_at)) <= Date.parse(now)) {
        throw new ComputersError(row.used_at === null ? "expired" : "replay_detected", "Enrollment denied", 401);
      }
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
    const transaction = this.database.transaction(() => {
      const row = this.database.query(`SELECT i.provider, i.instance_id, i.boot_id, i.generation AS identity_generation,
        i.binding_generation, i.expires_at AS identity_expires_at, i.revoked_at,
        c.status AS computer_status, c.policy_generation AS computer_generation,
        b.provider AS binding_provider, b.instance_id AS binding_instance_id, b.boot_id AS binding_boot_id, b.generation AS binding_generation_current,
        o.kind AS operation_kind, o.request_json, o.fence AS operation_fence, o.policy_generation AS operation_generation,
        a.status AS attempt_status, a.fence AS attempt_fence
        FROM resident_identities i
        JOIN computers c ON c.tenant_id = i.tenant_id AND c.id = i.computer_id
        JOIN resident_bindings b ON b.tenant_id = i.tenant_id AND b.computer_id = i.computer_id
        JOIN operations o ON o.tenant_id = i.tenant_id AND o.id = ? AND o.computer_id = i.computer_id
        JOIN operation_attempts a ON a.tenant_id = o.tenant_id AND a.operation_id = o.id AND a.id = ?
        WHERE i.certificate_id = ? AND i.tenant_id = ? AND i.computer_id = ?`)
        .get(envelope.operationId, envelope.attemptId, envelope.certificateId, envelope.tenantId, envelope.computerId) as Row | null;
      if (row === null || row.revoked_at !== null || Date.parse(String(row.identity_expires_at)) <= Date.parse(now)
        || row.computer_status !== "running" || !["running", "unknown"].includes(String(row.attempt_status))) {
        throw new ComputersError("authentication_required", "Resident authentication failed", 401);
      }
      if (row.provider !== row.binding_provider || row.instance_id !== row.binding_instance_id || row.boot_id !== row.binding_boot_id
        || Number(row.binding_generation) !== Number(row.binding_generation_current)) throw new ComputersError("authentication_required", "Resident authentication failed", 401);
      if (Number(row.identity_generation) !== Number(row.computer_generation) || Number(row.computer_generation) !== envelope.policyGeneration
        || Number(row.operation_generation) !== envelope.policyGeneration) throw new ComputersError("policy_generation_mismatch", "Resident operation rejected", 409);
      const allowedKinds: Record<ResidentOperationEnvelope["capability"], OperationKind[]> = {
        exec: ["exec"], install: ["install"], status: ["create", "start", "stop", "quarantine", "delete", "exec", "install", "snapshot", "restore"],
        cancel: ["create", "start", "stop", "quarantine", "delete", "exec", "install", "snapshot", "restore"],
      };
      const capabilityKinds = allowedKinds[envelope.capability];
      if (capabilityKinds === undefined || !capabilityKinds.includes(String(row.operation_kind) as OperationKind)) throw new ComputersError("authorization_denied", "Resident operation rejected", 403);
      if (!constantTimeDigestEqual(envelope.payloadDigest, sha256(JSON.parse(String(row.request_json))))) throw new ComputersError("authorization_denied", "Resident operation rejected", 403);
      if (envelope.fence !== Number(row.operation_fence) || envelope.fence !== Number(row.attempt_fence)) throw new ComputersError("stale_fence", "Resident operation rejected", 409);
      if (Date.parse(envelope.issuedAt) > Date.parse(now) + 30_000 || Date.parse(envelope.expiresAt) <= Date.parse(now)) throw new ComputersError("expired", "Resident operation rejected", 409);
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
      if (revision.generation === currentGeneration) {
        const existing = this.getInstallPolicy(revision.tenantId, revision.computerId, currentGeneration);
        if (existing !== undefined && existing.digest === revision.digest && stableJson(existing.rules) === stableJson(revision.rules)) return existing;
        throw new ComputersError("conflict", "Install policy generation already has a different revision", 409);
      }
      if (revision.generation !== currentGeneration + 1) throw new ComputersError("policy_generation_mismatch", "Policy generation is not monotonic", 409);
      try {
        this.database.query("INSERT INTO install_policy_revisions (id, tenant_id, computer_id, generation, digest, rules_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
          .run(revision.id, revision.tenantId, revision.computerId, revision.generation, revision.digest, stableJson(revision.rules), revision.createdAt);
      } catch (error) {
        if (!isSQLiteConstraint(error)) throw error;
        const existing = this.getInstallPolicy(revision.tenantId, revision.computerId, revision.generation);
        if (existing !== undefined && existing.digest === revision.digest && stableJson(existing.rules) === stableJson(revision.rules)) return existing;
        throw new ComputersError("conflict", "Install policy generation already has a different revision", 409);
      }
      const advanced = this.database.query("UPDATE computers SET policy_generation = ?, updated_at = ? WHERE tenant_id = ? AND id = ? AND policy_generation = ?")
        .run(revision.generation, revision.createdAt, revision.tenantId, revision.computerId, currentGeneration);
      if (advanced.changes !== 1) throw new ComputersError("conflict", "Install policy was updated concurrently", 409);
      {
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

  #insertOperation(operation: Operation, request: Record<string, unknown> = operation.request): void {
    this.database.query(`INSERT INTO operations
      (id, tenant_id, computer_id, kind, status, policy_generation, idempotency_key, request_json, prior_computer_status, desired_computer_status, fence, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      operation.id, operation.tenantId, operation.computerId, operation.kind, operation.status, operation.policyGeneration, operation.idempotencyKey,
      stableJson(request), operation.priorComputerStatus ?? null, operation.desiredComputerStatus ?? null, operation.fence, operation.createdAt, operation.updatedAt,
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
    this.database.query("UPDATE resident_enrollments SET revoked_at = ? WHERE tenant_id = ? AND computer_id = ? AND revoked_at IS NULL")
      .run(binding.updatedAt, binding.tenantId, binding.computerId);
  }

  #revokeResidentAuthorityInTransaction(tenantId: string, computerId: string, revokedAt: string): void {
    this.database.query("UPDATE resident_identities SET revoked_at = ? WHERE tenant_id = ? AND computer_id = ? AND revoked_at IS NULL")
      .run(revokedAt, tenantId, computerId);
    this.database.query("UPDATE resident_enrollments SET revoked_at = ? WHERE tenant_id = ? AND computer_id = ? AND revoked_at IS NULL")
      .run(revokedAt, tenantId, computerId);
    this.database.query("DELETE FROM resident_bindings WHERE tenant_id = ? AND computer_id = ?").run(tenantId, computerId);
    this.database.query("UPDATE home_leases SET fence = fence + 1, expires_at = ?, updated_at = ? WHERE tenant_id = ? AND computer_id = ?")
      .run(revokedAt, revokedAt, tenantId, computerId);
    this.database.query("DELETE FROM operation_home_leases WHERE tenant_id = ? AND computer_id = ?").run(tenantId, computerId);
    const assurance = this.database.query("SELECT provider, operation_id, attempt_id, binding_fence, generation FROM provider_assurance WHERE tenant_id = ? AND computer_id = ?")
      .get(tenantId, computerId) as Row | null;
    if (assurance !== null && assurance.provider !== "local_machine") {
      const evidence = {
        confinementClass: "unverified_vm", providerSpecificControlsPassed: false, externalEgressEnforced: false,
        residentIndependentIsolation: false, hostMounts: false, hostSockets: false, portForwards: false, containerd: false,
      };
      this.database.query("UPDATE provider_assurance SET confinement_class = 'unverified_vm', evidence_json = ?, verified_at = ? WHERE tenant_id = ? AND computer_id = ?")
        .run(stableJson(evidence), revokedAt, tenantId, computerId);
      this.database.query("UPDATE computers SET confinement_class = 'unverified_vm', updated_at = ? WHERE tenant_id = ? AND id = ?")
        .run(revokedAt, tenantId, computerId);
    }
  }

  #revokeIndeterminateAuthorityIfNeededInTransaction(tenantId: string, computerId: string, operationKind: string,
    provider: string, revokedAt: string): boolean {
    const strictContinuity = this.database.query("SELECT 1 AS present FROM provider_assurance WHERE tenant_id = ? AND computer_id = ? AND confinement_class = 'strict_vm'")
      .get(tenantId, computerId) as Row | null;
    const localVmRunningProofIndeterminate = provider === "local_vm" && ["create", "start", "restore"].includes(operationKind);
    if (!["stop", "quarantine", "delete"].includes(operationKind) && strictContinuity === null && !localVmRunningProofIndeterminate) return false;
    this.#revokeResidentAuthorityInTransaction(tenantId, computerId, revokedAt);
    return true;
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
    const ignoredChecks = this.database.query("PRAGMA ignore_check_constraints").get() as Row | null;
    const migrationHistory = this.#withContentionRetry(() => this.#migrationHistory(), deadline);
    const integrity = this.#withContentionRetry(() => this.database.query("PRAGMA integrity_check").get() as Row | null, deadline);
    const foreignKeyViolations = this.#withContentionRetry(() => this.database.query("PRAGMA foreign_key_check").all(), deadline);
    const expectedJournal = this.#persistent ? "wal" : "memory";
    const schemaStructural = this.#schemaV3IsStructural();
    const schemaBehavior = schemaStructural && this.#withContentionRetry(() => this.#schemaV3RejectsUnsafeRows(), deadline);
    if (journal === null || String(journal.journal_mode).toLowerCase() !== expectedJournal
      || foreignKeys === null || Number(foreignKeys.foreign_keys) !== 1
      || ignoredChecks === null || Number(ignoredChecks.ignore_check_constraints) !== 0
      || migrationHistory === undefined || !this.#validMigrationHistory(migrationHistory, false)
      || integrity === null || Object.values(integrity)[0] !== "ok"
      || foreignKeyViolations.length !== 0
      || !schemaStructural || !schemaBehavior || !this.#schemaV3HasNoUnsafeRows()) {
      throw new ComputersError("storage_error", "Storage initialization failed", 500);
    }
    this.#schemaBehaviorVerified = true;
  }

  #schemaIsCurrent(deadline: number): boolean {
    return this.#withContentionRetry(() => {
      const history = this.#migrationHistory();
      return history !== undefined && this.#validMigrationHistory(history, false);
    }, deadline);
  }

  #migrationHistory(): Array<{ version: number; appliedAt: string }> | undefined {
    const table = this.database.query("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").get() as Row | null;
    if (table === null) return undefined;
    const columns = this.database.query("PRAGMA table_info(schema_migrations)").all() as Row[];
    if (columns.length !== 2 || String(columns[0]?.name) !== "version" || String(columns[0]?.type).toUpperCase() !== "INTEGER"
      || Number(columns[0]?.pk) !== 1 || String(columns[1]?.name) !== "applied_at" || String(columns[1]?.type).toUpperCase() !== "TEXT"
      || Number(columns[1]?.notnull) !== 1 || Number(columns[1]?.pk) !== 0) {
      return [];
    }
    return (this.database.query("SELECT version, applied_at FROM schema_migrations ORDER BY version, rowid").all() as Row[])
      .map((row) => ({ version: Number(row.version), appliedAt: String(row.applied_at) }));
  }

  #validMigrationHistory(history: Array<{ version: number; appliedAt: string }>, allowPrefix: boolean): boolean {
    if (history.length < 1 || history.length > SQLITE_SCHEMA_VERSION || (!allowPrefix && history.length !== SQLITE_SCHEMA_VERSION)) return false;
    let previousTime = Number.NEGATIVE_INFINITY;
    return history.every((entry, index) => {
      const time = Date.parse(entry.appliedAt);
      const hasCanonicalShape = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(entry.appliedAt);
      const canonicalTime = hasCanonicalShape && Number.isFinite(time) && new Date(time).toISOString() === entry.appliedAt;
      const valid = entry.version === index + 1 && canonicalTime && time >= previousTime;
      previousTime = time;
      return valid;
    });
  }

  #schemaV3IsStructural(): boolean {
    const normalizeSql = (sql: string): string => sql.toLowerCase().replace(/\s+/g, " ")
      .replace(/\s*([(),=<>])\s*/g, "$1").trim();
    const objectSql = (type: string, name: string): string | undefined => {
      const row = this.database.query("SELECT sql FROM sqlite_master WHERE type = ? AND name = ?").get(type, name) as Row | null;
      return row?.sql === null || row?.sql === undefined ? undefined : normalizeSql(String(row.sql));
    };
    const hasColumnDefinitions = (table: string, expected: Record<string, { type: string; notNull: number; defaultValue: string | null; primaryKey: number }>): boolean => {
      const rows = this.database.query(`PRAGMA table_info(${table})`).all() as Row[];
      const definitions = new Map(rows.map((row) => [String(row.name), row]));
      return Object.entries(expected).every(([name, definition]) => {
        const row = definitions.get(name);
        return row !== undefined && String(row.type).toUpperCase() === definition.type
          && Number(row.notnull) === definition.notNull && (row.dflt_value === null ? null : String(row.dflt_value)) === definition.defaultValue
          && Number(row.pk) === definition.primaryKey;
      });
    };
    const hasExactForeignKey = (table: string, target: string, from: string[], to: string[]): boolean => {
      const rows = this.database.query(`PRAGMA foreign_key_list(${table})`).all() as Row[];
      const groups = new Map<number, Row[]>();
      for (const row of rows) {
        if (String(row.table) !== target) continue;
        const id = Number(row.id); const group = groups.get(id) ?? [];
        group.push(row); groups.set(id, group);
      }
      return [...groups.values()].some((group) => {
        const ordered = group.sort((left, right) => Number(left.seq) - Number(right.seq));
        return ordered.length === from.length && ordered.every((row, index) => String(row.from) === from[index] && String(row.to) === to[index]
          && String(row.on_update).toUpperCase() === "NO ACTION" && String(row.on_delete).toUpperCase() === "NO ACTION"
          && String(row.match).toUpperCase() === "NONE");
      });
    };
    const hasExactIndex = (table: string, name: string, unique: boolean, columns: string[]): boolean => {
      const listed = (this.database.query(`PRAGMA index_list(${table})`).all() as Row[])
        .find((row) => String(row.name) === name && Boolean(Number(row.unique)) === unique);
      if (listed === undefined || Number(listed.partial) !== 0) return false;
      const actual = (this.database.query(`PRAGMA index_xinfo(${name})`).all() as Row[])
        .filter((row) => Number(row.key) === 1).sort((left, right) => Number(left.seqno) - Number(right.seqno));
      return actual.length === columns.length && actual.every((row, index) => String(row.name) === columns[index]
        && Number(row.desc) === 0 && String(row.coll).toUpperCase() === "BINARY");
    };
    const expectedComputers = normalizeSql(`CREATE TABLE computers (
      id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      slug TEXT NOT NULL,
      provider TEXT NOT NULL CHECK (provider IN ('local_machine', 'local_vm', 'aws_ec2')),
      confinement_class TEXT NOT NULL CHECK (
        (provider = 'local_machine' AND confinement_class = 'dedicated_machine') OR
        (provider IN ('local_vm', 'aws_ec2') AND confinement_class IN ('unverified_vm', 'strict_vm'))
      ),
      status TEXT NOT NULL CHECK (status IN ('provisioning', 'stopped', 'running', 'quarantined', 'deleting', 'deleted', 'error')),
      owner_principal_id TEXT NOT NULL,
      policy_generation INTEGER NOT NULL DEFAULT 1 CHECK (policy_generation > 0),
      data_exfiltration_protection INTEGER NOT NULL CHECK (data_exfiltration_protection IN (0, 1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id, id),
      UNIQUE (tenant_id, slug)
    )`);
    const expectedOperationAttempts = normalizeSql(`CREATE TABLE operation_attempts (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      operation_id TEXT NOT NULL,
      attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
      provider_idempotency_key TEXT NOT NULL,
      provider_operation_id TEXT,
      resource_json TEXT CHECK (resource_json IS NULL OR (json_valid(resource_json) AND json_type(resource_json) = 'object')),
      status TEXT NOT NULL CHECK (status IN ('running', 'unknown', 'succeeded', 'failed')),
      fence INTEGER NOT NULL CHECK (fence >= 0),
      started_at TEXT NOT NULL,
      completed_at TEXT,
      execution_owner_token TEXT,
      execution_owner_generation INTEGER NOT NULL DEFAULT 0 CHECK (execution_owner_generation >= 0),
      execution_owner_expires_at TEXT,
      UNIQUE (tenant_id, operation_id, attempt_number),
      UNIQUE (tenant_id, provider_idempotency_key),
      FOREIGN KEY (tenant_id, operation_id) REFERENCES operations (tenant_id, id)
    )`);
    const expectedProviderAssurance = normalizeSql(`CREATE TABLE provider_assurance (
      tenant_id TEXT NOT NULL,
      computer_id TEXT NOT NULL,
      provider TEXT NOT NULL CHECK (provider IN ('local_machine', 'local_vm', 'aws_ec2')),
      confinement_class TEXT NOT NULL CHECK (confinement_class IN ('dedicated_machine', 'unverified_vm', 'strict_vm') AND (provider <> 'local_vm' OR confinement_class = 'unverified_vm')),
      evidence_json TEXT NOT NULL CHECK (json_valid(evidence_json) AND json_type(evidence_json) = 'object'),
      operation_id TEXT NOT NULL,
      attempt_id TEXT NOT NULL,
      binding_fence INTEGER NOT NULL CHECK (binding_fence >= 0),
      generation INTEGER NOT NULL CHECK (generation > 0),
      verified_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id, computer_id),
      FOREIGN KEY (tenant_id, computer_id, provider) REFERENCES computers (tenant_id, id, provider),
      FOREIGN KEY (tenant_id, operation_id, computer_id) REFERENCES operations (tenant_id, id, computer_id),
      FOREIGN KEY (tenant_id, operation_id, attempt_id) REFERENCES operation_attempts (tenant_id, operation_id, id)
    )`);
    const expectedProviderBindings = normalizeSql(`CREATE TABLE "provider_bindings" (
      tenant_id TEXT NOT NULL,
      computer_id TEXT NOT NULL,
      provider TEXT NOT NULL CHECK (provider IN ('local_machine', 'local_vm', 'aws_ec2')),
      resource_id TEXT NOT NULL,
      instance_id TEXT,
      boot_id TEXT,
      operation_id TEXT NOT NULL,
      attempt_id TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('unknown', 'active', 'released')),
      fence INTEGER NOT NULL CHECK (fence >= 0),
      updated_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id, computer_id),
      FOREIGN KEY (tenant_id, computer_id, provider) REFERENCES computers (tenant_id, id, provider),
      FOREIGN KEY (tenant_id, operation_id, computer_id) REFERENCES operations (tenant_id, id, computer_id),
      FOREIGN KEY (tenant_id, operation_id, attempt_id) REFERENCES operation_attempts (tenant_id, operation_id, id)
    )`);
    const expectedTriggers: Record<string, string> = {
      computers_local_vm_unverified_insert: `CREATE TRIGGER computers_local_vm_unverified_insert
        BEFORE INSERT ON computers WHEN NEW.provider = 'local_vm' AND NEW.confinement_class <> 'unverified_vm'
        BEGIN SELECT RAISE(ABORT, 'stock local_vm must remain unverified_vm'); END`,
      computers_local_vm_unverified_update: `CREATE TRIGGER computers_local_vm_unverified_update
        BEFORE UPDATE OF provider, confinement_class ON computers WHEN NEW.provider = 'local_vm' AND NEW.confinement_class <> 'unverified_vm'
        BEGIN SELECT RAISE(ABORT, 'stock local_vm must remain unverified_vm'); END`,
      provider_assurance_local_vm_unverified_insert: `CREATE TRIGGER provider_assurance_local_vm_unverified_insert
        BEFORE INSERT ON provider_assurance WHEN NEW.provider = 'local_vm' AND NEW.confinement_class <> 'unverified_vm'
        BEGIN SELECT RAISE(ABORT, 'stock local_vm assurance must remain unverified_vm'); END`,
      provider_assurance_local_vm_unverified_update: `CREATE TRIGGER provider_assurance_local_vm_unverified_update
        BEFORE UPDATE OF provider, confinement_class ON provider_assurance WHEN NEW.provider = 'local_vm' AND NEW.confinement_class <> 'unverified_vm'
        BEGIN SELECT RAISE(ABORT, 'stock local_vm assurance must remain unverified_vm'); END`,
    };
    return objectSql("table", "computers") === expectedComputers
      && objectSql("index", "computers_one_active_owner") === normalizeSql(`CREATE UNIQUE INDEX computers_one_active_owner
        ON computers (tenant_id, owner_principal_id) WHERE status NOT IN ('deleted', 'deleting')`)
      && objectSql("index", "provider_bindings_active_resource") === normalizeSql(`CREATE UNIQUE INDEX provider_bindings_active_resource
        ON provider_bindings (tenant_id, provider, resource_id) WHERE state IN ('unknown', 'active')`)
      && objectSql("table", "operation_attempts") === expectedOperationAttempts
      && objectSql("table", "provider_assurance") === expectedProviderAssurance
      && objectSql("table", "provider_bindings") === expectedProviderBindings
      && hasColumnDefinitions("operation_attempts", {
        execution_owner_token: { type: "TEXT", notNull: 0, defaultValue: null, primaryKey: 0 },
        execution_owner_generation: { type: "INTEGER", notNull: 1, defaultValue: "0", primaryKey: 0 },
        execution_owner_expires_at: { type: "TEXT", notNull: 0, defaultValue: null, primaryKey: 0 },
      })
      && hasColumnDefinitions("resident_enrollments", {
        revoked_at: { type: "TEXT", notNull: 0, defaultValue: null, primaryKey: 0 },
      })
      && hasExactForeignKey("profile_revisions", "profiles", ["tenant_id", "profile_id"], ["tenant_id", "id"])
      && hasExactForeignKey("provider_assurance", "computers", ["tenant_id", "computer_id", "provider"], ["tenant_id", "id", "provider"])
      && hasExactForeignKey("provider_assurance", "operations", ["tenant_id", "operation_id", "computer_id"], ["tenant_id", "id", "computer_id"])
      && hasExactForeignKey("provider_assurance", "operation_attempts", ["tenant_id", "operation_id", "attempt_id"], ["tenant_id", "operation_id", "id"])
      && hasExactForeignKey("provider_bindings", "computers", ["tenant_id", "computer_id", "provider"], ["tenant_id", "id", "provider"])
      && hasExactForeignKey("provider_bindings", "operations", ["tenant_id", "operation_id", "computer_id"], ["tenant_id", "id", "computer_id"])
      && hasExactForeignKey("provider_bindings", "operation_attempts", ["tenant_id", "operation_id", "attempt_id"], ["tenant_id", "operation_id", "id"])
      && hasExactIndex("operation_attempts", "operation_attempts_tenant_id_id", true, ["tenant_id", "id"])
      && hasExactIndex("computers", "computers_assurance_provider_key", true, ["tenant_id", "id", "provider"])
      && hasExactIndex("operations", "operations_assurance_computer_key", true, ["tenant_id", "id", "computer_id"])
      && hasExactIndex("operation_attempts", "operation_attempts_assurance_operation_key", true, ["tenant_id", "operation_id", "id"])
      && hasExactIndex("provider_assurance", "provider_assurance_operation_idx", false, ["tenant_id", "operation_id", "computer_id"])
      && hasExactIndex("provider_assurance", "provider_assurance_attempt_idx", false, ["tenant_id", "operation_id", "attempt_id"])
      && hasExactIndex("provider_bindings", "provider_bindings_operation_idx", false, ["tenant_id", "operation_id", "computer_id"])
      && hasExactIndex("provider_bindings", "provider_bindings_attempt_idx", false, ["tenant_id", "operation_id", "attempt_id"])
      && Object.entries(expectedTriggers).every(([name, sql]) => objectSql("trigger", name) === normalizeSql(sql));
  }

  #schemaV3HasNoUnsafeRows(): boolean {
    const computer = this.database.query(`SELECT 1 AS present FROM computers WHERE NOT (
      (provider = 'local_machine' AND confinement_class = 'dedicated_machine') OR
      (provider = 'local_vm' AND confinement_class = 'unverified_vm') OR
      (provider = 'aws_ec2' AND confinement_class IN ('unverified_vm', 'strict_vm'))
    ) LIMIT 1`).get();
    const assurance = this.database.query("SELECT 1 AS present FROM provider_assurance WHERE provider = 'local_vm' AND confinement_class <> 'unverified_vm' LIMIT 1").get();
    const attempt = this.database.query("SELECT 1 AS present FROM operation_attempts WHERE execution_owner_generation < 0 LIMIT 1").get();
    return computer === null && assurance === null && attempt === null && this.#providerBindingsHaveValidProvenance();
  }

  #providerBindingsHaveValidProvenance(): boolean {
    return this.database.query(`SELECT 1 AS present FROM provider_bindings binding
      LEFT JOIN computers computer ON computer.tenant_id = binding.tenant_id AND computer.id = binding.computer_id AND computer.provider = binding.provider
      LEFT JOIN operations operation ON operation.tenant_id = binding.tenant_id AND operation.id = binding.operation_id AND operation.computer_id = binding.computer_id
      LEFT JOIN operation_attempts attempt ON attempt.tenant_id = binding.tenant_id AND attempt.operation_id = binding.operation_id AND attempt.id = binding.attempt_id
      WHERE computer.id IS NULL OR operation.id IS NULL OR attempt.id IS NULL LIMIT 1`).get() === null;
  }

  #schemaV3RejectsUnsafeRows(): boolean {
    const suffix = randomUUID().replaceAll("-", "");
    const savepoint = `schema_v2_readiness_probe_${suffix}`;
    const tenantId = `schema_probe_${suffix}`;
    const now = new Date().toISOString();
    const rejectsWith = (operation: () => void, message?: string): boolean => {
      try {
        operation();
        return false;
      } catch (error) {
        if (!isSQLiteConstraint(error)) throw error;
        return message === undefined || String(error).includes(message);
      }
    };
    let savepointOpen = false;
    try {
      this.database.exec(`SAVEPOINT ${savepoint}`);
      savepointOpen = true;
      this.database.query(`INSERT INTO computers
        (id, tenant_id, slug, provider, confinement_class, status, owner_principal_id, policy_generation, data_exfiltration_protection, created_at, updated_at)
        VALUES (?, ?, ?, 'local_machine', 'dedicated_machine', 'stopped', ?, 1, 0, ?, ?)`)
        .run(`cmp_valid_${suffix}`, tenantId, `valid-${suffix}`, `principal_valid_${suffix}`, now, now);
      this.database.query(`INSERT INTO operations
        (id, tenant_id, computer_id, kind, status, policy_generation, idempotency_key, request_json, fence, created_at, updated_at)
        VALUES (?, ?, ?, 'create', 'running', 1, ?, '{}', 0, ?, ?)`)
        .run(`opn_valid_${suffix}`, tenantId, `cmp_valid_${suffix}`, `schema-probe-${suffix}`, now, now);
      this.database.query(`INSERT INTO operation_attempts
        (id, tenant_id, operation_id, attempt_number, provider_idempotency_key, status, fence, execution_owner_generation, started_at)
        VALUES (?, ?, ?, 1, ?, 'running', 0, 0, ?)`)
        .run(`pat_valid_${suffix}`, tenantId, `opn_valid_${suffix}`, `provider:valid-${suffix}`, now);
      this.database.query(`INSERT INTO computers
        (id, tenant_id, slug, provider, confinement_class, status, owner_principal_id, policy_generation, data_exfiltration_protection, created_at, updated_at)
        VALUES (?, ?, ?, 'local_vm', 'unverified_vm', 'stopped', ?, 1, 0, ?, ?)`)
        .run(`cmp_other_${suffix}`, tenantId, `other-${suffix}`, `principal_other_${suffix}`, now, now);
      this.database.query(`INSERT INTO operations
        (id, tenant_id, computer_id, kind, status, policy_generation, idempotency_key, request_json, fence, created_at, updated_at)
        VALUES (?, ?, ?, 'create', 'succeeded', 1, ?, '{}', 0, ?, ?)`)
        .run(`opn_other_${suffix}`, tenantId, `cmp_other_${suffix}`, `schema-other-${suffix}`, now, now);
      this.database.query(`INSERT INTO operation_attempts
        (id, tenant_id, operation_id, attempt_number, provider_idempotency_key, status, fence, execution_owner_generation, started_at, completed_at)
        VALUES (?, ?, ?, 1, ?, 'succeeded', 0, 0, ?, ?)`)
        .run(`pat_other_${suffix}`, tenantId, `opn_other_${suffix}`, `provider:other-${suffix}`, now, now);
      const executionOwnerGenerationRejected = rejectsWith(() => {
        this.database.query(`INSERT INTO operation_attempts
          (id, tenant_id, operation_id, attempt_number, provider_idempotency_key, status, fence, execution_owner_generation, started_at)
          VALUES (?, ?, ?, 1, ?, 'running', 0, -1, ?)`)
          .run(`pat_invalid_generation_${suffix}`, tenantId, `opn_valid_${suffix}`, `provider:schema-probe-${suffix}`, now);
      });
      const localMachineRejected = rejectsWith(() => {
        this.database.query(`INSERT INTO computers
          (id, tenant_id, slug, provider, confinement_class, status, owner_principal_id, policy_generation, data_exfiltration_protection, created_at, updated_at)
          VALUES (?, ?, ?, 'local_machine', 'strict_vm', 'stopped', ?, 1, 0, ?, ?)`)
          .run(`cmp_local_${suffix}`, tenantId, `local-${suffix}`, `principal_local_${suffix}`, now, now);
      });
      const computerRejected = rejectsWith(() => {
        this.database.query(`INSERT INTO computers
          (id, tenant_id, slug, provider, confinement_class, status, owner_principal_id, policy_generation, data_exfiltration_protection, created_at, updated_at)
          VALUES (?, ?, ?, 'local_vm', 'strict_vm', 'stopped', ?, 1, 0, ?, ?)`)
          .run(`cmp_strict_${suffix}`, tenantId, `strict-${suffix}`, `principal_strict_${suffix}`, now, now);
      }, "stock local_vm must remain unverified_vm");
      const assuranceRejected = rejectsWith(() => {
        this.database.query(`INSERT INTO provider_assurance
          (tenant_id, computer_id, provider, confinement_class, evidence_json, operation_id, attempt_id, binding_fence, generation, verified_at)
          VALUES (?, ?, 'local_vm', 'strict_vm', '{}', ?, ?, 0, 1, ?)`)
          .run(tenantId, `cmp_strict_${suffix}`, `opn_${suffix}`, `pat_${suffix}`, now);
      }, "stock local_vm assurance must remain unverified_vm");
      const bindingProviderRejected = rejectsWith(() => {
        this.database.query(`INSERT INTO provider_bindings
          (tenant_id, computer_id, provider, resource_id, operation_id, attempt_id, state, fence, updated_at)
          VALUES (?, ?, 'local_vm', ?, ?, ?, 'active', 0, ?)`)
          .run(tenantId, `cmp_valid_${suffix}`, `resource_provider_${suffix}`, `opn_valid_${suffix}`, `pat_valid_${suffix}`, now);
      });
      const bindingComputerRejected = rejectsWith(() => {
        this.database.query(`INSERT INTO provider_bindings
          (tenant_id, computer_id, provider, resource_id, operation_id, attempt_id, state, fence, updated_at)
          VALUES (?, ?, 'local_machine', ?, ?, ?, 'active', 0, ?)`)
          .run(tenantId, `cmp_valid_${suffix}`, `resource_computer_${suffix}`, `opn_other_${suffix}`, `pat_other_${suffix}`, now);
      });
      const bindingAttemptRejected = rejectsWith(() => {
        this.database.query(`INSERT INTO provider_bindings
          (tenant_id, computer_id, provider, resource_id, operation_id, attempt_id, state, fence, updated_at)
          VALUES (?, ?, 'local_machine', ?, ?, ?, 'active', 0, ?)`)
          .run(tenantId, `cmp_valid_${suffix}`, `resource_attempt_${suffix}`, `opn_valid_${suffix}`, `pat_other_${suffix}`, now);
      });
      return executionOwnerGenerationRejected && localMachineRejected && computerRejected && assuranceRejected
        && bindingProviderRejected && bindingComputerRejected && bindingAttemptRejected;
    } catch (error) {
      if (isSQLiteContention(error)) throw error;
      return false;
    } finally {
      if (savepointOpen) {
        try { this.database.exec(`ROLLBACK TO ${savepoint}`); }
        finally { this.database.exec(`RELEASE ${savepoint}`); }
      }
    }
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
