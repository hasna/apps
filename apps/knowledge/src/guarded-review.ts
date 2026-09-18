/** Read-only, exact-version review of private Knowledge, including unadopted rows. */
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { HasnaStorageClient } from './contracts-types.js';
import type { KnowledgeItem } from './store.js';
import {
  KNOWLEDGE_GUARDED_WRITE_CONTRACT,
  KNOWLEDGE_PRIVATE_EDIT_APPROVAL_SCHEMA,
  assertKnowledgeGuardedBinding,
  assertKnowledgeGuardedBounds,
  canonicalKnowledgeGuardedJson,
  computeKnowledgeGuardedDeterministicKey,
  knowledgeGuardedContentSha256,
  knowledgeGuardedDigest,
  knowledgeGuardedUtf8Bytes,
  knowledgePrivateItemProof,
  materializeKnowledgePrivateInput,
  type KnowledgeGuardedBinding,
  type KnowledgeGuardedBounds,
  type KnowledgePrivateEditApprovalGrant,
  type KnowledgePrivateInputDescriptor,
  type KnowledgePrivateItemProof,
} from './guarded-write-contract.js';

export const KNOWLEDGE_PRIVATE_REVIEW_SCHEMA = 'hasna.knowledge.private-review.v1' as const;
const KNOWLEDGE_PRIVATE_REVIEW_TOKEN_SCHEMA = 'hasna.knowledge.private-review-token.v1' as const;
export type KnowledgeReviewBindingState = 'legacy_unbound' | 'bound_to_requested';
export interface CreateKnowledgePrivateReviewDescriptorOptions {
  operation_id: string;
  step_id: string;
  binding: KnowledgeGuardedBinding;
  target_id: string;
  expected_version: number;
  expected_content_sha256: string;
  expected_binding_state: KnowledgeReviewBindingState;
  expires_in_ms?: number;
}
export interface KnowledgePrivateReviewRequest {
  contract: typeof KNOWLEDGE_GUARDED_WRITE_CONTRACT;
  schema: typeof KNOWLEDGE_PRIVATE_REVIEW_SCHEMA;
  operation_id: string;
  step_id: string;
  binding: KnowledgeGuardedBinding;
  target_id: string;
  expected_version: number;
  expected_content_sha256: string;
  expected_binding_state: KnowledgeReviewBindingState;
  expires_at: string;
}
export interface KnowledgePrivateReviewDescriptor extends Readonly<KnowledgePrivateReviewRequest> {
  readonly descriptor_id: string;
  toJSON(): KnowledgePrivateReviewRequest;
}
export interface KnowledgePrivateReviewEnvelope {
  descriptor: KnowledgePrivateReviewRequest;
  limits: KnowledgeGuardedBounds;
}
export interface KnowledgePrivateReviewAuthorization {
  schema: typeof KNOWLEDGE_PRIVATE_REVIEW_TOKEN_SCHEMA;
  request_digest: string;
  expires_at: string;
  token: string;
}
/** @internal Full bodies may cross only the authenticated private transport. */
export interface KnowledgePrivateReviewReadback {
  contract: typeof KNOWLEDGE_GUARDED_WRITE_CONTRACT;
  exact: true;
  bounded: true;
  private: true;
  item_count: 1;
  binding: KnowledgeGuardedBinding;
  binding_state: KnowledgeReviewBindingState;
  request_digest: string;
  item: KnowledgeItem;
  limits: KnowledgeGuardedBounds;
  review_authorization: KnowledgePrivateReviewAuthorization;
}
export interface KnowledgePrivateReviewProof {
  contract: typeof KNOWLEDGE_GUARDED_WRITE_CONTRACT;
  kind: 'review';
  item_count: 1;
  request_digest: string;
  binding_state: KnowledgeReviewBindingState;
  item: KnowledgePrivateItemProof;
}
export type KnowledgePrivateReviewer = (item: Readonly<KnowledgeItem>) => void | Promise<void>;
export type KnowledgePrivateEditReviewer = (
  item: Readonly<KnowledgeItem>,
) => KnowledgePrivateInputDescriptor | Promise<KnowledgePrivateInputDescriptor>;

export interface KnowledgePrivateEditApprovalEnvelope {
  review_authorization: KnowledgePrivateReviewAuthorization;
  descriptor: Omit<KnowledgePrivateInputDescriptor, 'toJSON'>;
  deterministic_key: string;
  approved_by: string;
  limits: KnowledgeGuardedBounds;
}

