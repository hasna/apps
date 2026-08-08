/**
 * FCAME-1 contract primitives for production Knowledge writes.
 *
 * This module deliberately contains no storage implementation. It defines the
 * canonical tuple, deterministic key, finite limits, and receipt/readback
 * shapes shared by the package-owned producer and the authenticated server.
 */
import { createHash, randomUUID } from 'node:crypto';
import type { KnowledgeItem } from './store.js';

export const KNOWLEDGE_GUARDED_WRITE_CONTRACT = 'FCAME-1' as const;
export const KNOWLEDGE_PRIVATE_INPUT_SCHEMA = 'hasna.knowledge.private-input.v1' as const;

export type KnowledgeAuthorityClassification = 'user_hosted' | 'hasna_saas';
export type KnowledgeGuardedWriteVerb = 'create' | 'update';

export interface KnowledgeAuthorityBinding {
  classification: KnowledgeAuthorityClassification;
  authority_id: string;
}

export interface KnowledgeGuardedBinding {
  authority: KnowledgeAuthorityBinding;
  tenant_id: string;
  scope: string;
  parent_id: string;
}

export interface KnowledgeGuardedManifestBinding {
  manifest_id: string;
  ordinal: number;
  phase: 'primary' | 'recovery';
  compensates_receipt_id: string | null;
}

export type KnowledgeGuardedPrecondition =
  | { kind: 'absent' }
  | { kind: 'version'; expected_version: number };

export interface KnowledgeGuardedBounds {
  /** One producer call per phase. Values other than one are refused. */
  max_calls: number;
  /** Exact single-result phases. Values other than one are refused. */
  max_items: number;
  /** Maximum UTF-8 request/response bytes for the phase. */
  max_bytes: number;
  /** Producer wall-clock limit for the phase. */
  wall_time_ms: number;
}

export interface KnowledgeGuardedLimits {
  submission: KnowledgeGuardedBounds;
  reconciliation: KnowledgeGuardedBounds;
  readback: KnowledgeGuardedBounds;
}

