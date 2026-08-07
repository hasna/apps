/**
 * Package-owned FCAME-1 producer for production Knowledge doctrine writes.
 *
 * Private content is accepted only through an opaque in-process descriptor.
 * The descriptor has metadata-only serialization; payload bytes never enter
 * argv, environment variables, logs, stdin, or an ad hoc plaintext file. The
 * only materialization is directly into the authenticated HTTPS request body.
 */
import type { HasnaStorageClient } from '@hasna/contracts/client/storage';
import { resolveKnowledgeGuardedTransport } from './cloud-store.js';
import {
  KNOWLEDGE_GUARDED_WRITE_CONTRACT,
  assertKnowledgeGuardedBinding,
  assertKnowledgeGuardedBounds,
  assertKnowledgeTerminalCompleteness,
  canonicalKnowledgeGuardedJson,
  computeKnowledgeGuardedDeterministicKey,
  computeKnowledgeGuardedManifestDeterministicKey,
  knowledgeGuardedDigest,
  knowledgeGuardedUtf8Bytes,
  materializeKnowledgePrivateInput,
  normalizeKnowledgeGuardedLimits,
  type CreateKnowledgeGuardedManifestOptions,
  type KnowledgeGuardedBinding,
  type KnowledgeGuardedBounds,
  type KnowledgeGuardedLimits,
  type KnowledgeGuardedManifestEnvelope,
  type KnowledgeGuardedManifestReconciliation,
  type KnowledgeGuardedManifestSubmission,
  type KnowledgeGuardedReadback,
  type KnowledgeGuardedReceipt,
  type KnowledgeGuardedSubmission,
  type KnowledgeGuardedWriteEnvelope,
  type KnowledgeGuardedWriteResult,
  type KnowledgePrivateInputDescriptor,
  type KnowledgeTerminalReconciliation,
} from './guarded-write-contract.js';

export interface CreateKnowledgeGuardedWriterOptions {
  binding: KnowledgeGuardedBinding;
  env?: NodeJS.ProcessEnv;
  limits?: Partial<KnowledgeGuardedLimits>;
  /**
   * Fail closed unless every executed descriptor names a pre-created manifest
   * step. Set this for every multi-record or multi-authority workflow.
   */
  require_manifest?: boolean;
}

export interface KnowledgeGuardedWriter {
  readonly binding: KnowledgeGuardedBinding;
  readonly limits: KnowledgeGuardedLimits;
  readonly require_manifest: boolean;
  createManifest(
    manifest: CreateKnowledgeGuardedManifestOptions,
    bounds?: KnowledgeGuardedBounds,
  ): Promise<KnowledgeGuardedManifestSubmission>;
  reconcileManifest(
    manifestId: string,
    bounds?: KnowledgeGuardedBounds,
  ): Promise<KnowledgeGuardedManifestReconciliation>;
  execute(descriptor: KnowledgePrivateInputDescriptor): Promise<KnowledgeGuardedWriteResult>;
  reconcile(
    deterministicKey: string,
    operationId: string,
    stepId: string,
    bounds?: KnowledgeGuardedBounds,
  ): Promise<KnowledgeTerminalReconciliation>;
  readback(
    fullId: string,
    bounds?: KnowledgeGuardedBounds,
  ): Promise<KnowledgeGuardedReadback>;
}

export class KnowledgeGuardedWriteRejectedError extends Error {
  readonly code = 'guarded_write_rejected';
  constructor(
    readonly receipt: KnowledgeGuardedReceipt,
    readonly reconciliation: KnowledgeTerminalReconciliation,
  ) {
    super(`guarded_write_rejected: ${receipt.code}; no unguarded retry was attempted.`);
    this.name = 'KnowledgeGuardedWriteRejectedError';
  }
}

export class KnowledgeGuardedOperationConflictError extends Error {
  readonly code = 'guarded_operation_conflict';
  constructor(readonly receipt: KnowledgeGuardedReceipt) {
    super(
      'guarded_operation_conflict: this authority/tenant/scope/parent operation and step '
      + 'are already bound to a different deterministic key.',
    );
    this.name = 'KnowledgeGuardedOperationConflictError';
  }
}