export interface KnowledgePrivateEditApproval extends Readonly<
  Omit<KnowledgePrivateEditApprovalGrant, 'token'>
> {
  /** Process-private provenance handle. It is not serialized. */
  readonly descriptor_id: string;
  toJSON(): Omit<KnowledgePrivateEditApprovalGrant, 'token'>;
}

export class KnowledgePrivateReviewError extends Error {
  constructor(readonly code: string, readonly status?: number) {
    super(code);
    this.name = 'KnowledgePrivateReviewError';
  }
}

interface KnowledgePrivateReviewTokenPayload {
  schema: typeof KNOWLEDGE_PRIVATE_REVIEW_TOKEN_SCHEMA;
  request_digest: string;
  binding: KnowledgeGuardedBinding;
  target_id: string;
  expected_version: number;
  expected_content_sha256: string;
  expected_binding_state: KnowledgeReviewBindingState;
  expires_at: string;
  nonce: string;
}

type KnowledgePrivateEditApprovalTokenPayload = Omit<KnowledgePrivateEditApprovalGrant, 'token'>;

const descriptors = new WeakMap<KnowledgePrivateReviewDescriptor, KnowledgePrivateReviewRequest>();
const approvals = new WeakMap<KnowledgePrivateEditApproval, {
  descriptor: KnowledgePrivateInputDescriptor;
  grant: KnowledgePrivateEditApprovalGrant;
}>();
const same = (left: unknown, right: unknown) => canonicalKnowledgeGuardedJson(left) === canonicalKnowledgeGuardedJson(right);
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function assertBoundText(value: unknown, field: string, maxLength = 512): asserts value is string {
  if (
    typeof value !== 'string'
    || !value
    || value !== value.trim()
    || value.length > maxLength
    || /[\u0000-\u001f\u007f]/.test(value)
  ) throw new Error(`${field} is invalid.`);
}

function signedToken(payload: unknown, secret: string): string {
  const encoded = Buffer.from(canonicalKnowledgeGuardedJson(payload), 'utf8').toString('base64url');
  const signature = createHmac('sha256', secret).update(encoded, 'utf8').digest('base64url');
  return `${encoded}.${signature}`;
}

function verifiedToken<T>(token: string, secret: string): T {
  try {
    if (typeof token !== 'string' || token.length > 8192) throw new Error();
    const parts = token.split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) throw new Error();
    const expected = createHmac('sha256', secret).update(parts[0], 'utf8').digest();
    const actual = Buffer.from(parts[1], 'base64url');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error();
    return JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) as T;
  } catch {
    throw new KnowledgePrivateReviewError('private_review_authorization_invalid');
  }
}

/** @internal Server-only: issue one short-lived proof of the exact private row read. */
export function issueKnowledgePrivateReviewAuthorization(
  secret: string,
  request: KnowledgePrivateReviewRequest,
  requestDigest: string,
): KnowledgePrivateReviewAuthorization {
  const payload: KnowledgePrivateReviewTokenPayload = {
    schema: KNOWLEDGE_PRIVATE_REVIEW_TOKEN_SCHEMA,
    request_digest: requestDigest,
    binding: structuredClone(request.binding),
    target_id: request.target_id,
    expected_version: request.expected_version,
    expected_content_sha256: request.expected_content_sha256,
    expected_binding_state: request.expected_binding_state,
    expires_at: request.expires_at,
    nonce: randomUUID(),
  };
  return deepFreeze({
    schema: KNOWLEDGE_PRIVATE_REVIEW_TOKEN_SCHEMA,
    request_digest: requestDigest,
    expires_at: request.expires_at,
    token: signedToken(payload, secret),
  });
}

