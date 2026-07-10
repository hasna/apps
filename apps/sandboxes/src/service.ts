import {
  assertOpaqueId,
  canonicalDigest,
  createOpaqueId,
  nowRfc3339,
  sha256,
  type Digest,
} from "./canonical.js";
import { SandboxError, asSandboxError } from "./errors.js";
import type { ProviderHandleSealerV1 } from "./handle-sealer.js";
import type { SandboxRepositoryTxV1, SandboxRepositoryV1 } from "./repository.js";
import {
  AmbiguousProviderEffectError,
  type AdapterCallContextV1,
  type DestroyContextV1,
  type SandboxRunnerV1,
} from "./runner.js";
import {
  SCHEMA_VERSION,
  type ActivationGrantV1,
  type CanonicalSandboxEffectFenceV1,
  type CapabilityClaimsV1,
  type CheckpointDurabilityReceiptV1,
  type CreateSandboxV1,
  type GitPromotionReceiptRefV1,
  type InfinityCleanupGrantV1,
  type MutationContextV1,
  type OperationRecordV1,
  type OperationResolutionV1,
  type OwnedProviderHandleV1,
  type ProviderOperationV1,
  type ReconcileFindingV1,
  type SandboxEventV1,
  type SandboxOperation,
  type SandboxState,
  type SandboxStateReason,
  type SandboxV1,
} from "./types.js";
import {
  validateActivationGrant,
  validateCapability,
  validateCheckpointReceipt,
  validateCleanupGrant,
  validateCreateSandbox,
  validateFence,
} from "./validation.js";

export interface SandboxesAuthorityVerifierV1 {
  verifyCapability(claims: CapabilityClaimsV1): Promise<void>;
  verifyActivationGrant(grant: ActivationGrantV1): Promise<void>;
  verifyCleanupGrant(grant: InfinityCleanupGrantV1): Promise<void>;
  verifyCheckpointReceipt(receipt: CheckpointDurabilityReceiptV1): Promise<void>;
  verifyGitPromotionReceipt(receipt: GitPromotionReceiptRefV1): Promise<void>;
}

export interface SandboxesServiceConfigV1 {
  repository: SandboxRepositoryV1;
  runner: SandboxRunnerV1;
  handle_sealer: ProviderHandleSealerV1;
  authority_verifier: SandboxesAuthorityVerifierV1;
  clock?: () => Date;
  allow_test_runner?: boolean;
}

interface NormalizedMutationContext {
  operation_id: string;
  idempotency_key_sha256: Digest;
  request_sha256: Digest;
  expected_revision: number;
  fence: CanonicalSandboxEffectFenceV1;
  capability: CapabilityClaimsV1;
}

interface ReservedOperation {
  operation: OperationRecordV1;
  replay: boolean;
}

export function createRequestDigest(input: CreateSandboxV1): Digest {
  return canonicalDigest(validateCreateSandbox(input));
}

export function activationRequestDigest(resourceId: string, networkPolicySha256: Digest): Digest {
  return canonicalDigest({
    schema_version: SCHEMA_VERSION,
    operation: "activate",
    resource_id: resourceId,
    network_policy_sha256: networkPolicySha256,
  });
}

export function expireRequestDigest(resourceId: string): Digest {
  return canonicalDigest({ schema_version: SCHEMA_VERSION, operation: "expire", resource_id: resourceId });
}

export function destroyRequestDigest(resourceId: string, basisReceiptSha256: Digest): Digest {
  return canonicalDigest({
    schema_version: SCHEMA_VERSION,
    operation: "destroy",
    resource_id: resourceId,
    basis_receipt_sha256: basisReceiptSha256,
  });
}

export class SandboxesReferenceServiceV1 {
  readonly #repository: SandboxRepositoryV1;
  readonly #runner: SandboxRunnerV1;
  readonly #sealer: ProviderHandleSealerV1;
  readonly #verifier: SandboxesAuthorityVerifierV1;
  readonly #clock: () => Date;
  readonly #allowTestRunner: boolean;

  constructor(config: SandboxesServiceConfigV1) {
    this.#repository = config.repository;
    this.#runner = config.runner;
    this.#sealer = config.handle_sealer;
    this.#verifier = config.authority_verifier;
    this.#clock = config.clock ?? (() => new Date());
    this.#allowTestRunner = config.allow_test_runner === true;
    this.#repository.migrate();
  }