export class KnowledgeGuardedManifestConflictError extends Error {
  readonly code = 'guarded_manifest_conflict';
  constructor(readonly manifest: KnowledgeGuardedManifestSubmission['manifest']) {
    super(
      'guarded_manifest_conflict: this manifest id is already bound to a different '
      + 'immutable ordered workflow.',
    );
    this.name = 'KnowledgeGuardedManifestConflictError';
  }
}

export class KnowledgeGuardedManifestStepRefusedError extends Error {
  readonly code = 'guarded_manifest_step_refused';
  constructor(
    readonly deterministic_key: string,
    readonly reason: string,
  ) {
    super(`guarded_manifest_step_refused: ${reason}`);
    this.name = 'KnowledgeGuardedManifestStepRefusedError';
  }
}

export class KnowledgeGuardedManifestUncertainError extends Error {
  readonly code = 'guarded_manifest_terminal_state_unavailable';
  constructor(readonly deterministic_key: string) {
    super(
      'guarded_manifest_terminal_state_unavailable: manifest submission did not yield '
      + 'an exact immutable readback; the producer did not retry creation.',
    );
    this.name = 'KnowledgeGuardedManifestUncertainError';
  }
}

export class KnowledgeGuardedWriteUncertainError extends Error {
  readonly code = 'guarded_write_terminal_state_unavailable';
  constructor(readonly deterministic_key: string) {
    super(
      'guarded_write_terminal_state_unavailable: submission did not yield one exact terminal receipt; '
      + 'the producer did not retry the mutation.',
    );
    this.name = 'KnowledgeGuardedWriteUncertainError';
  }
}

function boundHeaders(bounds: KnowledgeGuardedBounds): Record<string, string> {
  return {
    'x-knowledge-max-calls': String(bounds.max_calls),
    'x-knowledge-max-items': String(bounds.max_items),
    'x-knowledge-max-bytes': String(bounds.max_bytes),
    'x-knowledge-wall-time-ms': String(bounds.wall_time_ms),
  };
}

function bindingQuery(binding: KnowledgeGuardedBinding): Record<string, string> {
  return {
    authority_classification: binding.authority.classification,
    authority_id: binding.authority.authority_id,
    tenant_id: binding.tenant_id,
    scope: binding.scope,
    parent_id: binding.parent_id,
  };
}

function sameBinding(left: KnowledgeGuardedBinding, right: KnowledgeGuardedBinding): boolean {
  return canonicalKnowledgeGuardedJson(left) === canonicalKnowledgeGuardedJson(right);
}