/** @internal Server-only: authenticate review evidence without exposing token details. */
export function verifyKnowledgePrivateReviewAuthorization(
  secret: string,
  authorization: KnowledgePrivateReviewAuthorization,
): KnowledgePrivateReviewTokenPayload {
  const payload = verifiedToken<KnowledgePrivateReviewTokenPayload>(authorization?.token, secret);
  try {
    if (!authorization || !same(Object.keys(authorization).sort(), ['expires_at', 'request_digest', 'schema', 'token'])) throw new Error();
    if (authorization.schema !== KNOWLEDGE_PRIVATE_REVIEW_TOKEN_SCHEMA || payload.schema !== KNOWLEDGE_PRIVATE_REVIEW_TOKEN_SCHEMA) throw new Error();
    if (authorization.request_digest !== payload.request_digest || authorization.expires_at !== payload.expires_at) throw new Error();
    if (!/^[a-f0-9]{64}$/.test(payload.request_digest) || !/^[a-f0-9]{64}$/.test(payload.expected_content_sha256)) throw new Error();
    assertKnowledgeGuardedBinding(payload.binding);
    assertBoundText(payload.target_id, 'target_id');
    if (!Number.isSafeInteger(payload.expected_version) || payload.expected_version < 1) throw new Error();
    if (!['legacy_unbound', 'bound_to_requested'].includes(payload.expected_binding_state)) throw new Error();
    if (!Number.isFinite(Date.parse(payload.expires_at)) || Date.parse(payload.expires_at) <= Date.now()) throw new Error();
    assertBoundText(payload.nonce, 'nonce');
    return payload;
  } catch {
    throw new KnowledgePrivateReviewError('private_review_authorization_invalid');
  }
}

/** @internal Server-only: mint an exact-mutation approval signed by the authority. */
export function issueKnowledgePrivateEditApprovalGrant(options: {
  secret: string;
  review: KnowledgePrivateReviewTokenPayload;
  descriptor: Omit<KnowledgePrivateInputDescriptor, 'toJSON'>;
  deterministicKey: string;
  approvedBy: string;
  approvedActor: string;
}): KnowledgePrivateEditApprovalGrant {
  const expiration = new Date(Math.min(
    Date.parse(options.review.expires_at),
    Date.parse(options.descriptor.expires_at),
    Date.now() + 5 * 60 * 1000,
  )).toISOString();
  const payload: KnowledgePrivateEditApprovalTokenPayload = {
    contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
    schema: KNOWLEDGE_PRIVATE_EDIT_APPROVAL_SCHEMA,
    approval_id: `kpea_${randomUUID()}`,
    review_request_digest: options.review.request_digest,
    mutation_deterministic_key: options.deterministicKey,
    binding_digest: options.descriptor.binding_digest,
    target_id: options.descriptor.target_id,
    expected_version: options.review.expected_version,
    expected_content_sha256: options.review.expected_content_sha256,
    approved_by: options.approvedBy,
    approved_actor: options.approvedActor,
    expires_at: expiration,
  };
  return deepFreeze({ ...payload, token: signedToken(payload, options.secret) });
}

/** @internal Shared server validation for an approval attached to a write. */
export function verifyKnowledgePrivateEditApprovalGrant(
  secret: string,
  grant: KnowledgePrivateEditApprovalGrant,
): KnowledgePrivateEditApprovalTokenPayload {
  const payload = verifiedToken<KnowledgePrivateEditApprovalTokenPayload>(grant?.token, secret);
  try {
    if (!grant || !same(Object.keys(grant).sort(), [
      'approval_id', 'approved_actor', 'approved_by', 'binding_digest', 'contract',
      'expected_content_sha256', 'expected_version', 'expires_at', 'mutation_deterministic_key',
      'review_request_digest', 'schema', 'target_id', 'token',
    ])) throw new Error();
    const comparable = { ...grant } as Partial<KnowledgePrivateEditApprovalGrant>;
    delete comparable.token;
    if (!same(payload, comparable)) throw new Error();
    if (payload.contract !== KNOWLEDGE_GUARDED_WRITE_CONTRACT || payload.schema !== KNOWLEDGE_PRIVATE_EDIT_APPROVAL_SCHEMA) throw new Error();
    for (const digest of [payload.review_request_digest, payload.binding_digest, payload.expected_content_sha256]) {
      if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error();
    }
    if (!/^fcame1_[a-f0-9]{64}$/.test(payload.mutation_deterministic_key)) throw new Error();
    for (const text of [payload.approval_id, payload.target_id, payload.approved_by, payload.approved_actor]) assertBoundText(text, 'approval field');
    if (!Number.isSafeInteger(payload.expected_version) || payload.expected_version < 1) throw new Error();
    if (!Number.isFinite(Date.parse(payload.expires_at)) || Date.parse(payload.expires_at) <= Date.now()) throw new Error();
    return payload;
  } catch {
    throw new KnowledgePrivateReviewError('private_edit_approval_invalid');
  }
}