  async create(inputValue: CreateSandboxV1, contextValue: MutationContextV1): Promise<SandboxV1> {
    const input = validateCreateSandbox(inputValue);
    const expectedDigest = createRequestDigest(input);
    const ctx = await this.#authorize("create_inert", input.resource_id, expectedDigest, contextValue);
    if (input.spec.run_id !== ctx.fence.run_id || input.spec.attempt_id !== ctx.fence.attempt_id) {
      throw new SandboxError("request_digest_mismatch", "Spec authority references do not match the fence");
    }
    if (ctx.expected_revision !== 0 || ctx.fence.resource_lifecycle_generation !== 1n) {
      throw new SandboxError("stale_revision", "Inert create requires reserved revision zero and generation one");
    }
    const descriptor = await this.#runner.descriptor();
    if (descriptor.status !== "admitted" && !(descriptor.status === "test_only" && this.#allowTestRunner)) {
      throw new SandboxError("unsupported_runtime_feature", "Runner is not admitted for this service");
    }
    if (!descriptor.inert_create || !descriptor.exact_operation_lookup) {
      throw new SandboxError("unsupported_runtime_feature", "Runner lacks mandatory inert-create reconciliation");
    }

    const createdAt = this.#now();
    const initial: SandboxV1 = {
      schema_version: SCHEMA_VERSION,
      id: input.resource_id,
      resource_id: input.resource_id,
      revision: 1,
      spec_sha256: canonicalDigest(input.spec),
      spec: input.spec,
      state: "creating_inert",
      state_reason_code: "inert_create_dispatched",
      authority_epoch: ctx.fence.authority_epoch,
      route_lineage_id: ctx.fence.route_lineage_id,
      route_id: ctx.fence.route_id,
      route_epoch: ctx.fence.route_epoch,
      run_id: ctx.fence.run_id,
      attempt_id: ctx.fence.attempt_id,
      attempt_lease_id: ctx.fence.attempt_lease_id,
      lease_epoch: ctx.fence.lease_epoch,
      resource_lease_id: ctx.fence.resource_lease_id,
      resource_lifecycle_generation: ctx.fence.resource_lifecycle_generation,
      operation_execution_epoch: ctx.fence.operation_execution_epoch,
      actor_principal: ctx.fence.actor_principal,
      lease_holder_principal: ctx.fence.lease_holder_principal,
      operation_executor_principal: ctx.fence.operation_executor_principal,
      audience: SCHEMA_VERSION,
      runtime_class: "strong_vm",
      adapter_descriptor_sha256: descriptor.descriptor_sha256,
      create_inert_operation_id: ctx.operation_id,
      durable_checkpoint_receipt_sha256: [],
      git_promotion_receipt_sha256: [],
      created_at: createdAt,
      expires_at: input.spec.expires_at,
    };

    const reservation = this.#repository.transaction((tx) => {
      const existing = tx.getSandbox(input.resource_id);
      if (existing !== undefined) {
        const replay = this.#resolveReplay(tx, ctx, "create_inert", input.resource_id);
        if (replay !== undefined && replay.state === "committed") return { operation: replay, replay: true };
        throw new SandboxError("stale_revision", "Resource identity is already reserved");
      }
      const operation = this.#reserve(tx, "create_inert", input.resource_id, ctx);
      if (operation.replay) return operation;
      tx.putSandbox(initial, null);
      this.#event(tx, initial, ctx.operation_id, "operation_reserved");
      return operation;
    });
    if (reservation.replay) return this.get(input.resource_id);