function parseErrorBody(error: unknown): Record<string, unknown> | null {
  if (!error || typeof error !== 'object') return null;
  const body = (error as { body?: unknown }).body;
  if (typeof body === 'string') {
    try {
      return JSON.parse(body) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return body && typeof body === 'object' ? body as Record<string, unknown> : null;
}

function operationConflictReceipt(error: unknown): KnowledgeGuardedReceipt | null {
  const body = parseErrorBody(error);
  if (body?.error !== 'operation_binding_conflict') return null;
  const receipt = body.receipt;
  return receipt && typeof receipt === 'object' ? receipt as KnowledgeGuardedReceipt : null;
}

function manifestConflict(error: unknown): KnowledgeGuardedManifestSubmission['manifest'] | null {
  const body = parseErrorBody(error);
  if (body?.error !== 'manifest_binding_conflict') return null;
  const manifest = body.manifest;
  return manifest && typeof manifest === 'object'
    ? manifest as KnowledgeGuardedManifestSubmission['manifest']
    : null;
}

function manifestStepRefusal(error: unknown): string | null {
  const body = parseErrorBody(error);
  const message = body?.message;
  if (typeof message !== 'string') return null;
  const guardedPrefixes = [
    'guarded manifest',
    'guarded write does not match its immutable manifest step',
    'manifest_',
    'external_authority_receipt_verifier_required',
  ];
  return guardedPrefixes.some((prefix) => message.startsWith(prefix)) ? message : null;
}

class GuardedWriter implements KnowledgeGuardedWriter {
  readonly binding: KnowledgeGuardedBinding;
  readonly limits: KnowledgeGuardedLimits;

  constructor(
    private readonly transport: HasnaStorageClient['transport'],
    binding: KnowledgeGuardedBinding,
    limits: KnowledgeGuardedLimits,
    readonly require_manifest: boolean,
  ) {
    this.binding = Object.freeze({
      authority: Object.freeze({ ...binding.authority }),
      tenant_id: binding.tenant_id,
      scope: binding.scope,
      parent_id: binding.parent_id,
    });
    this.limits = limits;
  }

  async execute(descriptor: KnowledgePrivateInputDescriptor): Promise<KnowledgeGuardedWriteResult> {
    if (this.require_manifest && !descriptor.manifest) {
      throw new Error(
        'guarded_manifest_required: this writer is configured for multi-step work and refuses an unmanifested write.',
      );
    }
    if (!sameBinding(descriptor.binding, this.binding)) {
      throw new Error('private input descriptor binding does not match this guarded writer.');
    }
    const payload = materializeKnowledgePrivateInput(descriptor);
    if (knowledgeGuardedDigest(payload) !== descriptor.payload_digest) {
      throw new Error('private input descriptor payload digest changed after freeze.');
    }
    const bindingDigest = knowledgeGuardedDigest({
      binding: descriptor.binding,
      operation_id: descriptor.operation_id,
      step_id: descriptor.step_id,
      verb: descriptor.verb,
      target_id: descriptor.target_id,
      precondition: descriptor.precondition,
      payload_digest: descriptor.payload_digest,
      manifest: descriptor.manifest,
    });
    if (bindingDigest !== descriptor.binding_digest) {
      throw new Error('private input descriptor binding digest changed after freeze.');
    }

    const deterministicKey = computeKnowledgeGuardedDeterministicKey({
      binding: descriptor.binding,
      operation_id: descriptor.operation_id,
      step_id: descriptor.step_id,
      verb: descriptor.verb,
      target_id: descriptor.target_id,
      payload_digest: descriptor.payload_digest,
      precondition: descriptor.precondition,
      manifest: descriptor.manifest,
    });
    const envelope: KnowledgeGuardedWriteEnvelope = {
      contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
      descriptor: descriptor.toJSON(),
      deterministic_key: deterministicKey,
      limits: this.limits,
      payload,
    };
    if (knowledgeGuardedUtf8Bytes(envelope) > this.limits.submission.max_bytes) {
      throw new Error('guarded_write_request_exceeds_submission_byte_cap.');
    }

    let submission: KnowledgeGuardedSubmission | null = null;
    let submitError: unknown = null;
    try {
      submission = await this.transport.post<KnowledgeGuardedSubmission>(
        '/guarded-writes',
        envelope,
        {
          headers: {
            ...boundHeaders(this.limits.submission),
            'x-knowledge-tenant-id': this.binding.tenant_id,
          },
          idempotencyKey: deterministicKey,
          timeoutMs: this.limits.submission.wall_time_ms,
          // FCAME-1 reconciles before any retry. The deterministic key remains
          // present for intermediary/server replay protection, but transport
          // retries are disabled so an ambiguous response cannot blind-replay.
          retry: false,
        },
      );
    } catch (error) {
      submitError = error;
    }

    let reconciliation: KnowledgeTerminalReconciliation;
    try {
      reconciliation = await this.reconcile(
        deterministicKey,
        descriptor.operation_id,
        descriptor.step_id,
      );
    } catch {
      const conflict = operationConflictReceipt(submitError);
      if (conflict) throw new KnowledgeGuardedOperationConflictError(conflict);
      const refusal = descriptor.manifest ? manifestStepRefusal(submitError) : null;
      if (refusal) throw new KnowledgeGuardedManifestStepRefusedError(deterministicKey, refusal);
      throw new KnowledgeGuardedWriteUncertainError(deterministicKey);
    }

    if (reconciliation.receipt_count === 0 || reconciliation.receipt === null) {
      const conflict = operationConflictReceipt(submitError);
      if (conflict) throw new KnowledgeGuardedOperationConflictError(conflict);
      const refusal = descriptor.manifest ? manifestStepRefusal(submitError) : null;
      if (refusal) throw new KnowledgeGuardedManifestStepRefusedError(deterministicKey, refusal);
      throw new KnowledgeGuardedWriteUncertainError(deterministicKey);
    }

    const receipt = assertKnowledgeTerminalCompleteness(reconciliation, {
      deterministic_key: deterministicKey,
      operation_id: descriptor.operation_id,
      step_id: descriptor.step_id,
    });
    if (
      submission
      && (
        submission.deterministic_key !== deterministicKey
        || submission.receipt.receipt_id !== receipt.receipt_id
      )
    ) {
      throw new KnowledgeGuardedWriteUncertainError(deterministicKey);
    }
    if (receipt.status !== 'accepted') {
      throw new KnowledgeGuardedWriteRejectedError(receipt, reconciliation);
    }
    if (receipt.effect_count !== 1 || receipt.result_id !== descriptor.target_id) {
      throw new KnowledgeGuardedWriteUncertainError(deterministicKey);
    }

    const readback = await this.readback(receipt.result_id);
    if (
      readback.item.id !== descriptor.target_id
      || !sameBinding(readback.binding, this.binding)
      || readback.item.version !== receipt.result_version
    ) {
      throw new KnowledgeGuardedWriteUncertainError(deterministicKey);
    }

    return {
      deterministic_key: deterministicKey,
      duplicate: submission?.duplicate ?? false,
      receipt,
      reconciliation,
      readback,
    };
  }

  async createManifest(
    manifest: CreateKnowledgeGuardedManifestOptions,
    bounds: KnowledgeGuardedBounds = this.limits.submission,
  ): Promise<KnowledgeGuardedManifestSubmission> {
    assertKnowledgeGuardedBounds(bounds, 'manifest submission bounds');
    const deterministicKey = computeKnowledgeGuardedManifestDeterministicKey(this.binding, manifest);
    const envelope: KnowledgeGuardedManifestEnvelope = {
      contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
      maintainer: this.binding,
      manifest,
      deterministic_key: deterministicKey,
    };
    if (knowledgeGuardedUtf8Bytes(envelope) > bounds.max_bytes) {
      throw new Error('guarded_manifest_request_exceeds_byte_cap.');
    }
    let submitted: KnowledgeGuardedManifestSubmission | null = null;
    let submitError: unknown = null;
    try {
      submitted = await this.transport.post<KnowledgeGuardedManifestSubmission>(
        '/guarded-manifests',
        envelope,
        {
          headers: {
            ...boundHeaders(bounds),
            'x-knowledge-tenant-id': this.binding.tenant_id,
          },
          idempotencyKey: deterministicKey,
          timeoutMs: bounds.wall_time_ms,
          retry: false,
        },
      );
    } catch (error) {
      const existing = manifestConflict(error);
      if (existing) throw new KnowledgeGuardedManifestConflictError(existing);
      submitError = error;
    }
    let reconciled: KnowledgeGuardedManifestReconciliation;
    try {
      reconciled = await this.reconcileManifest(manifest.manifest_id, bounds);
    } catch {
      const existing = manifestConflict(submitError);
      if (existing) throw new KnowledgeGuardedManifestConflictError(existing);
      throw new KnowledgeGuardedManifestUncertainError(deterministicKey);
    }
    if (reconciled.manifest.deterministic_key !== deterministicKey) {
      throw new KnowledgeGuardedManifestConflictError(reconciled.manifest);
    }
    if (
      submitted
      && (
        submitted.contract !== KNOWLEDGE_GUARDED_WRITE_CONTRACT
        || submitted.deterministic_key !== deterministicKey
        || submitted.manifest.manifest_receipt_id !== reconciled.manifest.manifest_receipt_id
      )
    ) {
      throw new KnowledgeGuardedManifestUncertainError(deterministicKey);
    }
    return submitted ?? {
      contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
      deterministic_key: deterministicKey,
      manifest: reconciled.manifest,
      duplicate: true,
    };
  }

  async reconcileManifest(
    manifestId: string,
    bounds: KnowledgeGuardedBounds = this.limits.reconciliation,
  ): Promise<KnowledgeGuardedManifestReconciliation> {
    assertKnowledgeGuardedBounds(bounds, 'manifest reconciliation bounds');
    const response = await this.transport.get<KnowledgeGuardedManifestReconciliation>(
      `/guarded-manifests/${encodeURIComponent(manifestId)}`,
      {
        query: {
          ...bindingQuery(this.binding),
          max_calls: bounds.max_calls,
          max_items: bounds.max_items,
          max_bytes: bounds.max_bytes,
          wall_time_ms: bounds.wall_time_ms,
        },
        headers: boundHeaders(bounds),
        timeoutMs: bounds.wall_time_ms,
        retry: false,
      },
    );
    if (knowledgeGuardedUtf8Bytes(response) > bounds.max_bytes) {
      throw new Error('guarded_manifest_response_exceeds_byte_cap.');
    }
    if (
      response.contract !== KNOWLEDGE_GUARDED_WRITE_CONTRACT
      || response.manifest.manifest_id !== manifestId
      || response.exact !== true
      || response.bounded !== true
    ) {
      throw new Error('guarded_manifest_exact_reconciliation_failed.');
    }
    return response;
  }

  async reconcile(
    deterministicKey: string,
    operationId: string,
    stepId: string,
    bounds: KnowledgeGuardedBounds = this.limits.reconciliation,
  ): Promise<KnowledgeTerminalReconciliation> {
    assertKnowledgeGuardedBounds(bounds, 'write reconciliation bounds');
    const response = await this.transport.get<KnowledgeTerminalReconciliation>(
      `/guarded-writes/receipts/${encodeURIComponent(deterministicKey)}`,
      {
        query: {
          ...bindingQuery(this.binding),
          operation_id: operationId,
          step_id: stepId,
          max_calls: bounds.max_calls,
          max_items: bounds.max_items,
          max_bytes: bounds.max_bytes,
          wall_time_ms: bounds.wall_time_ms,
        },
        headers: boundHeaders(bounds),
        timeoutMs: bounds.wall_time_ms,
        retry: false,
      },
    );
    if (knowledgeGuardedUtf8Bytes(response) > bounds.max_bytes) {
      throw new Error('guarded_reconciliation_response_exceeds_byte_cap.');
    }
    return response;
  }

  async readback(
    fullId: string,
    bounds: KnowledgeGuardedBounds = this.limits.readback,
  ): Promise<KnowledgeGuardedReadback> {
    assertKnowledgeGuardedBounds(bounds, 'readback bounds');
    const response = await this.transport.get<KnowledgeGuardedReadback>(
      `/guarded-writes/items/${encodeURIComponent(fullId)}`,
      {
        query: {
          ...bindingQuery(this.binding),
          max_calls: bounds.max_calls,
          max_items: bounds.max_items,
          max_bytes: bounds.max_bytes,
          wall_time_ms: bounds.wall_time_ms,
        },
        headers: boundHeaders(bounds),
        timeoutMs: bounds.wall_time_ms,
        retry: false,
      },
    );
    if (knowledgeGuardedUtf8Bytes(response) > bounds.max_bytes) {
      throw new Error('guarded_readback_response_exceeds_byte_cap.');
    }
    return response;
  }
}

export function createKnowledgeGuardedWriter(
  options: CreateKnowledgeGuardedWriterOptions,
): KnowledgeGuardedWriter {
  assertKnowledgeGuardedBinding(options.binding);
  const transport = resolveKnowledgeGuardedTransport(options.env ?? process.env);
  if (!transport) {
    throw new Error(
      'FCAME-1 guarded writes require the authenticated postgres/API transport; '
      + 'local JSON, SQLite, and raw-store fallbacks are refused.',
    );
  }
  return new GuardedWriter(
    transport,
    options.binding,
    normalizeKnowledgeGuardedLimits(options.limits),
    options.require_manifest === true,
  );
}