/** @internal Shared producer/server validation, with body-free errors. */
export function assertKnowledgePrivateReviewRequest(value: unknown): asserts value is KnowledgePrivateReviewRequest {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    const v = value as KnowledgePrivateReviewRequest;
    if (!same(Object.keys(v).sort(), ['binding', 'contract', 'expected_binding_state', 'expected_content_sha256', 'expected_version', 'expires_at', 'operation_id', 'schema', 'step_id', 'target_id'])) throw new Error();
    if (v.contract !== KNOWLEDGE_GUARDED_WRITE_CONTRACT || v.schema !== KNOWLEDGE_PRIVATE_REVIEW_SCHEMA) throw new Error();
    assertKnowledgeGuardedBinding(v.binding);
    for (const text of [v.operation_id, v.step_id, v.target_id]) assertBoundText(text, 'review field');
    if (!Number.isSafeInteger(v.expected_version) || v.expected_version < 1) throw new Error();
    if (typeof v.expected_content_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(v.expected_content_sha256)) throw new Error();
    if (!['legacy_unbound', 'bound_to_requested'].includes(v.expected_binding_state)) throw new Error();
    const expiration = typeof v.expires_at === 'string' ? Date.parse(v.expires_at) : NaN;
    if (!Number.isFinite(expiration) || expiration <= Date.now() || expiration > Date.now() + 3_600_000) throw new Error();
  } catch {
    throw new KnowledgePrivateReviewError('private_review_descriptor_invalid');
  }
}

export function createKnowledgePrivateReviewDescriptor(options: CreateKnowledgePrivateReviewDescriptorOptions): KnowledgePrivateReviewDescriptor {
  const lifetime = options.expires_in_ms ?? 300_000;
  if (!Number.isSafeInteger(lifetime) || lifetime < 1 || lifetime > 3_600_000) throw new KnowledgePrivateReviewError('private_review_descriptor_invalid');
  const request: KnowledgePrivateReviewRequest = {
    contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
    schema: KNOWLEDGE_PRIVATE_REVIEW_SCHEMA,
    operation_id: options.operation_id,
    step_id: options.step_id,
    binding: structuredClone(options.binding),
    target_id: options.target_id,
    expected_version: options.expected_version,
    expected_content_sha256: options.expected_content_sha256,
    expected_binding_state: options.expected_binding_state,
    expires_at: new Date(Date.now() + lifetime).toISOString(),
  };
  assertKnowledgePrivateReviewRequest(request);
  deepFreeze(request);
  const descriptor = { ...request, toJSON: () => request } as KnowledgePrivateReviewDescriptor;
  Object.defineProperty(descriptor, 'descriptor_id', { value: `kprv_${randomUUID()}`, enumerable: false });
  Object.freeze(descriptor);
  descriptors.set(descriptor, request);
  return descriptor;
}

