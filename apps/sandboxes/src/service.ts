import {
  assertDigest,
  assertOpaqueId,
  canonicalDigest,
  createOpaqueId,
  nowRfc3339,
  sha256,
  type Digest,
} from "./canonical.js";
import { SandboxError } from "./errors.js";
import type { ProviderHandleSealerV1 } from "./handle-sealer.js";
import type { SandboxRepositoryTxV1, SandboxRepositoryV1 } from "./repository.js";
import {
  ProviderRejectedNoEffectError,
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
  type DispatchedJournalAnchorV1,
  type GitPromotionReceiptRefV1,
  type InfinityCleanupGrantV1,
  type LifecycleTransitionBindingV1,
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
  validateDispatchedJournalAnchor,
  validateFence,
  validateLifecycleTransition,
} from "./validation.js";

export interface SandboxesAuthorityVerifierV1 {
  /** Returns identities taken from protected transport/PoP state, never request-body claims. */
  verifyCapability(claims: CapabilityClaimsV1): Promise<AuthenticatedEffectBindingsV1>;
  /** Performs the online current-fence check immediately before the provider call. */
  verifyDispatchedJournalAnchor(
    anchor: DispatchedJournalAnchorV1,
    fence: CanonicalSandboxEffectFenceV1,
  ): Promise<AuthenticatedEffectBindingsV1>;
  verifyActivationGrant(grant: ActivationGrantV1): Promise<void>;
  verifyCleanupGrant(grant: InfinityCleanupGrantV1): Promise<void>;
  verifyCheckpointReceipt(receipt: CheckpointDurabilityReceiptV1): Promise<void>;
  verifyGitPromotionReceipt(receipt: GitPromotionReceiptRefV1): Promise<void>;
}

export interface AuthenticatedEffectBindingsV1 {
  actor_principal: string;
  lease_holder_principal: string;
  operation_executor_principal: string;
  audience: typeof SCHEMA_VERSION;
}

export interface SandboxesServiceConfigV1 {
  repository: SandboxRepositoryV1;
  runner: SandboxRunnerV1;
  handle_sealer: ProviderHandleSealerV1;
  authority_verifier: SandboxesAuthorityVerifierV1;
  physical_safety_controller: PhysicalSafetyControllerV1;
  provider_outcome_journal: ProviderOutcomeJournalV1;
  allow_test_runner?: boolean;
}

export interface PhysicalSafetyControllerV1 {
  fenceResource(input: {
    resource_id: string;
    reason: "ttl_expired" | "provider_ambiguous" | "provider_identity_mismatch" | "provider_loss";
    observed_at: string;
  }): Promise<Digest>;
}

export interface ProviderOutcomeJournalV1 {
  appendOutcome(input: {
    operation_id: string;
    operation_step_id: string;
    dispatch_anchor_sha256: Digest;
    outcome: "succeeded" | "failed_no_effect" | "unknown";
    outcome_sha256: Digest;
    recorded_at: string;
  }): Promise<Digest>;
}

interface NormalizedMutationContext {
  operation_id: string;
  idempotency_key_sha256: Digest;
  request_sha256: Digest;
  expected_revision: number;
  transition: LifecycleTransitionBindingV1;
  dispatch_journal: DispatchedJournalAnchorV1;
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

export function quarantineRequestDigest(resourceId: string, expiresAt: string): Digest {
  return canonicalDigest({
    schema_version: SCHEMA_VERSION,
    operation: "quarantine",
    resource_id: resourceId,
    observed_expiry: expiresAt,
  });
}

export function dispatchedJournalAnchorDigest(anchor: DispatchedJournalAnchorV1): Digest {
  const { anchor_sha256: _ignored, ...protectedBytes } = anchor;
  return canonicalDigest(protectedBytes);
}

export class SandboxesReferenceServiceV1 {
  readonly #repository: SandboxRepositoryV1;
  readonly #runner: SandboxRunnerV1;
  readonly #sealer: ProviderHandleSealerV1;
  readonly #verifier: SandboxesAuthorityVerifierV1;
  readonly #physicalSafety: PhysicalSafetyControllerV1;
  readonly #outcomeJournal: ProviderOutcomeJournalV1;
  readonly #allowTestRunner: boolean;

  constructor(config: SandboxesServiceConfigV1) {
    this.#repository = config.repository;
    this.#runner = config.runner;
    this.#sealer = config.handle_sealer;
    this.#verifier = config.authority_verifier;
    this.#physicalSafety = config.physical_safety_controller;
    this.#outcomeJournal = config.provider_outcome_journal;
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
    if (
      ctx.expected_revision !== 0 ||
      ctx.transition.expected_resource_lifecycle_generation !== 1n ||
      ctx.fence.resource_lifecycle_generation !==
        ctx.transition.successor_resource_lifecycle_generation
    ) {
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
      physical_safety_state: "clear",
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
        if (replay !== undefined) {
          return { operation: replay, replay: false, reconcile: true };
        }
        throw new SandboxError("stale_revision", "Resource identity is already reserved");
      }
      const operation = this.#reserve(tx, "create_inert", input.resource_id, ctx);
      if (operation.replay) return { ...operation, reconcile: false };
      tx.putSandbox(initial, null);
      this.#event(tx, initial, ctx.operation_id, "operation_reserved");
      return { ...operation, reconcile: false };
    });
    if (reservation.replay) return this.get(input.resource_id);

