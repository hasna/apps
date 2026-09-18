/** Read-only, exact-version review of private Knowledge, including unadopted rows. */
import { randomUUID } from 'node:crypto';
import type { HasnaStorageClient } from './contracts-types.js';
import type { KnowledgeItem } from './store.js';
import {
  KNOWLEDGE_GUARDED_WRITE_CONTRACT,
  assertKnowledgeGuardedBinding,
  assertKnowledgeGuardedBounds,
  canonicalKnowledgeGuardedJson,
  knowledgeGuardedContentSha256,
  knowledgeGuardedDigest,
  knowledgeGuardedUtf8Bytes,
  knowledgePrivateItemProof,
  type KnowledgeGuardedBinding,
  type KnowledgeGuardedBounds,
  type KnowledgePrivateItemProof,
} from './guarded-write-contract.js';

export const KNOWLEDGE_PRIVATE_REVIEW_SCHEMA = 'hasna.knowledge.private-review.v1' as const;
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

export class KnowledgePrivateReviewError extends Error {
  constructor(readonly code: string, readonly status?: number) {
    super(code);
    this.name = 'KnowledgePrivateReviewError';
  }
}

const descriptors = new WeakMap<KnowledgePrivateReviewDescriptor, KnowledgePrivateReviewRequest>();
const same = (left: unknown, right: unknown) => canonicalKnowledgeGuardedJson(left) === canonicalKnowledgeGuardedJson(right);
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/** @internal Shared producer/server validation, with body-free errors. */
export function assertKnowledgePrivateReviewRequest(value: unknown): asserts value is KnowledgePrivateReviewRequest {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    const v = value as KnowledgePrivateReviewRequest;
    if (!same(Object.keys(v).sort(), ['binding', 'contract', 'expected_binding_state', 'expected_content_sha256', 'expected_version', 'expires_at', 'operation_id', 'schema', 'step_id', 'target_id'])) throw new Error();
    if (v.contract !== KNOWLEDGE_GUARDED_WRITE_CONTRACT || v.schema !== KNOWLEDGE_PRIVATE_REVIEW_SCHEMA) throw new Error();
    assertKnowledgeGuardedBinding(v.binding);
    for (const text of [v.operation_id, v.step_id, v.target_id]) {
      if (typeof text !== 'string' || !text.trim() || text.length > 512) throw new Error();
    }
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

/** @internal The writer owns transport; no raw-body accessor is exported. */
export async function executeKnowledgePrivateReview(
  transport: HasnaStorageClient['transport'], binding: KnowledgeGuardedBinding,
  descriptor: KnowledgePrivateReviewDescriptor, reviewer: KnowledgePrivateReviewer,
  bounds: KnowledgeGuardedBounds,
): Promise<KnowledgePrivateReviewProof> {
  const request = descriptors.get(descriptor);
  if (!request || typeof reviewer !== 'function') throw new KnowledgePrivateReviewError('private_review_descriptor_invalid');
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
    // Never forward transport bodies, response excerpts, callback errors, or causes.
    const status = (error && typeof error === 'object' && typeof (error as {status?: unknown}).status === 'number')
      ? (error as {status: number}).status : undefined;
    throw new KnowledgePrivateReviewError('private_review_transport_failed', status);
  }
  try {
    if (!response || knowledgeGuardedUtf8Bytes(response) > bounds.max_bytes
      || response.contract !== KNOWLEDGE_GUARDED_WRITE_CONTRACT || response.exact !== true
      || response.bounded !== true || response.private !== true || response.item_count !== 1
      || response.request_digest !== requestDigest || !same(response.binding, binding)
      || !same(response.limits, bounds) || response.binding_state !== request.expected_binding_state
      || response.item?.id !== request.target_id || response.item.version !== request.expected_version
      || typeof response.item.content !== 'string' || typeof response.item.title !== 'string'
      || !Array.isArray(response.item.tags) || !response.item.tags.every(x => typeof x === 'string')
      || knowledgeGuardedContentSha256(response.item.content) !== request.expected_content_sha256) throw new Error();
  } catch {
    throw new KnowledgePrivateReviewError('private_review_response_invalid');
  }
  const item = deepFreeze(structuredClone(response.item));
  try {
    await reviewer(item);
  } catch {
    throw new KnowledgePrivateReviewError('private_review_callback_failed');
  }
  return deepFreeze({ contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT, kind: 'review', item_count: 1,
    request_digest: requestDigest, binding_state: response.binding_state, item: knowledgePrivateItemProof(item) });
}