async function readKnowledgePrivateReview(
  transport: HasnaStorageClient['transport'],
  binding: KnowledgeGuardedBinding,
  descriptor: KnowledgePrivateReviewDescriptor,
  bounds: KnowledgeGuardedBounds,
): Promise<{ item: Readonly<KnowledgeItem>; proof: KnowledgePrivateReviewProof; authorization: KnowledgePrivateReviewAuthorization }> {
  const request = descriptors.get(descriptor);
  if (!request) throw new KnowledgePrivateReviewError('private_review_descriptor_invalid');
  assertKnowledgePrivateReviewRequest(request);
  assertKnowledgeGuardedBounds(bounds, 'private review bounds');
  if (!same(request.binding, binding)) throw new KnowledgePrivateReviewError('private_review_binding_mismatch');
  const envelope: KnowledgePrivateReviewEnvelope = { descriptor: request, limits: { ...bounds } };
  if (knowledgeGuardedUtf8Bytes(envelope) > bounds.max_bytes) throw new KnowledgePrivateReviewError('private_review_request_too_large');
  const requestDigest = knowledgeGuardedDigest(envelope);
  let response: KnowledgePrivateReviewReadback;
  try {
    response = await transport.post<KnowledgePrivateReviewReadback>('/guarded-writes/reviews', envelope, {
      headers: {
        'x-knowledge-tenant-id': binding.tenant_id,
        'x-knowledge-max-calls': String(bounds.max_calls),
        'x-knowledge-max-items': String(bounds.max_items),
        'x-knowledge-max-bytes': String(bounds.max_bytes),
        'x-knowledge-wall-time-ms': String(bounds.wall_time_ms),
      }, timeoutMs: bounds.wall_time_ms, retry: false,
    });
  } catch (error) {
    const status = (error && typeof error === 'object' && typeof (error as {status?: unknown}).status === 'number')
      ? (error as {status: number}).status : undefined;
    throw new KnowledgePrivateReviewError('private_review_transport_failed', status);
  }
  try {
    const authorization = response?.review_authorization;
    if (!response || knowledgeGuardedUtf8Bytes(response) > bounds.max_bytes
      || response.contract !== KNOWLEDGE_GUARDED_WRITE_CONTRACT || response.exact !== true
      || response.bounded !== true || response.private !== true || response.item_count !== 1
      || response.request_digest !== requestDigest || !same(response.binding, binding)
      || !same(response.limits, bounds) || response.binding_state !== request.expected_binding_state
      || response.item?.id !== request.target_id || response.item.version !== request.expected_version
      || typeof response.item.content !== 'string' || typeof response.item.title !== 'string'
      || !Array.isArray(response.item.tags) || !response.item.tags.every(x => typeof x === 'string')
      || knowledgeGuardedContentSha256(response.item.content) !== request.expected_content_sha256
      || !authorization || authorization.schema !== KNOWLEDGE_PRIVATE_REVIEW_TOKEN_SCHEMA
      || authorization.request_digest !== requestDigest || authorization.expires_at !== request.expires_at
      || typeof authorization.token !== 'string' || authorization.token.length < 32) throw new Error();
  } catch {
    throw new KnowledgePrivateReviewError('private_review_response_invalid');
  }
  const item = deepFreeze(structuredClone(response.item));
  const proof = deepFreeze({ contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT, kind: 'review' as const, item_count: 1 as const,
    request_digest: requestDigest, binding_state: response.binding_state, item: knowledgePrivateItemProof(item) });
  return { item, proof, authorization: response.review_authorization };
}

/** @internal The writer owns transport; no raw-body accessor is exported. */
export async function executeKnowledgePrivateReview(
  transport: HasnaStorageClient['transport'], binding: KnowledgeGuardedBinding,
  descriptor: KnowledgePrivateReviewDescriptor, reviewer: KnowledgePrivateReviewer,
  bounds: KnowledgeGuardedBounds,
): Promise<KnowledgePrivateReviewProof> {
  if (typeof reviewer !== 'function') throw new KnowledgePrivateReviewError('private_review_descriptor_invalid');
  const reviewed = await readKnowledgePrivateReview(transport, binding, descriptor, bounds);
  try {
    await reviewer(reviewed.item);
  } catch {
    throw new KnowledgePrivateReviewError('private_review_callback_failed');
  }
  return reviewed.proof;
}