    const op = this.#providerOperation("create_inert", ctx);
    let handle: OwnedProviderHandleV1;
    try {
      handle = await this.#runner.createInert(
        this.#adapterContext(ctx),
        input.spec,
        op,
        input.allocation_key_sha256,
      );
    } catch (error) {
      if (error instanceof AmbiguousProviderEffectError) {
        const observation = await this.#runner.lookupOperation(
          { installation_id: "installation_00000000000000000000000000000001", deadline: ctx.fence.operation_execution_expires_at },
          op,
        );
        if (observation.state === "completed" && observation.handle !== undefined) {
          handle = observation.handle;
        } else {
          return this.#markUnknown(initial.id, ctx.operation_id, "ambiguous_provider_state");
        }
      } else {
        this.#markFailed(initial.id, ctx.operation_id);
        throw asSandboxError(error);
      }
    }

    this.#assertCreatedHandle(handle, initial, ctx);
    return this.#repository.transaction((tx) => {
      const current = this.#mustSandbox(tx, initial.id);
      if (current.state !== "creating_inert" || current.revision !== 1) {
        throw new SandboxError("stale_revision", "Create receipt lost its reservation CAS");
      }
      const generation = current.resource_lifecycle_generation + 1n;
      const sealed = this.#sealer.seal({ ...handle, resource_lifecycle_generation: generation });
      const committed: SandboxV1 = {
        ...current,
        revision: 2,
        state: "inert",
        state_reason_code: "inert_receipt_committed",
        resource_lifecycle_generation: generation,
        provider_handle_sha256: sealed.provider_handle_sha256,
        immutable_fingerprint_sha256: handle.immutable_fingerprint_sha256,
        allocated_at: this.#now(),
      };
      tx.putSandbox(committed, current.revision);
      tx.putHandle(sealed);
      this.#commitOperation(tx, ctx.operation_id, canonicalDigest(committed));
      this.#event(tx, committed, ctx.operation_id, "operation_committed");
      return committed;
    });
  }

  async activate(
    resourceId: string,
    grantValue: ActivationGrantV1,
    contextValue: MutationContextV1,
  ): Promise<SandboxV1> {
    assertOpaqueId(resourceId, "resource_id", "sbx");
    const grant = validateActivationGrant(grantValue);
    const expectedDigest = activationRequestDigest(resourceId, grant.network_policy_sha256);
    const ctx = await this.#authorize("activate", resourceId, expectedDigest, contextValue);
    await this.#verifier.verifyActivationGrant(grant);
    this.#assertGrantFresh(grant.expires_at);
    if (
      grant.resource_id !== resourceId ||
      grant.resource_lifecycle_generation !== ctx.fence.resource_lifecycle_generation ||
      grant.operation_id !== ctx.operation_id ||
      grant.operation_digest !== ctx.request_sha256
    ) {
      throw new SandboxError("capability_denied", "Activation grant does not bind the exact operation");
    }

    const reservation = this.#repository.transaction((tx) => {
      const current = this.#mustSandbox(tx, resourceId);
      this.#assertCurrentFence(current, ctx.fence);
      this.#assertExpectedRevision(current, ctx.expected_revision);
      if (current.state !== "inert") {
        throw new SandboxError("activation_receipt_required", "Only a durably inert sandbox can activate");
      }
      if (grant.network_policy_sha256 !== current.spec.network_policy.policy_sha256) {
        throw new SandboxError("policy_denied", "Activation network policy digest mismatch");
      }
      const operation = this.#reserve(tx, "activate", resourceId, ctx);
      if (operation.replay) return { ...operation, current };
      tx.consumeActivationGrant(canonicalDigest({ id: grant.grant_id, nonce: grant.one_use_nonce_sha256 }), ctx.operation_id);
      const activating = this.#transition(current, "activating", "activation_dispatched", ctx.fence, false);
      tx.putSandbox(activating, current.revision);
      this.#event(tx, activating, ctx.operation_id, "operation_reserved");
      return { ...operation, current: activating };
    });
    if (reservation.replay) return this.get(resourceId);
    const sealed = this.#repository.transaction((tx) => tx.getHandle(resourceId));
    if (sealed === undefined) throw new SandboxError("integrity_failed", "Inert handle receipt is missing");
    const handle = this.#sealer.open(sealed);
    this.#assertHandleGeneration(handle, ctx.fence);
    try {
      await this.#runner.activate(this.#adapterContext(ctx), handle, grant, this.#providerOperation("activate", ctx));
    } catch (error) {
      return this.#markUnknown(resourceId, ctx.operation_id, "ambiguous_provider_state");
    }
    return this.#repository.transaction((tx) => {
      const current = this.#mustSandbox(tx, resourceId);
      if (current.state !== "activating") throw new SandboxError("stale_revision", "Activation CAS was superseded");
      const active = this.#transition(current, "active", "activation_receipt_committed", ctx.fence, true);
      tx.putSandbox(active, current.revision);
      tx.putHandle(this.#sealer.seal({ ...handle, resource_lifecycle_generation: active.resource_lifecycle_generation }));
      this.#commitOperation(tx, ctx.operation_id, canonicalDigest(active));
      this.#event(tx, active, ctx.operation_id, "operation_committed");
      return active;
    });
  }

  async expire(resourceId: string, contextValue: MutationContextV1): Promise<SandboxV1> {
    assertOpaqueId(resourceId, "resource_id", "sbx");
    const ctx = await this.#authorize("expire", resourceId, expireRequestDigest(resourceId), contextValue);
    const reservation = this.#repository.transaction((tx) => {
      const current = this.#mustSandbox(tx, resourceId);
      this.#assertCurrentFence(current, ctx.fence);
      this.#assertExpectedRevision(current, ctx.expected_revision);
      if (!["inert", "active", "failed", "quarantined"].includes(current.state)) {
        throw new SandboxError("policy_denied", "Sandbox cannot enter expiry from its current state");
      }
      const operation = this.#reserve(tx, "expire", resourceId, ctx);
      return { ...operation, current };
    });
    if (reservation.replay) return this.get(resourceId);
    const sealed = this.#repository.transaction((tx) => tx.getHandle(resourceId));
    if (sealed === undefined) throw new SandboxError("integrity_failed", "Provider handle is missing");
    const handle = this.#sealer.open(sealed);
    this.#assertHandleGeneration(handle, ctx.fence);
    try {
      await this.#runner.expire(this.#adapterContext(ctx), handle, this.#providerOperation("expire", ctx));
    } catch {
      return this.#markUnknown(resourceId, ctx.operation_id, "ambiguous_provider_state");
    }
    return this.#repository.transaction((tx) => {
      const current = this.#mustSandbox(tx, resourceId);
      const expiring = this.#transition(current, "expiring", "sandbox_expired", ctx.fence, true);
      tx.putSandbox(expiring, current.revision);
      tx.putHandle(this.#sealer.seal({ ...handle, resource_lifecycle_generation: expiring.resource_lifecycle_generation }));
      this.#commitOperation(tx, ctx.operation_id, canonicalDigest(expiring));
      this.#event(tx, expiring, ctx.operation_id, "operation_committed");
      return expiring;
    });
  }

  async destroy(
    resourceId: string,
    grantValue: InfinityCleanupGrantV1,
    contextValue: MutationContextV1,
  ): Promise<SandboxV1> {
    assertOpaqueId(resourceId, "resource_id", "sbx");
    const grant = validateCleanupGrant(grantValue);
    const ctx = await this.#authorize(
      "destroy",
      resourceId,
      destroyRequestDigest(resourceId, grant.basis.receipt_sha256),
      contextValue,
    );
    await this.#verifier.verifyCleanupGrant(grant);
    this.#assertGrantFresh(grant.expires_at);

    const reservation = this.#repository.transaction((tx) => {
      const current = this.#mustSandbox(tx, resourceId);
      this.#assertCurrentFence(current, ctx.fence);
      this.#assertExpectedRevision(current, ctx.expected_revision);
      if (current.state === "destroyed") {
        const replay = this.#resolveReplay(tx, ctx, "destroy", resourceId);
        if (replay?.state === "committed") return { operation: replay, replay: true, current };
        throw new SandboxError("stale_revision", "Destroyed tombstones cannot be mutated");
      }
      if (current.provider_handle_sha256 === undefined) {
        throw new SandboxError("cleanup_grant_mismatch", "Cleanup target has no sealed provider handle");
      }
      if (
        grant.resource_id !== resourceId ||
        grant.resource_lifecycle_generation !== current.resource_lifecycle_generation ||
        grant.provider_handle_sha256 !== current.provider_handle_sha256 ||
        grant.operation_id !== ctx.operation_id ||
        grant.operation_digest !== ctx.request_sha256 ||
        grant.cleanup_executor_principal !== ctx.fence.operation_executor_principal
      ) {
        throw new SandboxError("cleanup_grant_mismatch", "Cleanup grant does not bind the exact native resource operation");
      }
      this.#assertCleanupBasis(current, grant);
      const operation = this.#reserve(tx, "destroy", resourceId, ctx);
      if (operation.replay) return { ...operation, current };
      tx.consumeCleanupGrant(canonicalDigest({ id: grant.grant_id, nonce: grant.one_use_nonce_sha256 }), ctx.operation_id);
      const destroying = this.#transition(current, "destroying", "cleanup_authorized", ctx.fence, false);
      tx.putSandbox(destroying, current.revision);
      this.#event(tx, destroying, ctx.operation_id, "operation_reserved");
      return { ...operation, current: destroying };
    });
    if (reservation.replay) return this.get(resourceId);

    const sealed = this.#repository.transaction((tx) => tx.getHandle(resourceId));
    if (sealed === undefined || sealed.provider_handle_sha256 !== grant.provider_handle_sha256) {
      return this.#quarantineCleanup(resourceId, ctx.operation_id, "provider_identity_mismatch");
    }
    const handle = this.#sealer.open(sealed);
    this.#assertHandleGeneration(handle, ctx.fence);
    const providerOp = this.#providerOperation("destroy", ctx);
    let observation;
    try {
      const inspected = await this.#runner.inspect(this.#adapterContext(ctx), handle, {
        ...providerOp,
        operation: "inspect",
      });
      if (
        inspected.state !== "absent" &&
        (inspected.immutable_fingerprint_sha256 !== handle.immutable_fingerprint_sha256 ||
          inspected.provider_resource_version !== handle.provider_resource_version)
      ) {
        return this.#quarantineCleanup(resourceId, ctx.operation_id, "provider_identity_mismatch");
      }
      if (inspected.state === "absent") {
        observation = {
          state: "absent" as const,
          provider_receipt_sha256: sha256(`already-absent:${ctx.operation_id}`),
          observed_at: this.#now(),
        };
      } else if (inspected.state === "unknown") {
        return this.#quarantineCleanup(resourceId, ctx.operation_id, "ambiguous_provider_state");
      } else {
        const destroyContext: DestroyContextV1 = {
          ...this.#adapterContext(ctx),
          cleanup_grant_sha256: canonicalDigest(grant),
        };
        observation = await this.#runner.destroy(destroyContext, handle, providerOp);
      }
    } catch {
      return this.#quarantineCleanup(resourceId, ctx.operation_id, "ambiguous_provider_state", "cleanup_failed");
    }

    return this.#repository.transaction((tx) => {
      const current = this.#mustSandbox(tx, resourceId);
      const absent = observation.state === "absent";
      const next = this.#transition(
        current,
        absent ? "destroyed" : "cleanup_failed",
        absent ? "cleanup_terminal_absence" : "cleanup_unverified",
        ctx.fence,
        true,
      );
      const completed: SandboxV1 = absent
        ? {
            ...next,
            destroyed_at: observation.observed_at,
            terminal_disposition:
              grant.basis.kind === "discard_uncheckpointed"
                ? "discarded_uncheckpointed"
                : grant.basis.kind === "git_promotion"
                  ? "destroyed_after_promotion"
                  : "destroyed_after_checkpoint",
          }
        : next;
      tx.putSandbox(completed, current.revision);
      if (absent) {
        this.#commitOperation(tx, ctx.operation_id, canonicalDigest(completed));
        this.#event(tx, completed, ctx.operation_id, "operation_committed");
      } else {
        this.#unknownOperation(tx, ctx.operation_id);
        this.#event(tx, completed, ctx.operation_id, "operation_unknown");
      }
      return completed;
    });
  }

  get(resourceId: string): SandboxV1 {
    assertOpaqueId(resourceId, "resource_id", "sbx");
    return this.#repository.transaction((tx) => this.#mustSandbox(tx, resourceId));
  }

  list(): SandboxV1[] {
    return this.#repository.transaction((tx) => tx.listSandboxes());
  }

  events(resourceId: string): SandboxEventV1[] {
    assertOpaqueId(resourceId, "resource_id", "sbx");
    return this.#repository.transaction((tx) => tx.listEvents(resourceId));
  }

  resolveOperation(operationId: string): OperationResolutionV1 {
    assertOpaqueId(operationId, "operation_id", "op");
    const operation = this.#repository.transaction((tx) => tx.getOperation(operationId));
    if (operation === undefined) {
      return { schema_version: SCHEMA_VERSION, operation_id: operationId, state: "unknown" };
    }
    return {
      schema_version: SCHEMA_VERSION,
      operation_id: operation.operation_id,
      state: operation.state,
      ...(operation.result_sha256 === undefined ? {} : { result_sha256: operation.result_sha256 }),
      ...(operation.error_code === undefined ? {} : { error_code: operation.error_code }),
    };
  }

  async recordCheckpointReceipt(
    resourceId: string,
    receiptValue: CheckpointDurabilityReceiptV1,
  ): Promise<SandboxV1> {
    assertOpaqueId(resourceId, "resource_id", "sbx");
    const receipt = validateCheckpointReceipt(receiptValue);
    await this.#verifier.verifyCheckpointReceipt(receipt);
    return this.#repository.transaction((tx) => {
      const current = this.#mustSandbox(tx, resourceId);
      if (
        receipt.resource_id !== current.id ||
        receipt.run_id !== current.run_id ||
        receipt.attempt_id !== current.attempt_id ||
        receipt.fence.resource_lifecycle_generation !== current.resource_lifecycle_generation
      ) {
        throw new SandboxError("cleanup_receipt_mismatch", "Checkpoint receipt does not bind the current resource");
      }
      if (current.durable_checkpoint_receipt_sha256.includes(receipt.receipt_sha256)) return current;
      const updated: SandboxV1 = {
        ...current,
        revision: current.revision + 1,
        durable_checkpoint_receipt_sha256: [
          ...current.durable_checkpoint_receipt_sha256,
          receipt.receipt_sha256,
        ],
      };
      tx.putSandbox(updated, current.revision);
      return updated;
    });
  }

  async recordGitPromotionReceipt(resourceId: string, receipt: GitPromotionReceiptRefV1): Promise<SandboxV1> {
    assertOpaqueId(resourceId, "resource_id", "sbx");
    await this.#verifier.verifyGitPromotionReceipt(receipt);
    return this.#repository.transaction((tx) => {
      const current = this.#mustSandbox(tx, resourceId);
      if (current.git_promotion_receipt_sha256.includes(receipt.receipt_sha256)) return current;
      const updated: SandboxV1 = {
        ...current,
        revision: current.revision + 1,
        git_promotion_receipt_sha256: [...current.git_promotion_receipt_sha256, receipt.receipt_sha256],
      };
      tx.putSandbox(updated, current.revision);
      return updated;
    });
  }

  reconcileExpired(): ReconcileFindingV1[] {
    const now = this.#clock();
    const candidates = this.list().filter(
      (sandbox) =>
        Date.parse(sandbox.expires_at) <= now.getTime() &&
        ["creating_inert", "inert", "activating", "active", "expiring", "failed"].includes(sandbox.state),
    );
    return candidates.map((candidate) =>
      this.#repository.transaction((tx) => {
        const current = this.#mustSandbox(tx, candidate.id);
        if (!["creating_inert", "inert", "activating", "active", "expiring", "failed"].includes(current.state)) {
          throw new SandboxError("stale_revision", "Expiry reconciliation was superseded");
        }
        const quarantined: SandboxV1 = {
          ...current,
          revision: current.revision + 1,
          state: "quarantined",
          state_reason_code: "sandbox_expired",
          resource_lifecycle_generation: current.resource_lifecycle_generation + 1n,
        };
        tx.putSandbox(quarantined, current.revision);
        const finding: ReconcileFindingV1 = {
          schema_version: SCHEMA_VERSION,
          finding_id: createOpaqueId("finding"),
          resource_id: current.id,
          kind: "ttl_expired",
          disposition: "quarantined",
          observed_at: nowRfc3339(now),
          evidence_sha256: canonicalDigest({
            resource_id: current.id,
            expires_at: current.expires_at,
            observed_at: nowRfc3339(now),
          }),
        };
        return finding;
      }),
    );
  }

  async #authorize(
    operation: SandboxOperation,
    resourceId: string,
    expectedDigest: Digest,
    value: MutationContextV1,
  ): Promise<NormalizedMutationContext> {
    const fence = validateFence(value.fence);
    const capability = validateCapability(value.capability);
    assertOpaqueId(value.operation_id, "context.operation_id", "op");
    if (!Number.isSafeInteger(value.expected_revision) || value.expected_revision < 0) {
      throw new SandboxError("validation_failed", "Expected revision must be a non-negative safe integer");
    }
    if (
      value.operation_id !== fence.operation_id ||
      value.request_sha256 !== expectedDigest ||
      fence.operation_digest !== expectedDigest
    ) {
      throw new SandboxError("request_digest_mismatch", "Operation ID or request digest does not match the protected fence");
    }
    if (
      capability.operation !== operation ||
      capability.target_resource_id !== resourceId ||
      capability.request_sha256 !== expectedDigest ||
      canonicalDigest(capability.fence) !== canonicalDigest(fence)
    ) {
      throw new SandboxError("capability_denied", "Capability does not bind the exact operation and full fence");
    }
    this.#assertFenceFresh(fence);
    this.#assertWindow(capability.not_before, capability.expires_at, "capability_denied");
    await this.#verifier.verifyCapability(capability);
    return {
      operation_id: value.operation_id,
      idempotency_key_sha256: value.idempotency_key_sha256,
      request_sha256: expectedDigest,
      expected_revision: value.expected_revision,
      fence,
      capability,
    };
  }

  #assertFenceFresh(fence: CanonicalSandboxEffectFenceV1): void {
    const now = this.#clock().getTime();
    if (Date.parse(fence.issued_at) > now) {
      throw new SandboxError("capability_denied", "Fence is not active yet");
    }
    if (Date.parse(fence.lease_expires_at) <= now) {
      throw new SandboxError("lease_expired", "Attempt lease has expired");
    }
    if (Date.parse(fence.operation_execution_expires_at) <= now) {
      throw new SandboxError("lease_expired", "Operation execution lease has expired");
    }
  }

  #assertWindow(notBefore: string, expiresAt: string, code: "capability_denied"): void {
    const now = this.#clock().getTime();
    if (Date.parse(notBefore) > now || Date.parse(expiresAt) <= now) {
      throw new SandboxError(code, "Authorization window is not current");
    }
  }

  #assertGrantFresh(expiresAt: string): void {
    if (Date.parse(expiresAt) <= this.#clock().getTime()) {
      throw new SandboxError("capability_denied", "Grant has expired");
    }
  }

  #assertCurrentFence(current: SandboxV1, fence: CanonicalSandboxEffectFenceV1): void {
    if (fence.resource_id !== current.id || fence.run_id !== current.run_id || fence.attempt_id !== current.attempt_id) {
      throw new SandboxError("capability_denied", "Fence targets another resource or attempt");
    }
    if (fence.resource_lease_id !== current.resource_lease_id || fence.attempt_lease_id !== current.attempt_lease_id) {
      throw new SandboxError("capability_denied", "Fence lease identity mismatch");
    }
    if (fence.resource_lifecycle_generation !== current.resource_lifecycle_generation) {
      throw new SandboxError("stale_resource_lifecycle_generation", "Resource lifecycle generation is stale");
    }
    if (fence.authority_epoch < current.authority_epoch) {
      throw new SandboxError("authority_epoch_mismatch", "Authority epoch is stale");
    }
    if (fence.route_lineage_id !== current.route_lineage_id || fence.route_epoch < current.route_epoch) {
      throw new SandboxError("stale_lease_epoch", "Route lineage or epoch is stale");
    }
    if (fence.route_epoch === current.route_epoch && fence.route_id !== current.route_id) {
      throw new SandboxError("stale_lease_epoch", "Route ID conflicts at the current epoch");
    }
    if (fence.lease_epoch < current.lease_epoch) {
      throw new SandboxError("stale_lease_epoch", "Attempt lease epoch is stale");
    }
    if (fence.operation_execution_epoch < current.operation_execution_epoch) {
      throw new SandboxError("stale_operation_execution_epoch", "Operation execution epoch is stale");
    }
    if (
      fence.operation_execution_epoch === current.operation_execution_epoch &&
      fence.operation_executor_principal !== current.operation_executor_principal
    ) {
      throw new SandboxError("stale_operation_execution_epoch", "Executor principal conflicts at the current epoch");
    }
    if (fence.lease_holder_principal !== current.lease_holder_principal) {
      throw new SandboxError("capability_denied", "Lease holder principal mismatch");
    }
  }

  #assertExpectedRevision(current: SandboxV1, expected: number): void {
    if (current.revision !== expected) throw new SandboxError("stale_revision", "Sandbox revision is stale");
  }

  #assertCleanupBasis(current: SandboxV1, grant: InfinityCleanupGrantV1): void {
    switch (grant.basis.kind) {
      case "checkpoint_durable":
        if (!current.durable_checkpoint_receipt_sha256.includes(grant.basis.receipt_sha256)) {
          throw new SandboxError("checkpoint_not_durable", "Cleanup checkpoint basis is not attached and durable");
        }
        break;
      case "git_promotion":
        if (!current.git_promotion_receipt_sha256.includes(grant.basis.receipt_sha256)) {
          throw new SandboxError("cleanup_receipt_mismatch", "Cleanup promotion basis is not attached");
        }
        break;
      case "discard_uncheckpointed":
        if (
          current.durable_checkpoint_receipt_sha256.length !== 0 ||
          current.git_promotion_receipt_sha256.length !== 0 ||
          grant.basis.recovery_checkpoint_attempted !== true ||
          grant.basis.promotion_grants_revoked !== true ||
          grant.basis.permanent_outcome !== "discarded_uncheckpointed"
        ) {
          throw new SandboxError("cleanup_grant_mismatch", "Discard exception is no longer valid");
        }
        break;
    }
  }

  #reserve(
    tx: SandboxRepositoryTxV1,
    operation: SandboxOperation,
    resourceId: string,
    ctx: NormalizedMutationContext,
  ): ReservedOperation {
    const existingById = tx.getOperation(ctx.operation_id);
    if (existingById !== undefined) {
      if (
        existingById.operation !== operation ||
        existingById.resource_id !== resourceId ||
        existingById.actor_principal !== ctx.fence.actor_principal ||
        existingById.request_sha256 !== ctx.request_sha256 ||
        existingById.idempotency_key_sha256 !== ctx.idempotency_key_sha256
      ) {
        throw new SandboxError("idempotency_key_reused", "Operation ID was reused with different protected bytes");
      }
      return { operation: existingById, replay: existingById.state === "committed" };
    }
    const existingByKey = tx.findIdempotentOperation(
      ctx.fence.actor_principal,
      operation,
      resourceId,
      ctx.idempotency_key_sha256,
    );
    if (existingByKey !== undefined) {
      if (existingByKey.request_sha256 !== ctx.request_sha256) {
        throw new SandboxError("idempotency_key_reused", "Idempotency key was reused with a different request");
      }
      return { operation: existingByKey, replay: existingByKey.state === "committed" };
    }
    const now = this.#now();
    const capabilityUse = canonicalDigest({
      capability_id: ctx.capability.capability_id,
      nonce: ctx.capability.use_nonce_sha256,
    });
    const record: OperationRecordV1 = {
      schema_version: SCHEMA_VERSION,
      operation_id: ctx.operation_id,
      operation,
      resource_id: resourceId,
      actor_principal: ctx.fence.actor_principal,
      idempotency_key_sha256: ctx.idempotency_key_sha256,
      request_sha256: ctx.request_sha256,
      capability_use_sha256: capabilityUse,
      state: "in_flight",
      created_at: now,
      updated_at: now,
    };
    tx.insertOperation(record);
    tx.consumeCapabilityUse(capabilityUse, ctx.operation_id);
    return { operation: record, replay: false };
  }

  #resolveReplay(
    tx: SandboxRepositoryTxV1,
    ctx: NormalizedMutationContext,
    operation: SandboxOperation,
    resourceId: string,
  ): OperationRecordV1 | undefined {
    const record = tx.getOperation(ctx.operation_id);
    if (
      record !== undefined &&
      record.operation === operation &&
      record.resource_id === resourceId &&
      record.request_sha256 === ctx.request_sha256 &&
      record.idempotency_key_sha256 === ctx.idempotency_key_sha256
    ) {
      return record;
    }
    return undefined;
  }

  #commitOperation(tx: SandboxRepositoryTxV1, operationId: string, resultSha256: Digest): void {
    const operation = tx.getOperation(operationId);
    if (operation === undefined) throw new SandboxError("integrity_failed", "Operation intent disappeared");
    tx.updateOperation({
      ...operation,
      state: "committed",
      result_sha256: resultSha256,
      updated_at: this.#now(),
    });
  }

  #unknownOperation(tx: SandboxRepositoryTxV1, operationId: string): void {
    const operation = tx.getOperation(operationId);
    if (operation === undefined) throw new SandboxError("integrity_failed", "Operation intent disappeared");
    tx.updateOperation({
      ...operation,
      state: "unknown",
      error_code: "provider_state_unknown",
      updated_at: this.#now(),
    });
  }

  #markUnknown(
    resourceId: string,
    operationId: string,
    reason: SandboxStateReason,
  ): SandboxV1 {
    return this.#repository.transaction((tx) => {
      const current = this.#mustSandbox(tx, resourceId);
      const quarantined: SandboxV1 = {
        ...current,
        revision: current.revision + 1,
        state: "quarantined",
        state_reason_code: reason,
        resource_lifecycle_generation: current.resource_lifecycle_generation + 1n,
      };
      tx.putSandbox(quarantined, current.revision);
      this.#unknownOperation(tx, operationId);
      this.#event(tx, quarantined, operationId, "operation_unknown");
      return quarantined;
    });
  }

  #markFailed(resourceId: string, operationId: string): void {
    this.#repository.transaction((tx) => {
      const current = this.#mustSandbox(tx, resourceId);
      const failed: SandboxV1 = {
        ...current,
        revision: current.revision + 1,
        state: "failed",
        state_reason_code: "provider_operation_failed",
        resource_lifecycle_generation: current.resource_lifecycle_generation + 1n,
      };
      tx.putSandbox(failed, current.revision);
      const operation = tx.getOperation(operationId);
      if (operation !== undefined) {
        tx.updateOperation({
          ...operation,
          state: "aborted",
          error_code: "provider_unavailable",
          updated_at: this.#now(),
        });
      }
      this.#event(tx, failed, operationId, "state_changed");
    });
  }

  #quarantineCleanup(
    resourceId: string,
    operationId: string,
    reason: SandboxStateReason,
    state: "quarantined" | "cleanup_failed" = "quarantined",
  ): SandboxV1 {
    return this.#repository.transaction((tx) => {
      const current = this.#mustSandbox(tx, resourceId);
      const quarantined: SandboxV1 = {
        ...current,
        revision: current.revision + 1,
        state,
        state_reason_code: reason,
        resource_lifecycle_generation: current.resource_lifecycle_generation + 1n,
      };
      tx.putSandbox(quarantined, current.revision);
      this.#unknownOperation(tx, operationId);
      this.#event(tx, quarantined, operationId, "operation_unknown");
      return quarantined;
    });
  }

  #transition(
    current: SandboxV1,
    state: SandboxState,
    reason: SandboxStateReason,
    fence: CanonicalSandboxEffectFenceV1,
    advanceGeneration: boolean,
  ): SandboxV1 {
    return {
      ...current,
      revision: current.revision + 1,
      state,
      state_reason_code: reason,
      authority_epoch: fence.authority_epoch,
      route_id: fence.route_id,
      route_epoch: fence.route_epoch,
      lease_epoch: fence.lease_epoch,
      operation_execution_epoch: fence.operation_execution_epoch,
      actor_principal: fence.actor_principal,
      lease_holder_principal: fence.lease_holder_principal,
      operation_executor_principal: fence.operation_executor_principal,
      resource_lifecycle_generation: advanceGeneration
        ? current.resource_lifecycle_generation + 1n
        : current.resource_lifecycle_generation,
      ...(state === "activating" ? { activation_operation_id: fence.operation_id } : {}),
    };
  }

  #assertCreatedHandle(
    handle: OwnedProviderHandleV1,
    sandbox: SandboxV1,
    ctx: NormalizedMutationContext,
  ): void {
    if (
      handle.resource_id !== sandbox.id ||
      handle.resource_lease_id !== sandbox.resource_lease_id ||
      handle.resource_lifecycle_generation !== ctx.fence.resource_lifecycle_generation ||
      handle.create_inert_operation_id !== ctx.operation_id ||
      handle.spec_sha256 !== sandbox.spec_sha256
    ) {
      throw new SandboxError("integrity_failed", "Provider handle does not bind the reserved resource");
    }
  }

  #assertHandleGeneration(handle: OwnedProviderHandleV1, fence: CanonicalSandboxEffectFenceV1): void {
    if (
      handle.resource_id !== fence.resource_id ||
      handle.resource_lease_id !== fence.resource_lease_id ||
      handle.resource_lifecycle_generation !== fence.resource_lifecycle_generation
    ) {
      throw new SandboxError("stale_resource_lifecycle_generation", "Sealed provider handle generation is stale");
    }
  }

  #providerOperation(operation: SandboxOperation, ctx: NormalizedMutationContext): ProviderOperationV1 {
    return {
      operation,
      fence: ctx.fence,
      request_sha256: ctx.request_sha256,
      idempotency_key_sha256: ctx.idempotency_key_sha256,
      deadline: ctx.fence.operation_execution_expires_at,
    };
  }

  #adapterContext(ctx: NormalizedMutationContext): AdapterCallContextV1 {
    return {
      trace_id: sha256(`trace:${ctx.operation_id}`).slice(7, 39),
      deadline: ctx.fence.operation_execution_expires_at,
      constraints_sha256: canonicalDigest({
        resource_id: ctx.fence.resource_id,
        operation_id: ctx.fence.operation_id,
        audience: ctx.fence.audience,
      }),
    };
  }

  #mustSandbox(tx: SandboxRepositoryTxV1, resourceId: string): SandboxV1 {
    const sandbox = tx.getSandbox(resourceId);
    if (sandbox === undefined) throw new SandboxError("not_found", "Sandbox was not found");
    return sandbox;
  }

  #event(
    tx: SandboxRepositoryTxV1,
    sandbox: SandboxV1,
    operationId: string,
    eventType: SandboxEventV1["event_type"],
  ): void {
    const eventWithoutSequence: Omit<SandboxEventV1, "sequence"> = {
      schema_version: SCHEMA_VERSION,
      event_id: createOpaqueId("event"),
      resource_id: sandbox.id,
      operation_id: operationId,
      event_type: eventType,
      state: sandbox.state,
      revision: sandbox.revision,
      resource_lifecycle_generation: sandbox.resource_lifecycle_generation,
      recorded_at: this.#now(),
      payload_sha256: canonicalDigest({
        resource_id: sandbox.id,
        operation_id: operationId,
        state: sandbox.state,
        revision: sandbox.revision,
        generation: sandbox.resource_lifecycle_generation,
      }),
    };
    tx.appendEvent(eventWithoutSequence);
  }

  #now(): string {
    return nowRfc3339(this.#clock());
  }
}