export interface KnowledgeGuardedCreatePayload {
  title: string;
  content?: string;
  url?: string | null;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface KnowledgeGuardedUpdatePayload {
  title?: string;
  content?: string;
  url?: string | null;
  tags?: string[];
  metadata?: Record<string, unknown>;
  archived?: boolean;
}

export type KnowledgeGuardedPayload =
  | KnowledgeGuardedCreatePayload
  | KnowledgeGuardedUpdatePayload;

export interface KnowledgePrivateInputDescriptor {
  readonly contract: typeof KNOWLEDGE_GUARDED_WRITE_CONTRACT;
  readonly schema: typeof KNOWLEDGE_PRIVATE_INPUT_SCHEMA;
  readonly descriptor_id: string;
  readonly operation_id: string;
  readonly step_id: string;
  readonly verb: KnowledgeGuardedWriteVerb;
  readonly target_id: string;
  readonly payload_digest: string;
  readonly binding_digest: string;
  readonly precondition: KnowledgeGuardedPrecondition;
  readonly binding: KnowledgeGuardedBinding;
  readonly manifest: KnowledgeGuardedManifestBinding | null;
  readonly expires_at: string;
  /**
   * JSON/log serialization is intentionally metadata-only. The private payload
   * lives in a module-private WeakMap and is never an enumerable property.
   */
  toJSON(): Omit<KnowledgePrivateInputDescriptor, 'toJSON'>;
}

export interface CreateKnowledgePrivateInputDescriptorOptions {
  operation_id: string;
  step_id: string;
  verb: KnowledgeGuardedWriteVerb;
  target_id: string;
  precondition: KnowledgeGuardedPrecondition;
  binding: KnowledgeGuardedBinding;
  /** Required when this write is one ordered step in a multi-record workflow. */
  manifest?: KnowledgeGuardedManifestBinding;
  payload: KnowledgeGuardedPayload;
  /** Defaults to five minutes; bounded to one hour. */
  expires_in_ms?: number;
}

export interface KnowledgeGuardedWriteEnvelope {
  contract: typeof KNOWLEDGE_GUARDED_WRITE_CONTRACT;
  descriptor: Omit<KnowledgePrivateInputDescriptor, 'toJSON'>;
  deterministic_key: string;
  limits: KnowledgeGuardedLimits;
  payload: KnowledgeGuardedPayload;
}

export type KnowledgeGuardedRecoveryStrategy =
  | 'forward_repair'
  | 'receipt_scoped_compensation';

export interface KnowledgeGuardedManifestRecovery {
  strategy: KnowledgeGuardedRecoveryStrategy;
  operation_id: string;
  step_id: string;
  deterministic_key: string;
  verb: KnowledgeGuardedWriteVerb;
  target_id: string;
  semantic_digest: string;
  precondition: KnowledgeGuardedPrecondition;
  binding: KnowledgeGuardedBinding;
  limits: KnowledgeGuardedLimits;
  /** Compensation may affect only the exact accepted receipt of this step. */
  receipt_scope: 'accepted_step_receipt' | null;
  compensates_receipt_id: string | null;
}

export interface KnowledgeGuardedManifestStep {
  ordinal: number;
  operation_id: string;
  step_id: string;
  deterministic_key: string;
  verb: KnowledgeGuardedWriteVerb;
  target_id: string;
  binding: KnowledgeGuardedBinding;
  semantic_digest: string;
  precondition: KnowledgeGuardedPrecondition;
  dependencies: number[];
  limits: KnowledgeGuardedLimits;
  recovery: KnowledgeGuardedManifestRecovery;
}

export interface CreateKnowledgeGuardedManifestOptions {
  manifest_id: string;
  operation_id: string;
  steps: KnowledgeGuardedManifestStep[];
}

export interface KnowledgeGuardedManifestEnvelope {
  contract: typeof KNOWLEDGE_GUARDED_WRITE_CONTRACT;
  maintainer: KnowledgeGuardedBinding;
  manifest: CreateKnowledgeGuardedManifestOptions;
  deterministic_key: string;
}

export interface KnowledgeGuardedManifest {
  contract: typeof KNOWLEDGE_GUARDED_WRITE_CONTRACT;
  manifest_receipt_id: string;
  manifest_id: string;
  operation_id: string;
  deterministic_key: string;
  manifest_digest: string;
  maintainer: KnowledgeGuardedBinding;
  step_count: number;
  steps: KnowledgeGuardedManifestStep[];
  created_at: string;
}

export interface KnowledgeGuardedManifestSubmission {
  contract: typeof KNOWLEDGE_GUARDED_WRITE_CONTRACT;
  deterministic_key: string;
  manifest: KnowledgeGuardedManifest;
  duplicate: boolean;
}

export type KnowledgeGuardedManifestStepState =
  | 'accepted'
  | 'rejected'
  | 'missing'
  | 'unverified_external_authority';

export interface KnowledgeGuardedManifestReconciliationStep {
  ordinal: number;
  deterministic_key: string;
  authority: KnowledgeAuthorityBinding;
  state: KnowledgeGuardedManifestStepState;
  receipt: KnowledgeGuardedReceipt | null;
  recovery_deterministic_key: string;
  recovery_state: KnowledgeGuardedManifestStepState;
  recovery_receipt: KnowledgeGuardedReceipt | null;
}

export interface KnowledgeGuardedManifestReconciliation {
  contract: typeof KNOWLEDGE_GUARDED_WRITE_CONTRACT;
  manifest: KnowledgeGuardedManifest;
  exact: true;
  bounded: true;
  terminal_complete: boolean;
  accepted_complete: boolean;
  unsupported_gap: string | null;
  steps: KnowledgeGuardedManifestReconciliationStep[];
  limits: KnowledgeGuardedBounds;
}

export interface KnowledgeGuardedManifestCompletion {
  terminal_complete: boolean;
  accepted_complete: boolean;
}

export type KnowledgeGuardedReceiptStatus = 'accepted' | 'rejected';

export interface KnowledgeGuardedReceipt {
  contract: typeof KNOWLEDGE_GUARDED_WRITE_CONTRACT;
  receipt_id: string;
  deterministic_key: string;
  operation_id: string;
  step_id: string;
  verb: KnowledgeGuardedWriteVerb;
  target_id: string;
  authority: KnowledgeAuthorityBinding;
  tenant_id: string;
  scope: string;
  parent_id: string;
  payload_digest: string;
  precondition: KnowledgeGuardedPrecondition;
  manifest: KnowledgeGuardedManifestBinding | null;
  status: KnowledgeGuardedReceiptStatus;
  code: string;
  effect_count: 0 | 1;
  result_id: string | null;
  result_version: number | null;
  created_at: string;
}

export interface KnowledgeGuardedSubmission {
  contract: typeof KNOWLEDGE_GUARDED_WRITE_CONTRACT;
  deterministic_key: string;
  receipt: KnowledgeGuardedReceipt;
  duplicate: boolean;
}

export interface KnowledgeTerminalReconciliation {
  contract: typeof KNOWLEDGE_GUARDED_WRITE_CONTRACT;
  deterministic_key: string;
  operation_id: string;
  step_id: string;
  exact: true;
  bounded: true;
  receipt_count: 0 | 1;
  terminal_complete: boolean;
  receipt: KnowledgeGuardedReceipt | null;
  limits: KnowledgeGuardedBounds;
}

export interface KnowledgeGuardedReadback {
  contract: typeof KNOWLEDGE_GUARDED_WRITE_CONTRACT;
  exact: true;
  bounded: true;
  item_count: 1;
  binding: KnowledgeGuardedBinding;
  item: KnowledgeItem;
  limits: KnowledgeGuardedBounds;
}

export interface KnowledgeGuardedWriteResult {
  deterministic_key: string;
  duplicate: boolean;
  receipt: KnowledgeGuardedReceipt;
  reconciliation: KnowledgeTerminalReconciliation;
  readback: KnowledgeGuardedReadback;
}

export const DEFAULT_KNOWLEDGE_GUARDED_LIMITS: KnowledgeGuardedLimits = Object.freeze({
  submission: Object.freeze({
    max_calls: 1,
    max_items: 1,
    max_bytes: 1_048_576,
    wall_time_ms: 10_000,
  }),
  reconciliation: Object.freeze({
    max_calls: 1,
    max_items: 1,
    max_bytes: 262_144,
    wall_time_ms: 5_000,
  }),
  readback: Object.freeze({
    max_calls: 1,
    max_items: 1,
    max_bytes: 1_048_576,
    wall_time_ms: 5_000,
  }),
});

const MAX_GUARDED_BYTES = 4 * 1024 * 1024;
const MAX_GUARDED_WALL_TIME_MS = 30_000;
const MAX_DESCRIPTOR_LIFETIME_MS = 60 * 60 * 1000;
const PRIVATE_PAYLOADS = new WeakMap<object, {
  payload: KnowledgeGuardedPayload;
  revoked: boolean;
}>();

function assertObjectKeys(
  value: unknown,
  field: string,
  allowed: readonly string[],
  required: readonly string[] = allowed,
): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${field} must be an object.`);
  }
  const keys = Object.keys(value);
  const unexpected = keys.filter((key) => !allowed.includes(key));
  const missing = required.filter((key) => !keys.includes(key));
  if (unexpected.length > 0 || missing.length > 0) {
    throw new Error(
      `${field} keys must match its FCAME-1 schema`
      + `${unexpected.length > 0 ? `; unexpected: ${unexpected.sort().join(',')}` : ''}`
      + `${missing.length > 0 ? `; missing: ${missing.sort().join(',')}` : ''}.`,
    );
  }
}

function assertBoundText(value: unknown, field: string, maxLength = 512): asserts value is string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > maxLength
    || value.trim() !== value
    || /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new Error(`${field} must be a non-empty, trimmed string without control characters.`);
  }
}

export function assertKnowledgeGuardedBinding(binding: KnowledgeGuardedBinding): void {
  assertObjectKeys(binding, 'binding', ['authority', 'tenant_id', 'scope', 'parent_id']);
  assertObjectKeys(binding.authority, 'binding.authority', ['classification', 'authority_id']);
  if (!['user_hosted', 'hasna_saas'].includes(binding.authority.classification)) {
    throw new Error('binding.authority.classification must be user_hosted or hasna_saas.');
  }
  assertBoundText(binding.authority.authority_id, 'binding.authority.authority_id');
  assertBoundText(binding.tenant_id, 'binding.tenant_id', 64);
  assertBoundText(binding.scope, 'binding.scope');
  assertBoundText(binding.parent_id, 'binding.parent_id');
}

export function assertKnowledgeGuardedPrecondition(
  verb: KnowledgeGuardedWriteVerb,
  precondition: KnowledgeGuardedPrecondition,
): void {
  if (!['create', 'update'].includes(verb)) {
    throw new Error('verb must be create or update.');
  }
  if (verb === 'create') {
    assertObjectKeys(precondition, 'precondition', ['kind']);
    if (!precondition || precondition.kind !== 'absent') {
      throw new Error('create requires the create-if-absent precondition.');
    }
    return;
  }
  assertObjectKeys(precondition, 'precondition', ['kind', 'expected_version']);
  if (
    !precondition
    || precondition.kind !== 'version'
    || !Number.isInteger(precondition.expected_version)
    || precondition.expected_version < 1
  ) {
    throw new Error('update requires a positive compare-and-swap expected_version.');
  }
}

export function assertKnowledgeGuardedManifestBinding(
  manifest: KnowledgeGuardedManifestBinding,
): void {
  assertObjectKeys(
    manifest,
    'manifest',
    ['manifest_id', 'ordinal', 'phase', 'compensates_receipt_id'],
  );
  assertBoundText(manifest.manifest_id, 'manifest.manifest_id');
  if (!Number.isInteger(manifest.ordinal) || manifest.ordinal < 0) {
    throw new Error('manifest.ordinal must be a non-negative integer.');
  }
  if (!['primary', 'recovery'].includes(manifest.phase)) {
    throw new Error('manifest.phase must be primary or recovery.');
  }
  if (manifest.phase === 'primary' && manifest.compensates_receipt_id !== null) {
    throw new Error('a primary manifest step cannot compensate a receipt.');
  }
  if (
    manifest.compensates_receipt_id !== null
    && (
      typeof manifest.compensates_receipt_id !== 'string'
      || !/^kwr_[0-9a-f]{64}$/.test(manifest.compensates_receipt_id)
    )
  ) {
    throw new Error('manifest.compensates_receipt_id must be null or an immutable guarded receipt id.');
  }
}

export function assertKnowledgeGuardedBounds(bounds: KnowledgeGuardedBounds, field = 'limits'): void {
  assertObjectKeys(bounds, field, ['max_calls', 'max_items', 'max_bytes', 'wall_time_ms']);
  if (bounds.max_calls !== 1) throw new Error(`${field}.max_calls must be exactly 1.`);
  if (bounds.max_items !== 1) throw new Error(`${field}.max_items must be exactly 1.`);
  if (!Number.isInteger(bounds.max_bytes) || bounds.max_bytes < 1 || bounds.max_bytes > MAX_GUARDED_BYTES) {
    throw new Error(`${field}.max_bytes must be a positive integer no greater than ${MAX_GUARDED_BYTES}.`);
  }
  if (
    !Number.isInteger(bounds.wall_time_ms)
    || bounds.wall_time_ms < 1
    || bounds.wall_time_ms > MAX_GUARDED_WALL_TIME_MS
  ) {
    throw new Error(
      `${field}.wall_time_ms must be a positive integer no greater than ${MAX_GUARDED_WALL_TIME_MS}.`,
    );
  }
}

export function normalizeKnowledgeGuardedLimits(
  limits: Partial<KnowledgeGuardedLimits> = {},
): KnowledgeGuardedLimits {
  assertObjectKeys(
    limits,
    'limits',
    ['submission', 'reconciliation', 'readback'],
    [],
  );
  if (limits.submission !== undefined) {
    assertKnowledgeGuardedBounds(limits.submission, 'limits.submission');
  }
  if (limits.reconciliation !== undefined) {
    assertKnowledgeGuardedBounds(limits.reconciliation, 'limits.reconciliation');
  }
  if (limits.readback !== undefined) {
    assertKnowledgeGuardedBounds(limits.readback, 'limits.readback');
  }
  const normalized: KnowledgeGuardedLimits = {
    submission: { ...DEFAULT_KNOWLEDGE_GUARDED_LIMITS.submission, ...limits.submission },
    reconciliation: { ...DEFAULT_KNOWLEDGE_GUARDED_LIMITS.reconciliation, ...limits.reconciliation },
    readback: { ...DEFAULT_KNOWLEDGE_GUARDED_LIMITS.readback, ...limits.readback },
  };
  assertKnowledgeGuardedBounds(normalized.submission, 'limits.submission');
  assertKnowledgeGuardedBounds(normalized.reconciliation, 'limits.reconciliation');
  assertKnowledgeGuardedBounds(normalized.readback, 'limits.readback');
  return Object.freeze({
    submission: Object.freeze(normalized.submission),
    reconciliation: Object.freeze(normalized.reconciliation),
    readback: Object.freeze(normalized.readback),
  });
}

function canonicalValue(value: unknown, path: string): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${path} contains a non-finite number.`);
    return value;
  }
  if (Array.isArray(value)) return value.map((item, index) => canonicalValue(item, `${path}[${index}]`));
  if (typeof value !== 'object') {
    throw new Error(`${path} must contain only JSON values.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`${path} must contain plain JSON objects.`);
  }
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const child = (value as Record<string, unknown>)[key];
    if (child === undefined) throw new Error(`${path}.${key} must not be undefined.`);
    result[key] = canonicalValue(child, `${path}.${key}`);
  }
  return result;
}

function deepFreezeJson<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreezeJson(child);
    }
    Object.freeze(value);
  }
  return value;
}

export function canonicalKnowledgeGuardedJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value, 'value'));
}

export function knowledgeGuardedDigest(value: unknown): string {
  return createHash('sha256').update(canonicalKnowledgeGuardedJson(value), 'utf8').digest('hex');
}

export interface KnowledgeGuardedDeterministicKeyInput {
  binding: KnowledgeGuardedBinding;
  operation_id: string;
  step_id: string;
  verb: KnowledgeGuardedWriteVerb;
  target_id: string;
  payload_digest: string;
  precondition: KnowledgeGuardedPrecondition;
  manifest?: KnowledgeGuardedManifestBinding | null;
}

/**
 * Deterministic key:
 * sha256(canonical JSON of the FCAME-1 authority/tenant/scope/parent,
 * operation/step, verb/target, private-payload digest, and precondition tuple).
 */
export function computeKnowledgeGuardedDeterministicKey(
  input: KnowledgeGuardedDeterministicKeyInput,
): string {
  assertKnowledgeGuardedBinding(input.binding);
  assertBoundText(input.operation_id, 'operation_id');
  assertBoundText(input.step_id, 'step_id');
  assertBoundText(input.target_id, 'target_id');
  if (!/^[0-9a-f]{64}$/.test(input.payload_digest)) {
    throw new Error('payload_digest must be a lowercase sha256 hex digest.');
  }
  assertKnowledgeGuardedPrecondition(input.verb, input.precondition);
  if (input.manifest) assertKnowledgeGuardedManifestBinding(input.manifest);
  const digest = knowledgeGuardedDigest({
    contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
    authority: input.binding.authority,
    tenant_id: input.binding.tenant_id,
    scope: input.binding.scope,
    parent_id: input.binding.parent_id,
    operation_id: input.operation_id,
    step_id: input.step_id,
    verb: input.verb,
    target_id: input.target_id,
    payload_digest: input.payload_digest,
    precondition: input.precondition,
    manifest: input.manifest ?? null,
  });
  return `fcame1_${digest}`;
}

export interface KnowledgeGuardedRecoveryKeyInput {
  manifest_id: string;
  ordinal: number;
  step_deterministic_key: string;
  strategy: KnowledgeGuardedRecoveryStrategy;
  operation_id: string;
  step_id: string;
  verb: KnowledgeGuardedWriteVerb;
  target_id: string;
  semantic_digest: string;
  precondition: KnowledgeGuardedPrecondition;
  binding: KnowledgeGuardedBinding;
  limits: KnowledgeGuardedLimits;
  receipt_scope: 'accepted_step_receipt' | null;
  compensates_receipt_id: string | null;
}

export function computeKnowledgeGuardedRecoveryKey(
  input: KnowledgeGuardedRecoveryKeyInput,
): string {
  assertBoundText(input.manifest_id, 'manifest_id');
  if (!Number.isInteger(input.ordinal) || input.ordinal < 0) {
    throw new Error('ordinal must be a non-negative integer.');
  }
  if (!/^fcame1_[0-9a-f]{64}$/.test(input.step_deterministic_key)) {
    throw new Error('step_deterministic_key must be an FCAME-1 deterministic key.');
  }
  assertBoundText(input.operation_id, 'recovery.operation_id');
  assertBoundText(input.step_id, 'recovery.step_id');
  assertBoundText(input.target_id, 'recovery.target_id');
  assertKnowledgeGuardedBinding(input.binding);
  assertKnowledgeGuardedPrecondition(input.verb, input.precondition);
  const recoveryLimits = normalizeKnowledgeGuardedLimits(input.limits);
  if (canonicalKnowledgeGuardedJson(recoveryLimits) !== canonicalKnowledgeGuardedJson(input.limits)) {
    throw new Error('recovery.limits must be explicit and complete.');
  }
  if (!/^[0-9a-f]{64}$/.test(input.semantic_digest)) {
    throw new Error('recovery.semantic_digest must be a lowercase sha256 hex digest.');
  }
  if (!['forward_repair', 'receipt_scoped_compensation'].includes(input.strategy)) {
    throw new Error('recovery.strategy must be forward_repair or receipt_scoped_compensation.');
  }
  if (
    (input.strategy === 'receipt_scoped_compensation' && input.receipt_scope !== 'accepted_step_receipt')
    || (input.strategy === 'forward_repair' && input.receipt_scope !== null)
  ) {
    throw new Error(
      'receipt_scoped_compensation requires accepted_step_receipt; forward_repair requires null receipt_scope.',
    );
  }
  const expectedReceiptId = computeKnowledgeGuardedReceiptId(input.step_deterministic_key);
  if (
    (input.strategy === 'receipt_scoped_compensation'
      && input.compensates_receipt_id !== expectedReceiptId)
    || (input.strategy === 'forward_repair' && input.compensates_receipt_id !== null)
  ) {
    throw new Error(
      'receipt-scoped compensation must bind the deterministic accepted-step receipt; '
      + 'forward repair must not bind one.',
    );
  }
  return computeKnowledgeGuardedDeterministicKey({
    binding: input.binding,
    operation_id: input.operation_id,
    step_id: input.step_id,
    verb: input.verb,
    target_id: input.target_id,
    payload_digest: input.semantic_digest,
    precondition: input.precondition,
    manifest: {
      manifest_id: input.manifest_id,
      ordinal: input.ordinal,
      phase: 'recovery',
      compensates_receipt_id: input.compensates_receipt_id,
    },
  });
}

export function computeKnowledgeGuardedReceiptId(deterministicKey: string): string {
  if (!/^fcame1_[0-9a-f]{64}$/.test(deterministicKey)) {
    throw new Error('deterministicKey must be an FCAME-1 write key.');
  }
  return `kwr_${deterministicKey.slice('fcame1_'.length)}`;
}

/**
 * Globally collision-resistant manifest identity scoped to its maintaining
 * authority/tenant/scope/parent and stable workflow operation id.
 */
export function computeKnowledgeGuardedManifestId(
  maintainer: KnowledgeGuardedBinding,
  operationId: string,
): string {
  assertKnowledgeGuardedBinding(maintainer);
  assertBoundText(operationId, 'operation_id');
  return `kmf_${knowledgeGuardedDigest({
    contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
    maintainer,
    operation_id: operationId,
  })}`;
}

function assertKnowledgeGuardedManifestStep(
  manifestId: string,
  step: KnowledgeGuardedManifestStep,
  expectedOrdinal: number,
): void {
  assertObjectKeys(
    step,
    `steps[${expectedOrdinal}]`,
    [
      'ordinal',
      'operation_id',
      'step_id',
      'deterministic_key',
      'verb',
      'target_id',
      'binding',
      'semantic_digest',
      'precondition',
      'dependencies',
      'limits',
      'recovery',
    ],
  );
  assertObjectKeys(
    step.recovery,
    `steps[${expectedOrdinal}].recovery`,
    [
      'strategy',
      'operation_id',
      'step_id',
      'deterministic_key',
      'verb',
      'target_id',
      'semantic_digest',
      'precondition',
      'binding',
      'limits',
      'receipt_scope',
      'compensates_receipt_id',
    ],
  );
  if (step.ordinal !== expectedOrdinal) {
    throw new Error(`manifest steps must be ordered contiguously from zero; expected ordinal ${expectedOrdinal}.`);
  }
  assertBoundText(step.operation_id, `steps[${expectedOrdinal}].operation_id`);
  assertBoundText(step.step_id, `steps[${expectedOrdinal}].step_id`);
  assertBoundText(step.target_id, `steps[${expectedOrdinal}].target_id`);
  assertKnowledgeGuardedBinding(step.binding);
  assertKnowledgeGuardedPrecondition(step.verb, step.precondition);
  if (!/^[0-9a-f]{64}$/.test(step.semantic_digest)) {
    throw new Error(`steps[${expectedOrdinal}].semantic_digest must be a lowercase sha256 digest.`);
  }
  const normalizedLimits = normalizeKnowledgeGuardedLimits(step.limits);
  if (canonicalKnowledgeGuardedJson(normalizedLimits) !== canonicalKnowledgeGuardedJson(step.limits)) {
    throw new Error(`steps[${expectedOrdinal}].limits must be explicit and complete.`);
  }
  const expectedDependencies = Array.from({ length: expectedOrdinal }, (_unused, index) => index);
  if (
    !Array.isArray(step.dependencies)
    || canonicalKnowledgeGuardedJson(step.dependencies) !== canonicalKnowledgeGuardedJson(expectedDependencies)
  ) {
    throw new Error(
      `steps[${expectedOrdinal}].dependencies must name every prior ordinal in order.`,
    );
  }
  const expectedStepKey = computeKnowledgeGuardedDeterministicKey({
    binding: step.binding,
    operation_id: step.operation_id,
    step_id: step.step_id,
    verb: step.verb,
    target_id: step.target_id,
    payload_digest: step.semantic_digest,
    precondition: step.precondition,
    manifest: {
      manifest_id: manifestId,
      ordinal: step.ordinal,
      phase: 'primary',
      compensates_receipt_id: null,
    },
  });
  if (step.deterministic_key !== expectedStepKey) {
    throw new Error(`steps[${expectedOrdinal}].deterministic_key does not match its frozen tuple.`);
  }
  const expectedRecoveryKey = computeKnowledgeGuardedRecoveryKey({
    manifest_id: manifestId,
    ordinal: step.ordinal,
    step_deterministic_key: step.deterministic_key,
    strategy: step.recovery.strategy,
    operation_id: step.recovery.operation_id,
    step_id: step.recovery.step_id,
    verb: step.recovery.verb,
    target_id: step.recovery.target_id,
    semantic_digest: step.recovery.semantic_digest,
    precondition: step.recovery.precondition,
    binding: step.recovery.binding,
    limits: step.recovery.limits,
    receipt_scope: step.recovery.receipt_scope,
    compensates_receipt_id: step.recovery.compensates_receipt_id,
  });
  if (step.recovery.deterministic_key !== expectedRecoveryKey) {
    throw new Error(`steps[${expectedOrdinal}].recovery.deterministic_key does not match its frozen tuple.`);
  }
}

export function assertKnowledgeGuardedManifestOptions(
  maintainer: KnowledgeGuardedBinding,
  options: CreateKnowledgeGuardedManifestOptions,
): void {
  assertKnowledgeGuardedBinding(maintainer);
  assertObjectKeys(options, 'manifest', ['manifest_id', 'operation_id', 'steps']);
  assertBoundText(options.manifest_id, 'manifest_id');
  assertBoundText(options.operation_id, 'operation_id');
  const expectedManifestId = computeKnowledgeGuardedManifestId(maintainer, options.operation_id);
  if (options.manifest_id !== expectedManifestId) {
    throw new Error(
      'manifest_id must be the deterministic FCAME-1 id for its maintainer and workflow operation.',
    );
  }
  if (!Array.isArray(options.steps) || options.steps.length < 2 || options.steps.length > 64) {
    throw new Error('a guarded workflow manifest must contain between 2 and 64 ordered steps.');
  }
  const identities = new Set<string>();
  const deterministicKeys = new Set<string>();
  options.steps.forEach((step, index) => {
    assertKnowledgeGuardedManifestStep(options.manifest_id, step, index);
    if (
      step.binding.tenant_id !== maintainer.tenant_id
      || step.recovery.binding.tenant_id !== maintainer.tenant_id
    ) {
      throw new Error(`manifest step ${index} crosses tenants without an authority delegation contract.`);
    }
    for (const action of [step, step.recovery]) {
      const identity = `${action.binding.authority.classification}\u0000${action.binding.authority.authority_id}`
        + `\u0000${action.binding.tenant_id}\u0000${action.binding.scope}\u0000${action.binding.parent_id}`
        + `\u0000${action.operation_id}\u0000${action.step_id}`;
      if (identities.has(identity)) {
        throw new Error(`manifest step ${index} repeats an operation/step identity.`);
      }
      identities.add(identity);
      if (deterministicKeys.has(action.deterministic_key)) {
        throw new Error(`manifest step ${index} repeats a deterministic action key.`);
      }
      deterministicKeys.add(action.deterministic_key);
    }
  });
}

export function computeKnowledgeGuardedManifestDigest(
  maintainer: KnowledgeGuardedBinding,
  options: CreateKnowledgeGuardedManifestOptions,
): string {
  assertKnowledgeGuardedManifestOptions(maintainer, options);
  return knowledgeGuardedDigest({
    contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
    manifest_id: options.manifest_id,
    operation_id: options.operation_id,
    maintainer,
    steps: options.steps,
  });
}

export function computeKnowledgeGuardedManifestDeterministicKey(
  maintainer: KnowledgeGuardedBinding,
  options: CreateKnowledgeGuardedManifestOptions,
): string {
  return `fcame1_manifest_${computeKnowledgeGuardedManifestDigest(maintainer, options)}`;
}

export function assertKnowledgeGuardedPayload(
  verb: KnowledgeGuardedWriteVerb,
  payload: KnowledgeGuardedPayload,
): void {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('payload must be a JSON object.');
  }
  canonicalValue(payload, 'payload');
  if (verb === 'create') {
    const title = (payload as KnowledgeGuardedCreatePayload).title;
    if (typeof title !== 'string' || title.trim().length === 0) {
      throw new Error('create payload.title is required.');
    }
  }
  const allowed = verb === 'create'
    ? new Set(['title', 'content', 'url', 'tags', 'metadata'])
    : new Set(['title', 'content', 'url', 'tags', 'metadata', 'archived']);
  for (const key of Object.keys(payload)) {
    if (!allowed.has(key)) throw new Error(`payload.${key} is not allowed for ${verb}.`);
  }
  if ('title' in payload && payload.title !== undefined) {
    assertBoundText(payload.title, 'payload.title', 2048);
  }
  if ('content' in payload && payload.content !== undefined && typeof payload.content !== 'string') {
    throw new Error('payload.content must be a string.');
  }
  if (
    'url' in payload
    && payload.url !== undefined
    && payload.url !== null
    && (
      typeof payload.url !== 'string'
      || payload.url.length > 8192
      || /[\u0000-\u001f\u007f]/.test(payload.url)
    )
  ) {
    throw new Error('payload.url must be null or a string without control characters.');
  }
  if ('tags' in payload && payload.tags !== undefined) {
    if (!Array.isArray(payload.tags) || payload.tags.length > 256) {
      throw new Error('payload.tags must be an array of strings.');
    }
    payload.tags.forEach((tag, index) => assertBoundText(tag, `payload.tags[${index}]`, 256));
  }
  if ('archived' in payload && payload.archived !== undefined && typeof payload.archived !== 'boolean') {
    throw new Error('payload.archived must be a boolean.');
  }
  if ('metadata' in payload && payload.metadata !== undefined) {
    if (
      payload.metadata === null
      || typeof payload.metadata !== 'object'
      || Array.isArray(payload.metadata)
    ) {
      throw new Error('payload.metadata must be a JSON object.');
    }
  }
  if (verb === 'update' && Object.keys(payload).length === 0) {
    throw new Error('update payload must change at least one field.');
  }
}

export function createKnowledgePrivateInputDescriptor(
  options: CreateKnowledgePrivateInputDescriptorOptions,
): KnowledgePrivateInputDescriptor {
  assertBoundText(options.operation_id, 'operation_id');
  assertBoundText(options.step_id, 'step_id');
  assertBoundText(options.target_id, 'target_id');
  assertKnowledgeGuardedBinding(options.binding);
  assertKnowledgeGuardedPrecondition(options.verb, options.precondition);
  if (options.manifest) assertKnowledgeGuardedManifestBinding(options.manifest);
  assertKnowledgeGuardedPayload(options.verb, options.payload);

  const expiresIn = options.expires_in_ms ?? 5 * 60 * 1000;
  if (!Number.isInteger(expiresIn) || expiresIn < 1 || expiresIn > MAX_DESCRIPTOR_LIFETIME_MS) {
    throw new Error(`expires_in_ms must be between 1 and ${MAX_DESCRIPTOR_LIFETIME_MS}.`);
  }

  const payload = deepFreezeJson(
    JSON.parse(canonicalKnowledgeGuardedJson(options.payload)) as KnowledgeGuardedPayload,
  );
  const payloadDigest = knowledgeGuardedDigest(payload);
  const bindingDigest = knowledgeGuardedDigest({
    binding: options.binding,
    operation_id: options.operation_id,
    step_id: options.step_id,
    verb: options.verb,
    target_id: options.target_id,
    precondition: options.precondition,
    payload_digest: payloadDigest,
    manifest: options.manifest ?? null,
  });
  const expiresAt = new Date(Date.now() + expiresIn).toISOString();

  const metadata = Object.freeze({
    contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
    schema: KNOWLEDGE_PRIVATE_INPUT_SCHEMA,
    descriptor_id: `kpv_${randomUUID()}`,
    operation_id: options.operation_id,
    step_id: options.step_id,
    verb: options.verb,
    target_id: options.target_id,
    payload_digest: payloadDigest,
    binding_digest: bindingDigest,
    precondition: Object.freeze({ ...options.precondition }),
    binding: Object.freeze({
      authority: Object.freeze({ ...options.binding.authority }),
      tenant_id: options.binding.tenant_id,
      scope: options.binding.scope,
      parent_id: options.binding.parent_id,
    }),
    manifest: options.manifest
      ? Object.freeze({
        manifest_id: options.manifest.manifest_id,
        ordinal: options.manifest.ordinal,
        phase: options.manifest.phase,
        compensates_receipt_id: options.manifest.compensates_receipt_id,
      })
      : null,
    expires_at: expiresAt,
  } satisfies Omit<KnowledgePrivateInputDescriptor, 'toJSON'>);

  const descriptor: KnowledgePrivateInputDescriptor = Object.freeze({
    ...metadata,
    toJSON: () => metadata,
  });
  PRIVATE_PAYLOADS.set(descriptor, { payload, revoked: false });
  return descriptor;
}

export function revokeKnowledgePrivateInputDescriptor(descriptor: KnowledgePrivateInputDescriptor): void {
  const state = PRIVATE_PAYLOADS.get(descriptor);
  if (!state) throw new Error('private input descriptor was not created by @hasna/knowledge.');
  state.revoked = true;
}

/** @internal */
export function materializeKnowledgePrivateInput(
  descriptor: KnowledgePrivateInputDescriptor,
): KnowledgeGuardedPayload {
  const state = PRIVATE_PAYLOADS.get(descriptor);
  if (!state) throw new Error('private input descriptor was not created by @hasna/knowledge.');
  if (state.revoked) throw new Error('private input descriptor has been revoked.');
  if (Date.parse(descriptor.expires_at) <= Date.now()) {
    throw new Error('private input descriptor has expired.');
  }
  return state.payload;
}

export function assertKnowledgeTerminalCompleteness(
  reconciliation: KnowledgeTerminalReconciliation,
  expected: { deterministic_key: string; operation_id: string; step_id: string },
): KnowledgeGuardedReceipt {
  if (
    reconciliation.contract !== KNOWLEDGE_GUARDED_WRITE_CONTRACT
    || reconciliation.deterministic_key !== expected.deterministic_key
    || reconciliation.operation_id !== expected.operation_id
    || reconciliation.step_id !== expected.step_id
    || reconciliation.exact !== true
    || reconciliation.bounded !== true
    || reconciliation.receipt_count !== 1
    || reconciliation.terminal_complete !== true
    || reconciliation.receipt === null
  ) {
    throw new Error('terminal_completeness_failed: exact bounded reconciliation did not yield one terminal receipt.');
  }
  if (
    reconciliation.receipt.deterministic_key !== expected.deterministic_key
    || reconciliation.receipt.operation_id !== expected.operation_id
    || reconciliation.receipt.step_id !== expected.step_id
  ) {
    throw new Error('terminal_completeness_failed: receipt identity does not match the frozen operation.');
  }
  return reconciliation.receipt;
}

export function evaluateKnowledgeGuardedManifestCompletion(
  steps: readonly KnowledgeGuardedManifestReconciliationStep[],
): KnowledgeGuardedManifestCompletion {
  if (
    steps.length === 0
    || steps.some((step) => (
      step.state === 'unverified_external_authority'
      || step.recovery_state === 'unverified_external_authority'
    ))
  ) {
    return { terminal_complete: false, accepted_complete: false };
  }

  const acceptedComplete = steps.every(
    (step) => step.state === 'accepted' && step.recovery_state === 'missing',
  );
  if (acceptedComplete) {
    return { terminal_complete: true, accepted_complete: true };
  }

  const allPrimaryTerminal = steps.every(
    (step) => step.state === 'accepted' || step.state === 'rejected',
  );
  const allRecoveryMissing = steps.every((step) => step.recovery_state === 'missing');
  if (allPrimaryTerminal && allRecoveryMissing) {
    return { terminal_complete: true, accepted_complete: false };
  }

  const firstNonAccepted = steps.findIndex((step) => step.state !== 'accepted');
  if (firstNonAccepted === 0) {
    const cleanInitialRejection = (
      steps[0]!.state === 'rejected'
      && steps.slice(1).every((step) => step.state !== 'accepted')
      && allRecoveryMissing
    );
    return { terminal_complete: cleanInitialRejection, accepted_complete: false };
  }
  if (firstNonAccepted < 1) {
    return { terminal_complete: false, accepted_complete: false };
  }

  const closingRecoveryOrdinal = firstNonAccepted - 1;
  const closingRecovery = steps[closingRecoveryOrdinal]!;
  const closingRecoveryTerminal = (
    closingRecovery.recovery_state === 'accepted'
    || closingRecovery.recovery_state === 'rejected'
  );
  const exactAcceptedPrefix = steps
    .slice(0, firstNonAccepted)
    .every((step) => step.state === 'accepted');
  const closedPrimarySuffix = steps
    .slice(firstNonAccepted)
    .every((step) => step.state !== 'accepted');
  const exactlyOneClosingRecovery = steps.every((step, ordinal) => (
    ordinal === closingRecoveryOrdinal
      ? closingRecoveryTerminal
      : step.recovery_state === 'missing'
  ));

  return {
    terminal_complete: (
      closingRecoveryTerminal
      && exactAcceptedPrefix
      && closedPrimarySuffix
      && exactlyOneClosingRecovery
    ),
    accepted_complete: false,
  };
}

export function assertKnowledgeGuardedManifestTerminalCompleteness(
  reconciliation: KnowledgeGuardedManifestReconciliation,
  expected: {
    manifest_id: string;
    deterministic_key?: string;
    require_accepted?: boolean;
  },
): KnowledgeGuardedManifest {
  const evaluated = evaluateKnowledgeGuardedManifestCompletion(reconciliation.steps);
  if (
    reconciliation.contract !== KNOWLEDGE_GUARDED_WRITE_CONTRACT
    || reconciliation.manifest.manifest_id !== expected.manifest_id
    || (
      expected.deterministic_key !== undefined
      && reconciliation.manifest.deterministic_key !== expected.deterministic_key
    )
    || reconciliation.exact !== true
    || reconciliation.bounded !== true
    || reconciliation.terminal_complete !== evaluated.terminal_complete
    || reconciliation.accepted_complete !== evaluated.accepted_complete
    || evaluated.terminal_complete !== true
    || reconciliation.unsupported_gap !== null
    || reconciliation.steps.length !== reconciliation.manifest.step_count
    || reconciliation.steps.some((step, ordinal) => (
      step.ordinal !== ordinal
      || step.deterministic_key !== reconciliation.manifest.steps[ordinal]?.deterministic_key
      || step.recovery_deterministic_key
        !== reconciliation.manifest.steps[ordinal]?.recovery.deterministic_key
    ))
  ) {
    throw new Error(
      'manifest_terminal_completeness_failed: exact bounded reconciliation did not prove '
      + 'an accepted primary sequence or one exact terminal recovery for its accepted prefix.',
    );
  }
  if ((expected.require_accepted ?? true) && evaluated.accepted_complete !== true) {
    throw new Error(
      'manifest_accepted_completeness_failed: at least one ordered primary step was not accepted.',
    );
  }
  return reconciliation.manifest;
}

export function knowledgeGuardedUtf8Bytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}