/** @internal Review, then obtain a server-signed grant for exactly one returned update descriptor. */
export async function approveKnowledgePrivateEdit(
  transport: HasnaStorageClient['transport'], binding: KnowledgeGuardedBinding,
  descriptor: KnowledgePrivateReviewDescriptor, approvedBy: string,
  reviewer: KnowledgePrivateEditReviewer, bounds: KnowledgeGuardedBounds,
): Promise<KnowledgePrivateEditApproval> {
  try { assertBoundText(approvedBy, 'approved_by'); } catch { throw new KnowledgePrivateReviewError('private_edit_approval_invalid'); }
  if (typeof reviewer !== 'function') throw new KnowledgePrivateReviewError('private_edit_approval_invalid');
  const reviewed = await readKnowledgePrivateReview(transport, binding, descriptor, bounds);
  let edit: KnowledgePrivateInputDescriptor;
  try {
    edit = await reviewer(reviewed.item);
    const payload = materializeKnowledgePrivateInput(edit);
    if (edit.verb !== 'update' || !same(edit.binding, binding) || edit.target_id !== descriptor.target_id
      || edit.precondition.kind !== 'version' || edit.precondition.expected_version !== descriptor.expected_version
      || knowledgeGuardedDigest(payload) !== edit.payload_digest) throw new Error();
  } catch {
    throw new KnowledgePrivateReviewError('private_edit_approval_invalid');
  }
  const deterministicKey = computeKnowledgeGuardedDeterministicKey({
    binding: edit.binding,
    operation_id: edit.operation_id,
    step_id: edit.step_id,
    verb: edit.verb,
    target_id: edit.target_id,
    payload_digest: edit.payload_digest,
    precondition: edit.precondition,
    manifest: edit.manifest,
  });
  const envelope: KnowledgePrivateEditApprovalEnvelope = {
    review_authorization: reviewed.authorization,
    descriptor: edit.toJSON(),
    deterministic_key: deterministicKey,
    approved_by: approvedBy,
    limits: { ...bounds },
  };
  if (knowledgeGuardedUtf8Bytes(envelope) > bounds.max_bytes) throw new KnowledgePrivateReviewError('private_edit_approval_request_too_large');
  let grant: KnowledgePrivateEditApprovalGrant;
  try {
    grant = await transport.post<KnowledgePrivateEditApprovalGrant>('/guarded-writes/review-approvals', envelope, {
      headers: {
        'x-knowledge-tenant-id': binding.tenant_id,
        'x-knowledge-max-calls': String(bounds.max_calls),
        'x-knowledge-max-items': String(bounds.max_items),
        'x-knowledge-max-bytes': String(bounds.max_bytes),
        'x-knowledge-wall-time-ms': String(bounds.wall_time_ms),
      }, timeoutMs: bounds.wall_time_ms, retry: false,
    });
  } catch (error) {
    const status = (error && typeof error === 'object' && typeof (error as {status?: unknown}).status === 'number')
      ? (error as {status: number}).status : undefined;
    throw new KnowledgePrivateReviewError('private_edit_approval_transport_failed', status);
  }
  try {
    if (!grant || knowledgeGuardedUtf8Bytes(grant) > bounds.max_bytes
      || grant.contract !== KNOWLEDGE_GUARDED_WRITE_CONTRACT
      || grant.schema !== KNOWLEDGE_PRIVATE_EDIT_APPROVAL_SCHEMA
      || grant.review_request_digest !== reviewed.proof.request_digest
      || grant.mutation_deterministic_key !== deterministicKey
      || grant.binding_digest !== edit.binding_digest
      || grant.target_id !== edit.target_id
      || grant.expected_version !== descriptor.expected_version
      || grant.expected_content_sha256 !== descriptor.expected_content_sha256
      || grant.approved_by !== approvedBy
      || typeof grant.approved_actor !== 'string' || !grant.approved_actor
      || typeof grant.token !== 'string' || grant.token.length < 32
      || Date.parse(grant.expires_at) <= Date.now()) throw new Error();
  } catch {
    throw new KnowledgePrivateReviewError('private_edit_approval_response_invalid');
  }
  const metadata = deepFreeze({
    contract: grant.contract,
    schema: grant.schema,
    approval_id: grant.approval_id,
    review_request_digest: grant.review_request_digest,
    mutation_deterministic_key: grant.mutation_deterministic_key,
    binding_digest: grant.binding_digest,
    target_id: grant.target_id,
    expected_version: grant.expected_version,
    expected_content_sha256: grant.expected_content_sha256,
    approved_by: grant.approved_by,
    approved_actor: grant.approved_actor,
    expires_at: grant.expires_at,
  });
  const approval = { ...metadata, toJSON: () => metadata } as KnowledgePrivateEditApproval;
  Object.defineProperty(approval, 'descriptor_id', { value: `kpea_handle_${randomUUID()}`, enumerable: false });
  Object.freeze(approval);
  approvals.set(approval, { descriptor: edit, grant: deepFreeze(structuredClone(grant)) });
  return approval;
}

/** @internal Resolve the exact approved descriptor and opaque token; clones/forgeries fail closed. */
export function materializeKnowledgePrivateEditApproval(approval: KnowledgePrivateEditApproval): {
  descriptor: KnowledgePrivateInputDescriptor;
  grant: KnowledgePrivateEditApprovalGrant;
} {
  const state = approvals.get(approval);
  if (!state || Date.parse(state.grant.expires_at) <= Date.now()) {
    throw new KnowledgePrivateReviewError('private_edit_approval_invalid');
  }
  return state;
}