    const op = this.#providerOperation("create_inert", ctx);
    let handle: OwnedProviderHandleV1;
    if (reservation.reconcile) {
      await this.#verifyDispatched(ctx);
      const observation = await this.#runner.lookupOperation(
        { installation_id: "installation_00000000000000000000000000000001", deadline: ctx.fence.operation_execution_expires_at },
        op,
      );
      if (observation.state === "completed" && observation.handle !== undefined) {
        handle = observation.handle;
      } else {
        return this.#markUnknown(
          initial.id,
          ctx.operation_id,
          "ambiguous_provider_state",
          ctx.transition.successor_resource_lifecycle_generation,
        );
      }
    } else {
      try {
        await this.#verifyDispatched(ctx);
        handle = await this.#runner.createInert(
          this.#adapterContext(ctx),
          input.spec,
          op,
          input.allocation_key_sha256,
        );
      } catch (error) {
        if (error instanceof ProviderRejectedNoEffectError) {
          await this.#markFailed(initial.id, ctx.operation_id, ctx.transition.successor_resource_lifecycle_generation);
          throw new SandboxError("provider_unavailable", "Provider rejected inert creation without an effect");
        }
        await this.#verifyDispatched(ctx);
        const observation = await this.#runner.lookupOperation(
          { installation_id: "installation_00000000000000000000000000000001", deadline: ctx.fence.operation_execution_expires_at },
          op,
        );
        if (observation.state === "completed" && observation.handle !== undefined) {
          handle = observation.handle;
        } else {
          return this.#markUnknown(
            initial.id,
            ctx.operation_id,
            "ambiguous_provider_state",
            ctx.transition.successor_resource_lifecycle_generation,
          );
        }
      }
    }

    this.#assertCreatedHandle(handle, initial, ctx);
    const createOutcomeAnchor = await this.#anchorOutcome(
      ctx.operation_id,
      "succeeded",
      canonicalDigest({
        resource_id: handle.resource_id,
        creation_receipt_sha256: handle.creation_receipt_sha256,
        immutable_fingerprint_sha256: handle.immutable_fingerprint_sha256,
      }),
    );
    return this.#repository.transaction((tx) => {
      const current = this.#mustSandbox(tx, initial.id);
      if (current.state !== "creating_inert") {
        throw new SandboxError("stale_revision", "Create receipt lost its reservation CAS");
      }
      const generation = ctx.transition.successor_resource_lifecycle_generation;
      const sealed = this.#sealer.seal({ ...handle, resource_lifecycle_generation: generation });
      const {
        physical_safety_reason: _physicalReason,
        safety_observation_id: _safetyObservation,
        safety_fence_receipt_sha256: _safetyReceipt,
        canonical_transition_required: _pendingCanonical,
        ...withoutSafetyObservation
      } = current;
      const committed: SandboxV1 = {
        ...withoutSafetyObservation,
        revision: current.revision + 1,
        state: "inert",
        state_reason_code: "inert_receipt_committed",
        physical_safety_state: "clear",
        resource_lifecycle_generation: generation,
        provider_handle_sha256: sealed.provider_handle_sha256,
        immutable_fingerprint_sha256: handle.immutable_fingerprint_sha256,
        allocated_at: this.#now(),
      };
      tx.putSandbox(committed, current.revision);
      tx.putHandle(sealed);
      this.#commitOperation(tx, ctx.operation_id, canonicalDigest(committed), createOutcomeAnchor);
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
      grant.resource_lifecycle_generation !==
        ctx.transition.expected_resource_lifecycle_generation ||
      grant.successor_resource_lifecycle_generation !== ctx.transition.successor_resource_lifecycle_generation ||
      grant.operation_id !== ctx.operation_id ||
      grant.operation_digest !== ctx.request_sha256
    ) {
      throw new SandboxError("capability_denied", "Activation grant does not bind the exact operation");
    }

    const reservation = this.#repository.transaction((tx) => {
      const current = this.#mustSandbox(tx, resourceId);
      const replay = this.#resolveReplay(tx, ctx, "activate", resourceId);
      if (replay !== undefined) {
        if (replay.state === "committed") return { operation: replay, replay: true, current };
        throw new SandboxError("provider_state_unknown", "The original activation is unresolved");
      }
      this.#assertCurrentFence(
        current,
        ctx.fence,
        ctx.transition.expected_resource_lifecycle_generation,
      );
      this.#assertExpectedRevision(current, ctx.expected_revision);
      if (current.state !== "inert") {
        throw new SandboxError("activation_receipt_required", "Only a durably inert sandbox can activate");
      }
      if (current.physical_safety_state !== "clear") {
        throw new SandboxError("policy_denied", "Sandbox is physically safety-fenced pending reconciliation");
      }
      if (grant.network_policy_sha256 !== current.spec.network_policy.policy_sha256) {
        throw new SandboxError("policy_denied", "Activation network policy digest mismatch");
      }
      const operation = this.#reserve(tx, "activate", resourceId, ctx);
      if (operation.replay) return { ...operation, current };
      tx.consumeActivationGrant(canonicalDigest({ id: grant.grant_id, nonce: grant.one_use_nonce_sha256 }), ctx.operation_id);
      const sealed = tx.getHandle(resourceId);
      if (sealed === undefined) throw new SandboxError("integrity_failed", "Inert handle receipt is missing");
      const predecessorHandle = this.#sealer.open(sealed);
      if (
        predecessorHandle.resource_lifecycle_generation !==
        ctx.transition.expected_resource_lifecycle_generation
      ) {
        throw new SandboxError("stale_resource_lifecycle_generation", "Predecessor handle generation is stale");
      }
      const successorHandle = this.#sealer.seal({
        ...predecessorHandle,
        resource_lifecycle_generation: ctx.transition.successor_resource_lifecycle_generation,
      });
      const activating: SandboxV1 = {
        ...this.#transition(
          current,
          "activating",
          "activation_dispatched",
          ctx.fence,
          ctx.transition.successor_resource_lifecycle_generation,
        ),
        provider_handle_sha256: successorHandle.provider_handle_sha256,
      };
      tx.putSandbox(activating, current.revision);
      tx.putHandle(successorHandle);
      this.#event(tx, activating, ctx.operation_id, "operation_reserved");
      return { ...operation, current: activating };
    });
    if (reservation.replay) return this.get(resourceId);
    const sealed = this.#repository.transaction((tx) => tx.getHandle(resourceId));
    if (sealed === undefined) throw new SandboxError("integrity_failed", "Inert handle receipt is missing");
    const handle = this.#sealer.open(sealed);
    this.#assertHandleGeneration(handle, ctx);
    let activationReceipt;
    try {
      await this.#verifyDispatched(ctx);
      activationReceipt = await this.#runner.activate(
        this.#adapterContext(ctx),
        handle,
        grant,
        this.#providerOperation("activate", ctx),
      );
    } catch (error) {
      return this.#markUnknown(
        resourceId,
        ctx.operation_id,
        "ambiguous_provider_state",
        ctx.transition.successor_resource_lifecycle_generation,
      );
    }
    const activationOutcomeAnchor = await this.#anchorOutcome(
      ctx.operation_id,
      "succeeded",
      activationReceipt.receipt_sha256,
    );
    return this.#repository.transaction((tx) => {
      const current = this.#mustSandbox(tx, resourceId);
      if (current.state !== "activating") throw new SandboxError("stale_revision", "Activation CAS was superseded");
      const active = this.#transition(
        current,
        "active",
        "activation_receipt_committed",
        ctx.fence,
      );
      tx.putSandbox(active, current.revision);
      this.#commitOperation(tx, ctx.operation_id, canonicalDigest(active), activationOutcomeAnchor);
      this.#event(tx, active, ctx.operation_id, "operation_committed");
      return active;
    });
  }

  async expire(resourceId: string, contextValue: MutationContextV1): Promise<SandboxV1> {
    assertOpaqueId(resourceId, "resource_id", "sbx");
    const ctx = await this.#authorize("expire", resourceId, expireRequestDigest(resourceId), contextValue);
    const reservation = this.#repository.transaction((tx) => {
      const current = this.#mustSandbox(tx, resourceId);
      const replay = this.#resolveReplay(tx, ctx, "expire", resourceId);
      if (replay !== undefined) {
        if (replay.state === "committed") return { operation: replay, replay: true, current };
        throw new SandboxError("provider_state_unknown", "The original expiry operation is unresolved");
      }
      this.#assertCurrentFence(
        current,
        ctx.fence,
        ctx.transition.expected_resource_lifecycle_generation,
      );
      this.#assertExpectedRevision(current, ctx.expected_revision);
      if (!["inert", "active", "failed", "quarantined"].includes(current.state)) {
        throw new SandboxError("policy_denied", "Sandbox cannot enter expiry from its current state");
      }
      const operation = this.#reserve(tx, "expire", resourceId, ctx);
      if (operation.replay) return { ...operation, current };
      const sealed = tx.getHandle(resourceId);
      if (sealed === undefined) throw new SandboxError("integrity_failed", "Provider handle is missing");
      const predecessorHandle = this.#sealer.open(sealed);
      if (
        predecessorHandle.resource_lifecycle_generation !==
        ctx.transition.expected_resource_lifecycle_generation
      ) {
        throw new SandboxError("stale_resource_lifecycle_generation", "Predecessor handle generation is stale");
      }
      const successorHandle = this.#sealer.seal({
        ...predecessorHandle,
        resource_lifecycle_generation: ctx.transition.successor_resource_lifecycle_generation,
      });
      const expiring: SandboxV1 = {
        ...this.#transition(
          current,
          "expiring",
          "sandbox_expired",
          ctx.fence,
          ctx.transition.successor_resource_lifecycle_generation,
        ),
        provider_handle_sha256: successorHandle.provider_handle_sha256,
      };
      tx.putSandbox(expiring, current.revision);
      tx.putHandle(successorHandle);
      this.#event(tx, expiring, ctx.operation_id, "operation_reserved");
      return { ...operation, current: expiring };
    });
    if (reservation.replay) return this.get(resourceId);
    const sealed = this.#repository.transaction((tx) => tx.getHandle(resourceId));
    if (sealed === undefined) throw new SandboxError("integrity_failed", "Provider handle is missing");
    const handle = this.#sealer.open(sealed);
    this.#assertHandleGeneration(handle, ctx);
    let expireReceipt;
    try {
      await this.#verifyDispatched(ctx);
      expireReceipt = await this.#runner.expire(
        this.#adapterContext(ctx),
        handle,
        this.#providerOperation("expire", ctx),
      );
    } catch {
      return this.#markUnknown(
        resourceId,
        ctx.operation_id,
        "ambiguous_provider_state",
        ctx.transition.successor_resource_lifecycle_generation,
      );
    }
    const expireOutcomeAnchor = await this.#anchorOutcome(
      ctx.operation_id,
      "succeeded",
      expireReceipt.receipt_sha256,
    );
    return this.#repository.transaction((tx) => {
      const current = this.#mustSandbox(tx, resourceId);
      if (current.state !== "expiring") {
        throw new SandboxError("stale_revision", "Expiry CAS was superseded");
      }
      this.#commitOperation(tx, ctx.operation_id, canonicalDigest(current), expireOutcomeAnchor);
      this.#event(tx, current, ctx.operation_id, "operation_committed");
      return current;
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
      const replay = this.#resolveReplay(tx, ctx, "destroy", resourceId);
      if (replay !== undefined) {
        if (replay.state === "committed") return { operation: replay, replay: true, current };
        throw new SandboxError("provider_state_unknown", "The original cleanup operation is unresolved");
      }
      this.#assertCurrentFence(
        current,
        ctx.fence,
        ctx.transition.expected_resource_lifecycle_generation,
      );
      this.#assertExpectedRevision(current, ctx.expected_revision);
      if (current.state === "destroyed") {
        throw new SandboxError("stale_revision", "Destroyed tombstones cannot be mutated");
      }
      if (current.provider_handle_sha256 === undefined) {
        throw new SandboxError("cleanup_grant_mismatch", "Cleanup target has no sealed provider handle");
      }
      if (
        grant.resource_id !== resourceId ||
        grant.resource_lifecycle_generation !==
          ctx.transition.expected_resource_lifecycle_generation ||
        grant.successor_resource_lifecycle_generation !== ctx.transition.successor_resource_lifecycle_generation ||
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
      const predecessorSealed = tx.getHandle(resourceId);
      if (predecessorSealed === undefined) {
        throw new SandboxError("cleanup_grant_mismatch", "Cleanup target handle disappeared");
      }
      const predecessorHandle = this.#sealer.open(predecessorSealed);
      if (
        predecessorHandle.resource_lifecycle_generation !==
        ctx.transition.expected_resource_lifecycle_generation
      ) {
        throw new SandboxError("stale_resource_lifecycle_generation", "Cleanup predecessor handle is stale");
      }
      const successorHandle = this.#sealer.seal({
        ...predecessorHandle,
        resource_lifecycle_generation: ctx.transition.successor_resource_lifecycle_generation,
      });
      const destroying: SandboxV1 = {
        ...this.#transition(
          current,
          "destroying",
          "cleanup_authorized",
          ctx.fence,
          ctx.transition.successor_resource_lifecycle_generation,
        ),
        provider_handle_sha256: successorHandle.provider_handle_sha256,
      };
      tx.putSandbox(destroying, current.revision);
      tx.putHandle(successorHandle);
      this.#event(tx, destroying, ctx.operation_id, "operation_reserved");
      return { ...operation, current: destroying };
    });
    if (reservation.replay) return this.get(resourceId);

    const sealed = this.#repository.transaction((tx) => tx.getHandle(resourceId));
    if (sealed === undefined) {
      return this.#quarantineCleanup(
        resourceId,
        ctx.operation_id,
        "provider_identity_mismatch",
        ctx.transition.successor_resource_lifecycle_generation,
      );
    }
    const handle = this.#sealer.open(sealed);
    this.#assertHandleGeneration(handle, ctx);
    const providerOp = this.#providerOperation("destroy", ctx);
    let observation;
    try {
      await this.#verifyDispatched(ctx);
      const inspected = await this.#runner.inspect(this.#adapterContext(ctx), handle, {
        ...providerOp,
        operation: "inspect",
      });
      if (
        inspected.state !== "absent" &&
        (inspected.immutable_fingerprint_sha256 !== handle.immutable_fingerprint_sha256 ||
          inspected.provider_resource_version !== handle.provider_resource_version)
      ) {
        return this.#quarantineCleanup(
          resourceId,
          ctx.operation_id,
          "provider_identity_mismatch",
          ctx.transition.successor_resource_lifecycle_generation,
        );
      }
      if (inspected.state === "absent") {
        return this.#quarantineCleanup(
          resourceId,
          ctx.operation_id,
          "ambiguous_provider_state",
          ctx.transition.successor_resource_lifecycle_generation,
        );
      } else if (inspected.state === "unknown") {
        return this.#quarantineCleanup(
          resourceId,
          ctx.operation_id,
          "ambiguous_provider_state",
          ctx.transition.successor_resource_lifecycle_generation,
        );
      } else {
        const destroyContext: DestroyContextV1 = {
          ...this.#adapterContext(ctx),
          cleanup_grant_sha256: canonicalDigest(grant),
        };
        await this.#verifyDispatched(ctx);
        observation = await this.#runner.destroy(destroyContext, handle, providerOp);
        if (observation.state === "absent") {
          await this.#verifyDispatched(ctx);
          const terminalReadback = await this.#runner.inspect(
            this.#adapterContext(ctx),
            handle,
            { ...providerOp, operation: "inspect" },
          );
          if (terminalReadback.state !== "absent") {
            return this.#quarantineCleanup(
              resourceId,
              ctx.operation_id,
              "ambiguous_provider_state",
              ctx.transition.successor_resource_lifecycle_generation,
            );
          }
        }
      }
    } catch {
      return this.#quarantineCleanup(
        resourceId,
        ctx.operation_id,
        "ambiguous_provider_state",
        ctx.transition.successor_resource_lifecycle_generation,
        "cleanup_failed",
      );
    }

    const destroyOutcomeAnchor = await this.#anchorOutcome(
      ctx.operation_id,
      observation.state === "absent" ? "succeeded" : "unknown",
      observation.provider_receipt_sha256,
    );
    return this.#repository.transaction((tx) => {
      const current = this.#mustSandbox(tx, resourceId);
      const absent = observation.state === "absent";
      const next = this.#transition(
        current,
        absent ? "destroyed" : "cleanup_failed",
        absent ? "cleanup_terminal_absence" : "cleanup_unverified",
        ctx.fence,
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
        this.#commitOperation(tx, ctx.operation_id, canonicalDigest(completed), destroyOutcomeAnchor);
        this.#event(tx, completed, ctx.operation_id, "operation_committed");
      } else {
        this.#unknownOperation(tx, ctx.operation_id, destroyOutcomeAnchor);
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

  expiredCandidates(): SandboxV1[] {
    const now = this.#repository.databaseTime().getTime();
    return this.list().filter(
      (sandbox) =>
        Date.parse(sandbox.expires_at) <= now &&
        ["creating_inert", "inert", "activating", "active", "expiring", "failed"].includes(sandbox.state),
    );
  }

  async observeExpired(resourceId: string): Promise<ReconcileFindingV1> {
    assertOpaqueId(resourceId, "resource_id", "sbx");
    const now = this.#repository.databaseTime();
    const safetyReceipt = await this.#physicalSafety.fenceResource({
      resource_id: resourceId,
      reason: "ttl_expired",
      observed_at: nowRfc3339(now),
    });
    return this.#repository.transaction((tx) => {
      const current = this.#mustSandbox(tx, resourceId);
      if (Date.parse(current.expires_at) > now.getTime()) {
        throw new SandboxError("policy_denied", "Sandbox TTL has not expired");
      }
      const observationId = current.safety_observation_id ?? createOpaqueId("observation");
      const fenced: SandboxV1 = current.physical_safety_state === "fenced"
        ? current
        : {
            ...current,
            revision: current.revision + 1,
            physical_safety_state: "fenced",
            physical_safety_reason: "ttl_expired",
            safety_observation_id: observationId,
            safety_fence_receipt_sha256: safetyReceipt,
            canonical_transition_required: "quarantined",
          };
      if (fenced !== current) tx.putSandbox(fenced, current.revision);
      return {
        schema_version: SCHEMA_VERSION,
        finding_id: createOpaqueId("finding"),
        resource_id: current.id,
        kind: "ttl_expired",
        disposition: "operator_review",
        observed_at: nowRfc3339(now),
        evidence_sha256: canonicalDigest({
          resource_id: current.id,
          safety_observation_id: observationId,
          state: current.state,
          resource_lifecycle_generation: current.resource_lifecycle_generation,
          observed_at: nowRfc3339(now),
        }),
      };
    });
  }

  async reconcileExpired(
    resourceId: string,
    contextValue: MutationContextV1,
  ): Promise<ReconcileFindingV1> {
    assertOpaqueId(resourceId, "resource_id", "sbx");
    const snapshot = this.get(resourceId);
    const ctx = await this.#authorize(
      "quarantine",
      resourceId,
      quarantineRequestDigest(resourceId, snapshot.expires_at),
      contextValue,
    );
    if (Date.parse(snapshot.expires_at) > this.#repository.databaseTime().getTime()) {
      throw new SandboxError("policy_denied", "Sandbox TTL has not expired");
    }
    if (
      snapshot.physical_safety_state !== "fenced" ||
      snapshot.physical_safety_reason !== "ttl_expired" ||
      snapshot.canonical_transition_required !== "quarantined"
    ) {
      throw new SandboxError(
        "policy_denied",
        "Infinity quarantine transition requires a prior physical TTL safety observation",
      );
    }
    const now = this.#repository.databaseTime();
    return this.#repository.transaction((tx) => {
      const current = this.#mustSandbox(tx, resourceId);
      const replay = this.#resolveReplay(tx, ctx, "quarantine", resourceId);
      if (replay !== undefined) {
        if (replay.state !== "committed") {
          throw new SandboxError("provider_state_unknown", "The original quarantine operation is unresolved");
        }
        return {
          schema_version: SCHEMA_VERSION,
          finding_id: createOpaqueId("finding"),
          resource_id: current.id,
          kind: "ttl_expired",
          disposition: "quarantined",
          observed_at: nowRfc3339(now),
          evidence_sha256: replay.result_sha256 ?? canonicalDigest(current),
        };
      }
      this.#assertCurrentFence(
        current,
        ctx.fence,
        ctx.transition.expected_resource_lifecycle_generation,
      );
      this.#assertExpectedRevision(current, ctx.expected_revision);
      if (!["creating_inert", "inert", "activating", "active", "expiring", "failed"].includes(current.state)) {
        throw new SandboxError("stale_revision", "Expiry reconciliation was superseded");
      }
      this.#reserve(tx, "quarantine", resourceId, ctx);
      const transitioned = this.#transition(
        current,
        "quarantined",
        "sandbox_expired",
        ctx.fence,
        ctx.transition.successor_resource_lifecycle_generation,
      );
      const nextHandleDigest = this.#advanceStoredHandle(
        tx,
        current.id,
        transitioned.resource_lifecycle_generation,
      );
      const { canonical_transition_required: _cleared, ...withoutPendingTransition } = transitioned;
      const quarantined: SandboxV1 = nextHandleDigest === undefined
        ? withoutPendingTransition
        : { ...withoutPendingTransition, provider_handle_sha256: nextHandleDigest };
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
          successor_resource_lifecycle_generation: ctx.transition.successor_resource_lifecycle_generation,
        }),
      };
      this.#commitOperation(tx, ctx.operation_id, finding.evidence_sha256);
      this.#event(tx, quarantined, ctx.operation_id, "operation_committed");
      return finding;
    });
  }

  async #authorize(
    operation: SandboxOperation,
    resourceId: string,
    expectedDigest: Digest,
    value: MutationContextV1,
  ): Promise<NormalizedMutationContext> {
    const fence = validateFence(value.fence);
    const capability = validateCapability(value.capability);
    const transition = validateLifecycleTransition(value.transition);
    const dispatchJournal = validateDispatchedJournalAnchor(value.dispatch_journal);
    assertOpaqueId(value.operation_id, "context.operation_id", "op");
    assertDigest(value.idempotency_key_sha256, "context.idempotency_key_sha256");
    assertDigest(value.request_sha256, "context.request_sha256");
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
      transition.successor_resource_lifecycle_generation !== fence.resource_lifecycle_generation ||
      dispatchJournal.operation_id !== fence.operation_id ||
      dispatchJournal.operation_digest !== fence.operation_digest ||
      dispatchJournal.resource_id !== fence.resource_id ||
      dispatchJournal.authority_epoch !== fence.authority_epoch ||
      dispatchJournal.expected_resource_lifecycle_generation !==
        transition.expected_resource_lifecycle_generation ||
      dispatchJournal.successor_resource_lifecycle_generation !== transition.successor_resource_lifecycle_generation ||
      canonicalDigest(dispatchJournal.fence) !== canonicalDigest(fence) ||
      dispatchJournal.authorization_consumption_receipt_sha256 !==
        this.#capabilityUseDigest(capability) ||
      dispatchedJournalAnchorDigest(dispatchJournal) !== dispatchJournal.anchor_sha256
    ) {
      throw new SandboxError("integrity_failed", "DISPATCHED journal anchor does not bind the exact transition and fence");
    }
    if (
      capability.operation !== operation ||
      capability.target_resource_id !== resourceId ||
      capability.request_sha256 !== expectedDigest ||
      canonicalDigest(capability.fence) !== canonicalDigest(fence) ||
      capability.dispatch_journal_anchor_sha256 !== dispatchJournal.anchor_sha256
    ) {
      throw new SandboxError("capability_denied", "Capability does not bind the exact operation and full fence");
    }
    this.#assertFenceFresh(fence);
    this.#assertWindow(capability.not_before, capability.expires_at, "capability_denied");
    const authenticated = await this.#verifier.verifyCapability(capability);
    this.#assertAuthenticatedBindings(authenticated, fence);
    return {
      operation_id: value.operation_id,
      idempotency_key_sha256: value.idempotency_key_sha256,
      request_sha256: expectedDigest,
      expected_revision: value.expected_revision,
      transition,
      dispatch_journal: dispatchJournal,
      fence,
      capability,
    };
  }

  async #verifyDispatched(ctx: NormalizedMutationContext): Promise<void> {
    if (Date.parse(ctx.dispatch_journal.expires_at) <= this.#repository.databaseTime().getTime()) {
      throw new SandboxError("lease_expired", "DISPATCHED journal anchor has expired");
    }
    if (ctx.dispatch_journal.state !== "dispatched") {
      throw new SandboxError("capability_denied", "Provider effect lacks a DISPATCHED journal anchor");
    }
    const operation = this.#repository.transaction((tx) => tx.getOperation(ctx.operation_id));
    if (
      operation === undefined ||
      !["intent_committed", "dispatched", "unknown"].includes(operation.effect_phase)
    ) {
      throw new SandboxError("integrity_failed", "Provider effect has no durable operation intent");
    }
    if (Date.parse(ctx.dispatch_journal.recorded_at) < Date.parse(operation.created_at)) {
      throw new SandboxError("integrity_failed", "External DISPATCHED anchor predates the durable intent");
    }
    const authenticated = await this.#verifier.verifyDispatchedJournalAnchor(
      ctx.dispatch_journal,
      ctx.fence,
    );
    this.#assertAuthenticatedBindings(authenticated, ctx.fence);
    if (
      dispatchedJournalAnchorDigest(ctx.dispatch_journal) !== ctx.dispatch_journal.anchor_sha256 ||
      ctx.capability.dispatch_journal_anchor_sha256 !== ctx.dispatch_journal.anchor_sha256 ||
      ctx.dispatch_journal.operation_id !== ctx.fence.operation_id ||
      ctx.dispatch_journal.operation_digest !== ctx.fence.operation_digest ||
      canonicalDigest(ctx.dispatch_journal.fence) !== canonicalDigest(ctx.fence)
    ) {
      throw new SandboxError("integrity_failed", "DISPATCHED journal anchor changed before provider dispatch");
    }
    this.#repository.transaction((tx) => {
      const current = tx.getOperation(ctx.operation_id);
      if (current === undefined) throw new SandboxError("integrity_failed", "Operation intent disappeared");
      if (current.effect_phase === "intent_committed") {
        tx.updateOperation({ ...current, effect_phase: "dispatched", updated_at: this.#now() });
      }
    });
  }

  #assertAuthenticatedBindings(
    authenticated: AuthenticatedEffectBindingsV1,
    fence: CanonicalSandboxEffectFenceV1,
  ): void {
    if (
      authenticated.actor_principal !== fence.actor_principal ||
      authenticated.lease_holder_principal !== fence.lease_holder_principal ||
      authenticated.operation_executor_principal !== fence.operation_executor_principal ||
      authenticated.audience !== fence.audience
    ) {
      throw new SandboxError(
        "capability_denied",
        "Authenticated transport principals or audience do not match the protected fence",
      );
    }
  }

  #assertFenceFresh(fence: CanonicalSandboxEffectFenceV1): void {
    const now = this.#repository.databaseTime().getTime();
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
    const now = this.#repository.databaseTime().getTime();
    if (Date.parse(notBefore) > now || Date.parse(expiresAt) <= now) {
      throw new SandboxError(code, "Authorization window is not current");
    }
  }

  #assertGrantFresh(expiresAt: string): void {
    if (Date.parse(expiresAt) <= this.#repository.databaseTime().getTime()) {
      throw new SandboxError("capability_denied", "Grant has expired");
    }
  }

  #assertCurrentFence(
    current: SandboxV1,
    fence: CanonicalSandboxEffectFenceV1,
    expectedResourceLifecycleGeneration: bigint,
  ): void {
    if (fence.resource_id !== current.id || fence.run_id !== current.run_id || fence.attempt_id !== current.attempt_id) {
      throw new SandboxError("capability_denied", "Fence targets another resource or attempt");
    }
    if (fence.resource_lease_id !== current.resource_lease_id || fence.attempt_lease_id !== current.attempt_lease_id) {
      throw new SandboxError("capability_denied", "Fence lease identity mismatch");
    }
    if (current.resource_lifecycle_generation !== expectedResourceLifecycleGeneration) {
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
        existingById.idempotency_key_sha256 !== ctx.idempotency_key_sha256 ||
        existingById.expected_revision !== ctx.expected_revision ||
        existingById.dispatch_journal_anchor_sha256 !== ctx.dispatch_journal.anchor_sha256 ||
        existingById.expected_resource_lifecycle_generation !==
          ctx.transition.expected_resource_lifecycle_generation ||
        existingById.successor_resource_lifecycle_generation !==
          ctx.transition.successor_resource_lifecycle_generation ||
        canonicalDigest(existingById.fence) !== canonicalDigest(ctx.fence)
      ) {
        throw new SandboxError("idempotency_key_reused", "Operation ID was reused with different protected bytes");
      }
      if (existingById.state !== "committed") {
        throw new SandboxError("provider_state_unknown", "The original operation is not durably resolved");
      }
      return { operation: existingById, replay: true };
    }
    const existingByKey = tx.findIdempotentOperation(
      ctx.fence.actor_principal,
      operation,
      resourceId,
      ctx.idempotency_key_sha256,
    );
    if (existingByKey !== undefined) {
      if (
        existingByKey.request_sha256 !== ctx.request_sha256 ||
        existingByKey.expected_revision !== ctx.expected_revision ||
        existingByKey.dispatch_journal_anchor_sha256 !== ctx.dispatch_journal.anchor_sha256 ||
        existingByKey.expected_resource_lifecycle_generation !==
          ctx.transition.expected_resource_lifecycle_generation ||
        existingByKey.successor_resource_lifecycle_generation !==
          ctx.transition.successor_resource_lifecycle_generation ||
        canonicalDigest(existingByKey.fence) !== canonicalDigest(ctx.fence)
      ) {
        throw new SandboxError("idempotency_key_reused", "Idempotency key was reused with a different request");
      }
      if (existingByKey.state !== "committed") {
        throw new SandboxError("provider_state_unknown", "The original idempotent operation is not durably resolved");
      }
      return { operation: existingByKey, replay: true };
    }
    const now = this.#now();
    const capabilityUse = this.#capabilityUseDigest(ctx.capability);
    const record: OperationRecordV1 = {
      schema_version: SCHEMA_VERSION,
      operation_id: ctx.operation_id,
      operation_step_id: ctx.dispatch_journal.operation_step_id,
      operation,
      resource_id: resourceId,
      actor_principal: ctx.fence.actor_principal,
      idempotency_key_sha256: ctx.idempotency_key_sha256,
      request_sha256: ctx.request_sha256,
      capability_use_sha256: capabilityUse,
      dispatch_journal_anchor_sha256: ctx.dispatch_journal.anchor_sha256,
      expected_resource_lifecycle_generation:
        ctx.transition.expected_resource_lifecycle_generation,
      successor_resource_lifecycle_generation: ctx.transition.successor_resource_lifecycle_generation,
      fence: ctx.fence,
      expected_revision: ctx.expected_revision,
      effect_phase: "intent_committed",
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
      record.idempotency_key_sha256 === ctx.idempotency_key_sha256 &&
      record.actor_principal === ctx.fence.actor_principal &&
      record.expected_revision === ctx.expected_revision &&
      record.dispatch_journal_anchor_sha256 === ctx.dispatch_journal.anchor_sha256 &&
      record.expected_resource_lifecycle_generation ===
        ctx.transition.expected_resource_lifecycle_generation &&
      record.successor_resource_lifecycle_generation ===
        ctx.transition.successor_resource_lifecycle_generation &&
      canonicalDigest(record.fence) === canonicalDigest(ctx.fence)
    ) {
      return record;
    }
    return undefined;
  }

  #commitOperation(
    tx: SandboxRepositoryTxV1,
    operationId: string,
    resultSha256: Digest,
    outcomeAnchorSha256?: Digest,
  ): void {
    const operation = tx.getOperation(operationId);
    if (operation === undefined) throw new SandboxError("integrity_failed", "Operation intent disappeared");
    tx.updateOperation({
      ...operation,
      state: "committed",
      effect_phase: "succeeded",
      result_sha256: resultSha256,
      ...(outcomeAnchorSha256 === undefined
        ? {}
        : { outcome_anchor_sha256: outcomeAnchorSha256 }),
      updated_at: this.#now(),
    });
  }

  #unknownOperation(
    tx: SandboxRepositoryTxV1,
    operationId: string,
    outcomeAnchorSha256?: Digest,
  ): void {
    const operation = tx.getOperation(operationId);
    if (operation === undefined) throw new SandboxError("integrity_failed", "Operation intent disappeared");
    tx.updateOperation({
      ...operation,
      state: "unknown",
      effect_phase: "unknown",
      error_code: "provider_state_unknown",
      ...(outcomeAnchorSha256 === undefined
        ? {}
        : { outcome_anchor_sha256: outcomeAnchorSha256 }),
      updated_at: this.#now(),
    });
  }

  async #markUnknown(
    resourceId: string,
    operationId: string,
    _reason: SandboxStateReason,
    _successorGeneration: bigint,
  ): Promise<SandboxV1> {
    const outcomeAnchor = await this.#anchorOutcome(
      operationId,
      "unknown",
      canonicalDigest({ reason: "provider_ambiguous", resource_id: resourceId }),
    );
    const observedAt = this.#now();
    const safetyReceipt = await this.#physicalSafety.fenceResource({
      resource_id: resourceId,
      reason: "provider_ambiguous",
      observed_at: observedAt,
    });
    return this.#repository.transaction((tx) => {
      const current = this.#mustSandbox(tx, resourceId);
      const fenced: SandboxV1 = {
        ...current,
        revision: current.revision + 1,
        physical_safety_state: "fenced",
        physical_safety_reason: "provider_ambiguous",
        safety_observation_id: createOpaqueId("observation"),
        safety_fence_receipt_sha256: safetyReceipt,
        canonical_transition_required: "quarantined",
      };
      tx.putSandbox(fenced, current.revision);
      this.#unknownOperation(tx, operationId, outcomeAnchor);
      this.#event(tx, fenced, operationId, "operation_unknown");
      return fenced;
    });
  }

  async #markFailed(resourceId: string, operationId: string, successorGeneration: bigint): Promise<void> {
    const outcomeAnchor = await this.#anchorOutcome(
      operationId,
      "failed_no_effect",
      canonicalDigest({ reason: "provider_rejected_no_effect", resource_id: resourceId }),
    );
    this.#repository.transaction((tx) => {
      const current = this.#mustSandbox(tx, resourceId);
      let failed: SandboxV1 = {
        ...current,
        revision: current.revision + 1,
        state: "failed",
        state_reason_code: "provider_operation_failed",
        resource_lifecycle_generation: successorGeneration,
      };
      const nextHandleDigest = this.#advanceStoredHandle(tx, resourceId, successorGeneration);
      if (nextHandleDigest !== undefined) {
        failed = { ...failed, provider_handle_sha256: nextHandleDigest };
      }
      tx.putSandbox(failed, current.revision);
      const operation = tx.getOperation(operationId);
      if (operation !== undefined) {
        tx.updateOperation({
          ...operation,
          state: "aborted",
          effect_phase: "failed_effect",
          error_code: "provider_unavailable",
          outcome_anchor_sha256: outcomeAnchor,
          updated_at: this.#now(),
        });
      }
      this.#event(tx, failed, operationId, "state_changed");
    });
  }

  async #quarantineCleanup(
    resourceId: string,
    operationId: string,
    reason: SandboxStateReason,
    _successorGeneration: bigint,
    _state: "quarantined" | "cleanup_failed" = "quarantined",
  ): Promise<SandboxV1> {
    const physicalReason = reason === "provider_identity_mismatch"
      ? "provider_identity_mismatch" as const
      : "provider_ambiguous" as const;
    const safetyReceipt = await this.#physicalSafety.fenceResource({
      resource_id: resourceId,
      reason: physicalReason,
      observed_at: this.#now(),
    });
    const outcomeAnchor = await this.#anchorOutcome(
      operationId,
      "unknown",
      canonicalDigest({ reason: physicalReason, resource_id: resourceId }),
    );
    return this.#repository.transaction((tx) => {
      const current = this.#mustSandbox(tx, resourceId);
      const fenced: SandboxV1 = {
        ...current,
        revision: current.revision + 1,
        physical_safety_state: "fenced",
        physical_safety_reason: physicalReason,
        safety_observation_id: createOpaqueId("observation"),
        safety_fence_receipt_sha256: safetyReceipt,
        canonical_transition_required: "quarantined",
      };
      tx.putSandbox(fenced, current.revision);
      this.#unknownOperation(tx, operationId, outcomeAnchor);
      this.#event(tx, fenced, operationId, "operation_unknown");
      return fenced;
    });
  }

  #transition(
    current: SandboxV1,
    state: SandboxState,
    reason: SandboxStateReason,
    fence: CanonicalSandboxEffectFenceV1,
    successorGeneration?: bigint,
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
      resource_lifecycle_generation: successorGeneration ?? current.resource_lifecycle_generation,
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
      handle.immutable_fingerprint_sha256 !==
        ctx.dispatch_journal.immutable_fingerprint_sha256 ||
      handle.spec_sha256 !== sandbox.spec_sha256
    ) {
      throw new SandboxError("integrity_failed", "Provider handle does not bind the reserved resource");
    }
  }

  #assertHandleGeneration(handle: OwnedProviderHandleV1, ctx: NormalizedMutationContext): void {
    if (
      handle.resource_id !== ctx.fence.resource_id ||
      handle.resource_lease_id !== ctx.fence.resource_lease_id ||
      handle.resource_lifecycle_generation !== ctx.fence.resource_lifecycle_generation ||
      handle.immutable_fingerprint_sha256 !==
        ctx.dispatch_journal.immutable_fingerprint_sha256
    ) {
      throw new SandboxError("stale_resource_lifecycle_generation", "Sealed provider handle generation is stale");
    }
  }

  #advanceStoredHandle(
    tx: SandboxRepositoryTxV1,
    resourceId: string,
    generation: bigint,
  ): Digest | undefined {
    const sealed = tx.getHandle(resourceId);
    if (sealed === undefined) return undefined;
    const handle = this.#sealer.open(sealed);
    const next = this.#sealer.seal({ ...handle, resource_lifecycle_generation: generation });
    tx.putHandle(next);
    return next.provider_handle_sha256;
  }

  #providerOperation(operation: SandboxOperation, ctx: NormalizedMutationContext): ProviderOperationV1 {
    return {
      operation,
      target: this.#effectTarget(ctx),
      fence: ctx.fence,
      generation_transition: ctx.transition,
      request_sha256: ctx.request_sha256,
      idempotency_key_sha256: ctx.idempotency_key_sha256,
      external_anchor_kind: "DISPATCHED",
      external_anchor_receipt_sha256: ctx.dispatch_journal.anchor_sha256,
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
      fence: ctx.fence,
      target: this.#effectTarget(ctx),
      external_anchor_receipt_sha256: ctx.dispatch_journal.anchor_sha256,
    };
  }

  #effectTarget(ctx: NormalizedMutationContext): import("./types.js").ProviderEffectTargetV1 {
    return {
      operation_id: ctx.operation_id,
      operation_digest: ctx.request_sha256,
      operation_step_id: ctx.dispatch_journal.operation_step_id,
      resource_id: ctx.fence.resource_id,
      resource_lifecycle_generation: ctx.fence.resource_lifecycle_generation,
      provider_idempotency_token_sha256:
        ctx.dispatch_journal.provider_idempotency_token_sha256,
      immutable_fingerprint_sha256: ctx.dispatch_journal.immutable_fingerprint_sha256,
      authorization_consumption_receipt_sha256:
        ctx.dispatch_journal.authorization_consumption_receipt_sha256,
    };
  }

  #capabilityUseDigest(capability: CapabilityClaimsV1): Digest {
    return canonicalDigest({
      capability_id: capability.capability_id,
      nonce: capability.use_nonce_sha256,
    });
  }

  async #anchorOutcome(
    operationId: string,
    outcome: "succeeded" | "failed_no_effect" | "unknown",
    outcomeSha256: Digest,
  ): Promise<Digest> {
    const operation = this.#repository.transaction((tx) => tx.getOperation(operationId));
    if (operation === undefined) {
      throw new SandboxError("integrity_failed", "Cannot anchor an outcome without a durable operation");
    }
    return this.#outcomeJournal.appendOutcome({
      operation_id: operationId,
      operation_step_id: operation.operation_step_id,
      dispatch_anchor_sha256: operation.dispatch_journal_anchor_sha256,
      outcome,
      outcome_sha256: outcomeSha256,
      recorded_at: this.#now(),
    });
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
    return nowRfc3339(this.#repository.databaseTime());
  }
}
