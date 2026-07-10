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
import {
  assertEffectJournalOutcomeSchema,
  EFFECT_JOURNAL_OUTCOME_SCHEMA_DIGEST,
  EFFECT_JOURNAL_OUTCOME_SCHEMA_VERSION,
} from "./effect-journal.js";
import type { ProviderHandleSealerV1 } from "./handle-sealer.js";
import type { SandboxRepositoryTxV1, SandboxRepositoryV1 } from "./repository.js";
import {
  ProviderRejectedNoEffectError,
  ProviderIdentityMismatchError,
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
  type LifecycleCommandContextV1,
  type LifecycleTransitionBindingV1,
  type MutationContextV1,
  type OperationRecordV1,
  type OperationResolutionV1,
  type OwnedProviderHandleV1,
  type ProviderOperationV1,
  type ProviderOutcomeAnchorV1,
  type ProviderMutationOperationV1,
  type ProviderEffectTargetV1,
  type ReadProbeJournalAnchorV1,
  type ReconcileFindingV1,
  type SandboxEventV1,
  type SandboxOperation,
  type SandboxState,
  type SandboxStateReason,
  type SandboxV1,
  type SafetyFenceObservationV1,
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
  verifyReadProbeJournalAnchor(
    anchor: ReadProbeJournalAnchorV1,
    fence: CanonicalSandboxEffectFenceV1,
  ): Promise<AuthenticatedEffectBindingsV1>;
  verifyProviderOutcomeAnchor(
    anchor: ProviderOutcomeAnchorV1,
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
  provider_dispatch_journal: ProviderDispatchJournalV1;
  provider_read_probe_journal: ProviderReadProbeJournalV1;
  allow_test_runner?: boolean;
}

export interface PhysicalSafetyControllerV1 {
  fenceResource(input: {
    resource_id: string;
    resource_lifecycle_generation: bigint;
    reason: SafetyFenceObservationV1["reason"];
    observed_at: string;
  }): Promise<SafetyFenceObservationV1>;
  assertProviderDispatchAllowed(input: {
    resource_id: string;
    operation: SandboxOperation;
    fence: CanonicalSandboxEffectFenceV1;
    dispatch_anchor_sha256: Digest;
  }): Promise<void>;
}

export interface ProviderOutcomeJournalV1 {
  appendOutcome(input: {
    operation_id: string;
    operation_step_id: string;
    operation_execution_epoch: bigint;
    dispatch_anchor_sha256: Digest;
    outcome_kind: ProviderOutcomeAnchorV1["outcome_kind"];
    outcome_sha256: Digest;
    recorded_at: string;
    fence: CanonicalSandboxEffectFenceV1;
    target: ProviderEffectTargetV1;
  }): Promise<ProviderOutcomeAnchorV1>;
}

export interface ProviderDispatchJournalV1 {
  /** Linearizable append-if-absent outside the repository restore domain. */
  appendDispatched(anchor: DispatchedJournalAnchorV1): Promise<DispatchedJournalAnchorV1>;
}

export interface ProviderReadProbeJournalV1 {
  appendReadProbe(input: {
    operation_id: string;
    operation_step_id: string;
    request_sha256: Digest;
    fence: CanonicalSandboxEffectFenceV1;
    target: ProviderEffectTargetV1;
    recorded_at: string;
  }): Promise<ReadProbeJournalAnchorV1>;
}

interface NormalizedLifecycleContext {
  operation_id: string;
  idempotency_key_sha256: Digest;
  request_sha256: Digest;
  expected_revision: number;
  transition: LifecycleTransitionBindingV1;
  fence: CanonicalSandboxEffectFenceV1;
  capability: CapabilityClaimsV1;
}

interface NormalizedMutationContext extends NormalizedLifecycleContext {
  dispatch_journal: DispatchedJournalAnchorV1;
}

function hasDispatchJournal(
  context: NormalizedLifecycleContext,
): context is NormalizedMutationContext {
  return "dispatch_journal" in context;
}

interface ReservedOperation {
  operation: OperationRecordV1;
  replay: boolean;
}

type RecordLifecycleOperation =
  | "record_inert"
  | "record_active"
  | "record_failed"
  | "record_lost"
  | "record_cleanup_failed"
  | "record_destroyed";

export function createRequestDigest(input: CreateSandboxV1): Digest {
  return canonicalDigest(validateCreateSandbox(input));
}

export function activationRequestDigest(resourceId: string, networkPolicySha256: Digest): Digest {
  return canonicalDigest({
    schema_version: SCHEMA_VERSION,
    operation: "begin_activate",
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
    operation: "begin_destroy",
    resource_id: resourceId,
    basis_receipt_sha256: basisReceiptSha256,
  });
}

export function lifecycleRecordRequestDigest(
  operation:
    | "record_inert"
    | "record_active"
    | "record_failed"
    | "record_lost"
    | "record_cleanup_failed"
    | "record_destroyed"
    | "quarantine",
  resourceId: string,
  evidenceSha256: Digest,
): Digest {
  assertOpaqueId(resourceId, "resource_id", "sbx");
  assertDigest(evidenceSha256, "evidence_sha256");
  return canonicalDigest({ schema_version: SCHEMA_VERSION, operation, resource_id: resourceId, evidence_sha256: evidenceSha256 });
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

export function readProbeJournalAnchorDigest(anchor: ReadProbeJournalAnchorV1): Digest {
  const { anchor_sha256: _ignored, ...protectedBytes } = anchor;
  return canonicalDigest(protectedBytes);
}

export function providerOutcomeAnchorDigest(anchor: ProviderOutcomeAnchorV1): Digest {
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
  readonly #dispatchJournal: ProviderDispatchJournalV1;
  readonly #readProbeJournal: ProviderReadProbeJournalV1;
  readonly #allowTestRunner: boolean;

  constructor(config: SandboxesServiceConfigV1) {
    this.#repository = config.repository;
    this.#runner = config.runner;
    this.#sealer = config.handle_sealer;
    this.#verifier = config.authority_verifier;
    this.#physicalSafety = config.physical_safety_controller;
    this.#outcomeJournal = config.provider_outcome_journal;
    this.#dispatchJournal = config.provider_dispatch_journal;
    this.#readProbeJournal = config.provider_read_probe_journal;
    this.#allowTestRunner = config.allow_test_runner === true;
    this.#repository.migrate();
  }

  async create(inputValue: CreateSandboxV1, contextValue: MutationContextV1): Promise<SandboxV1> {
    const input = validateCreateSandbox(inputValue);
    const expectedDigest = createRequestDigest(input);
    const ctx = await this.#authorizeProvider("begin_create_inert", input.resource_id, expectedDigest, contextValue);
    if (input.spec.run_id !== ctx.fence.run_id || input.spec.attempt_id !== ctx.fence.attempt_id) {
      throw new SandboxError("request_digest_mismatch", "Spec authority references do not match the fence");
    }
    if (
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
        const replay = this.#resolveReplay(tx, ctx, "begin_create_inert", input.resource_id);
        if (replay !== undefined && replay.state === "committed") return { operation: replay, replay: true };
        if (replay !== undefined) {
          return {
            operation: replay,
            replay: false,
            reconcile: replay.effect_phase !== "prepared",
          };
        }
        const retry = this.#retryFailedNoEffect(
          tx,
          "begin_create_inert",
          existing,
          ctx,
          "creating_inert",
        );
        if (retry !== undefined) {
          return { operation: retry, replay: false, reconcile: false };
        }
        throw new SandboxError("stale_revision", "Resource identity is already reserved");
      }
      if (ctx.expected_revision !== 0) {
        throw new SandboxError("stale_revision", "Initial inert create requires reserved revision zero");
      }
      const operation = this.#reserve(tx, "begin_create_inert", input.resource_id, ctx);
      if (operation.replay) return { ...operation, reconcile: false };
      tx.putSandbox(initial, null);
      this.#event(tx, initial, ctx.operation_id, "operation_reserved");
      return { ...operation, reconcile: false };
    });
    if (reservation.replay) return this.get(input.resource_id);

    const op = this.#providerOperation("create_inert", ctx);
    let handle: OwnedProviderHandleV1;
    if (reservation.reconcile) {
      const readProbe = await this.#readProbeOperation(ctx, op);
      const observation = await this.#runner.lookupOperation(
        { installation_id: "installation_00000000000000000000000000000001", deadline: ctx.fence.operation_execution_expires_at },
        readProbe,
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
      let providerReachable = false;
      try {
        await this.#verifyDispatched(ctx);
        providerReachable = true;
        handle = await this.#runner.createInert(
          this.#adapterContext(ctx),
          input.spec,
          op,
          input.allocation_key_sha256,
        );
      } catch (error) {
        if (!providerReachable) throw error;
        if (error instanceof ProviderRejectedNoEffectError) {
          await this.#markFailed(initial.id, ctx.operation_id, ctx.transition.successor_resource_lifecycle_generation);
          throw new SandboxError("provider_unavailable", "Provider rejected inert creation without an effect");
        }
        const readProbe = await this.#readProbeOperation(ctx, op);
        const observation = await this.#runner.lookupOperation(
          { installation_id: "installation_00000000000000000000000000000001", deadline: ctx.fence.operation_execution_expires_at },
          readProbe,
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

    try {
      this.#assertCreatedHandle(handle, initial, ctx);
    } catch {
      return this.#markUnknown(
        initial.id,
        ctx.operation_id,
        "provider_identity_mismatch",
        ctx.transition.successor_resource_lifecycle_generation,
      );
    }
    const providerReceiptSha256 = canonicalDigest({
      resource_id: handle.resource_id,
      provider_creation_token_sha256: handle.provider_creation_token_sha256,
      creation_receipt_sha256: handle.creation_receipt_sha256,
      immutable_fingerprint_sha256: handle.immutable_fingerprint_sha256,
    });
    const createOutcomeAnchor = await this.#anchorOutcome(
      ctx.operation_id,
      "succeeded",
      providerReceiptSha256,
    );
    return this.#repository.transaction((tx) => {
      const current = this.#mustSandbox(tx, initial.id);
      if (current.state !== "creating_inert") {
        throw new SandboxError("stale_revision", "Create receipt lost its reservation CAS");
      }
      const generation = ctx.transition.successor_resource_lifecycle_generation;
      const sealed = this.#sealer.seal({ ...handle, resource_lifecycle_generation: generation });
      const outcomePending: SandboxV1 = {
        ...current,
        revision: current.revision + 1,
        resource_lifecycle_generation: generation,
        provider_handle_sha256: sealed.provider_handle_sha256,
        immutable_fingerprint_sha256: handle.immutable_fingerprint_sha256,
        allocated_at: this.#now(),
        pending_provider_outcome: {
          source_operation_id: ctx.operation_id,
          target_state: "inert",
          evidence_sha256: createOutcomeAnchor,
          provider_receipt_sha256: providerReceiptSha256,
          observed_at: this.#now(),
        },
      };
      tx.putSandbox(outcomePending, current.revision);
      tx.putHandle(sealed);
      this.#commitOperation(tx, ctx.operation_id, canonicalDigest(outcomePending), createOutcomeAnchor);
      this.#event(tx, outcomePending, ctx.operation_id, "operation_committed");
      return outcomePending;
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
    const activationGrantUse = canonicalDigest({ id: grant.grant_id, nonce: grant.one_use_nonce_sha256 });
    const ctx = await this.#authorizeProvider(
      "begin_activate",
      resourceId,
      expectedDigest,
      contextValue,
      activationGrantUse,
    );
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
      const replay = this.#resolveReplay(tx, ctx, "begin_activate", resourceId);
      if (replay !== undefined) {
        if (replay.state === "committed") return { operation: replay, replay: true, current };
        if (replay.effect_phase === "prepared") {
          return { operation: replay, replay: false, current };
        }
        throw new SandboxError("provider_state_unknown", "The original activation is unresolved");
      }
      const retry = this.#retryFailedNoEffect(
        tx,
        "begin_activate",
        current,
        ctx,
        "activating",
      );
      if (retry !== undefined) {
        return {
          operation: retry,
          replay: false,
          current: this.#mustSandbox(tx, resourceId),
        };
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
      const operation = this.#reserve(tx, "begin_activate", resourceId, ctx);
      if (operation.replay) return { ...operation, current };
      tx.consumeActivationGrant(activationGrantUse, ctx.operation_id);
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
    let providerReachable = false;
    try {
      await this.#verifyDispatched(ctx);
      providerReachable = true;
      activationReceipt = await this.#runner.activate(
        this.#adapterContext(ctx),
        handle,
        grant,
        this.#providerOperation("activate", ctx),
      );
    } catch (error) {
      if (!providerReachable) throw error;
      if (error instanceof ProviderRejectedNoEffectError) {
        await this.#markFailed(resourceId, ctx.operation_id, ctx.transition.successor_resource_lifecycle_generation);
        throw new SandboxError("provider_unavailable", "Provider rejected activation without an effect");
      }
      return this.#markUnknown(
        resourceId,
        ctx.operation_id,
        "ambiguous_provider_state",
        ctx.transition.successor_resource_lifecycle_generation,
      );
    }
    if (
      activationReceipt.immutable_fingerprint_sha256 !== handle.immutable_fingerprint_sha256 ||
      activationReceipt.network_policy_sha256 !== grant.network_policy_sha256 ||
      activationReceipt.network_policy_sha256 !== reservation.current.spec.network_policy.policy_sha256
    ) {
      return this.#markUnknown(
        resourceId,
        ctx.operation_id,
        "provider_identity_mismatch",
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
      const outcomePending: SandboxV1 = {
        ...current,
        revision: current.revision + 1,
        pending_provider_outcome: {
          source_operation_id: ctx.operation_id,
          target_state: "active",
          evidence_sha256: activationOutcomeAnchor,
          provider_receipt_sha256: activationReceipt.receipt_sha256,
          observed_at: activationReceipt.activated_at,
        },
      };
      tx.putSandbox(outcomePending, current.revision);
      this.#commitOperation(tx, ctx.operation_id, canonicalDigest(outcomePending), activationOutcomeAnchor);
      this.#event(tx, outcomePending, ctx.operation_id, "operation_committed");
      return outcomePending;
    });
  }

  async expire(resourceId: string, contextValue: MutationContextV1): Promise<SandboxV1> {
    assertOpaqueId(resourceId, "resource_id", "sbx");
    const ctx = await this.#authorizeProvider("expire", resourceId, expireRequestDigest(resourceId), contextValue);
    const reservation = this.#repository.transaction((tx) => {
      const current = this.#mustSandbox(tx, resourceId);
      const replay = this.#resolveReplay(tx, ctx, "expire", resourceId);
      if (replay !== undefined) {
        if (replay.state === "committed") return { operation: replay, replay: true, current };
        if (replay.effect_phase === "prepared") {
          return { operation: replay, replay: false, current };
        }
        throw new SandboxError("provider_state_unknown", "The original expiry operation is unresolved");
      }
      const retry = this.#retryFailedNoEffect(tx, "expire", current, ctx, "expiring");
      if (retry !== undefined) {
        return {
          operation: retry,
          replay: false,
          current: this.#mustSandbox(tx, resourceId),
        };
      }
      this.#assertCurrentFence(
        current,
        ctx.fence,
        ctx.transition.expected_resource_lifecycle_generation,
      );
      this.#assertExpectedRevision(current, ctx.expected_revision);
      if (current.state !== "active") {
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
    let providerReachable = false;
    try {
      await this.#verifyDispatched(ctx);
      providerReachable = true;
      expireReceipt = await this.#runner.expire(
        this.#adapterContext(ctx),
        handle,
        this.#providerOperation("expire", ctx),
      );
    } catch (error) {
      if (!providerReachable) throw error;
      if (error instanceof ProviderRejectedNoEffectError) {
        await this.#markFailed(resourceId, ctx.operation_id, ctx.transition.successor_resource_lifecycle_generation);
        throw new SandboxError("provider_unavailable", "Provider rejected expiry without an effect");
      }
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
    const cleanupGrantUse = canonicalDigest({ id: grant.grant_id, nonce: grant.one_use_nonce_sha256 });
    const ctx = await this.#authorizeProvider(
      "begin_destroy",
      resourceId,
      destroyRequestDigest(resourceId, grant.basis.receipt_sha256),
      contextValue,
      cleanupGrantUse,
    );
    await this.#verifier.verifyCleanupGrant(grant);
    this.#assertGrantFresh(grant.expires_at);

    const reservation = this.#repository.transaction((tx) => {
      const current = this.#mustSandbox(tx, resourceId);
      const replay = this.#resolveReplay(tx, ctx, "begin_destroy", resourceId);
      if (replay !== undefined) {
        if (replay.state === "committed") return { operation: replay, replay: true, current };
        if (replay.effect_phase === "prepared") {
          return { operation: replay, replay: false, current };
        }
        throw new SandboxError("provider_state_unknown", "The original cleanup operation is unresolved");
      }
      const retry = this.#retryFailedNoEffect(
        tx,
        "begin_destroy",
        current,
        ctx,
        "destroying",
      );
      if (retry !== undefined) {
        return {
          operation: retry,
          replay: false,
          current: this.#mustSandbox(tx, resourceId),
        };
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
      if (!["active", "expiring", "failed", "quarantined"].includes(current.state)) {
        throw new SandboxError("policy_denied", "Cleanup cannot begin from the current lifecycle state");
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
      const operation = this.#reserve(tx, "begin_destroy", resourceId, ctx);
      if (operation.replay) return { ...operation, current };
      tx.consumeCleanupGrant(cleanupGrantUse, ctx.operation_id);
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
    let providerReachable = false;
    try {
      const destroyContext: DestroyContextV1 = {
        ...this.#adapterContext(ctx),
        cleanup_grant_sha256: canonicalDigest(grant),
      };
      await this.#verifyDispatched(ctx);
      providerReachable = true;
      observation = await this.#runner.destroy(destroyContext, handle, providerOp);
    } catch (error) {
      if (!providerReachable) throw error;
      if (error instanceof ProviderRejectedNoEffectError) {
        await this.#markFailed(resourceId, ctx.operation_id, ctx.transition.successor_resource_lifecycle_generation);
        throw new SandboxError("provider_unavailable", "Provider rejected cleanup without an effect");
      }
      return this.#quarantineCleanup(
        resourceId,
        ctx.operation_id,
        error instanceof ProviderIdentityMismatchError
          ? "provider_identity_mismatch"
          : "ambiguous_provider_state",
        ctx.transition.successor_resource_lifecycle_generation,
        "cleanup_failed",
      );
    }

    if (observation.state === "unknown") {
      return this.#quarantineCleanup(
        resourceId,
        ctx.operation_id,
        "ambiguous_provider_state",
        ctx.transition.successor_resource_lifecycle_generation,
      );
    }

    const destroyOutcomeAnchor = await this.#anchorOutcome(
      ctx.operation_id,
      observation.state === "absent" ? "succeeded" : "failed_effect",
      observation.provider_receipt_sha256,
    );
    return this.#repository.transaction((tx) => {
      const current = this.#mustSandbox(tx, resourceId);
      const absent = observation.state === "absent";
      const outcomePending: SandboxV1 = {
        ...current,
        revision: current.revision + 1,
        pending_provider_outcome: {
          source_operation_id: ctx.operation_id,
          target_state: absent ? "destroyed" : "cleanup_failed",
          evidence_sha256: destroyOutcomeAnchor,
          provider_receipt_sha256: observation.provider_receipt_sha256,
          observed_at: observation.observed_at,
          ...(absent
            ? {
                terminal_disposition:
                  grant.basis.kind === "discard_uncheckpointed"
                    ? "discarded_uncheckpointed" as const
                    : grant.basis.kind === "git_promotion"
                      ? "destroyed_after_promotion" as const
                      : "destroyed_after_checkpoint" as const,
              }
            : {}),
        },
      };
      tx.putSandbox(outcomePending, current.revision);
      this.#commitOperation(tx, ctx.operation_id, canonicalDigest(outcomePending), destroyOutcomeAnchor);
      this.#event(tx, outcomePending, ctx.operation_id, "operation_committed");
      return outcomePending;
    });
  }

  async recordInert(
    resourceId: string,
    evidenceSha256: Digest,
    contextValue: LifecycleCommandContextV1,
  ): Promise<SandboxV1> {
    return this.#recordCanonicalOutcome(
      "record_inert",
      resourceId,
      evidenceSha256,
      contextValue,
      ["creating_inert"],
      "inert",
      "inert_receipt_committed",
      true,
    );
  }

  async recordActive(
    resourceId: string,
    evidenceSha256: Digest,
    contextValue: LifecycleCommandContextV1,
  ): Promise<SandboxV1> {
    return this.#recordCanonicalOutcome(
      "record_active",
      resourceId,
      evidenceSha256,
      contextValue,
      ["activating"],
      "active",
      "activation_receipt_committed",
      true,
    );
  }

  async recordFailed(
    resourceId: string,
    evidenceSha256: Digest,
    contextValue: LifecycleCommandContextV1,
  ): Promise<SandboxV1> {
    return this.#recordCanonicalOutcome(
      "record_failed",
      resourceId,
      evidenceSha256,
      contextValue,
      ["creating_inert", "inert", "activating", "active", "expiring"],
      "failed",
      "provider_operation_failed",
      false,
    );
  }

  async recordLost(
    resourceId: string,
    evidenceSha256: Digest,
    contextValue: LifecycleCommandContextV1,
  ): Promise<SandboxV1> {
    return this.#recordCanonicalOutcome(
      "record_lost",
      resourceId,
      evidenceSha256,
      contextValue,
      ["creating_inert", "inert", "activating", "active", "expiring"],
      "lost",
      "ambiguous_provider_state",
      false,
    );
  }

  async recordCleanupFailed(
    resourceId: string,
    evidenceSha256: Digest,
    contextValue: LifecycleCommandContextV1,
  ): Promise<SandboxV1> {
    return this.#recordCanonicalOutcome(
      "record_cleanup_failed",
      resourceId,
      evidenceSha256,
      contextValue,
      ["destroying"],
      "cleanup_failed",
      "cleanup_unverified",
      true,
    );
  }

  async recordDestroyed(
    resourceId: string,
    evidenceSha256: Digest,
    contextValue: LifecycleCommandContextV1,
  ): Promise<SandboxV1> {
    return this.#recordCanonicalOutcome(
      "record_destroyed",
      resourceId,
      evidenceSha256,
      contextValue,
      ["destroying"],
      "destroyed",
      "cleanup_terminal_absence",
      true,
    );
  }

  async quarantine(
    resourceId: string,
    evidenceSha256: Digest,
    contextValue: LifecycleCommandContextV1,
  ): Promise<SandboxV1> {
    return this.#recordCanonicalOutcome(
      "quarantine",
      resourceId,
      evidenceSha256,
      contextValue,
      ["creating_inert", "inert", "activating", "active", "expiring"],
      "quarantined",
      "ambiguous_provider_state",
      false,
    );
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
      this.#assertReceiptFenceBinding(current, receipt.fence);
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
    assertOpaqueId(receipt.receipt_id, "promotion_receipt.receipt_id", "receipt");
    assertOpaqueId(receipt.resource_id, "promotion_receipt.resource_id", "sbx");
    assertOpaqueId(receipt.run_id, "promotion_receipt.run_id", "run");
    assertOpaqueId(receipt.attempt_id, "promotion_receipt.attempt_id", "attempt");
    assertDigest(receipt.receipt_sha256, "promotion_receipt.receipt_sha256");
    assertDigest(receipt.checkpoint_root_sha256, "promotion_receipt.checkpoint_root_sha256");
    assertDigest(receipt.expected_base_sha256, "promotion_receipt.expected_base_sha256");
    const promotionFence = validateFence(receipt.fence);
    await this.#verifier.verifyGitPromotionReceipt(receipt);
    return this.#repository.transaction((tx) => {
      const current = this.#mustSandbox(tx, resourceId);
      if (
        receipt.schema_version !== SCHEMA_VERSION ||
        receipt.resource_id !== current.id ||
        receipt.run_id !== current.run_id ||
        receipt.attempt_id !== current.attempt_id ||
        receipt.resource_lifecycle_generation !== current.resource_lifecycle_generation
      ) {
        throw new SandboxError("cleanup_receipt_mismatch", "Promotion receipt does not bind the current resource");
      }
      this.#assertReceiptFenceBinding(current, promotionFence);
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
    const snapshot = this.#repository.transaction((tx) => this.#mustSandbox(tx, resourceId));
    if (Date.parse(snapshot.expires_at) > now.getTime()) {
      throw new SandboxError("policy_denied", "Sandbox TTL has not expired");
    }
    const safetyObservation = await this.#physicalSafety.fenceResource({
      resource_id: resourceId,
      resource_lifecycle_generation: snapshot.resource_lifecycle_generation,
      reason: "deadline",
      observed_at: nowRfc3339(now),
    });
    this.#assertSafetyObservation(
      safetyObservation,
      resourceId,
      snapshot.resource_lifecycle_generation,
      "deadline",
      nowRfc3339(now),
    );
    const safetyReceipt = canonicalDigest(safetyObservation);
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
    contextValue: LifecycleCommandContextV1,
  ): Promise<ReconcileFindingV1> {
    assertOpaqueId(resourceId, "resource_id", "sbx");
    const snapshot = this.get(resourceId);
    const ctx = await this.#authorizeLifecycle(
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

  async #recordCanonicalOutcome(
    operation: RecordLifecycleOperation | "quarantine",
    resourceId: string,
    evidenceSha256: Digest,
    contextValue: LifecycleCommandContextV1,
    allowedStates: readonly SandboxState[],
    targetState: "inert" | "active" | "failed" | "lost" | "quarantined" | "cleanup_failed" | "destroyed",
    reason: SandboxStateReason,
    pendingRequired: boolean,
  ): Promise<SandboxV1> {
    assertOpaqueId(resourceId, "resource_id", "sbx");
    assertDigest(evidenceSha256, "evidence_sha256");
    const ctx = await this.#authorizeLifecycle(
      operation,
      resourceId,
      lifecycleRecordRequestDigest(operation, resourceId, evidenceSha256),
      contextValue,
    );
    return this.#repository.transaction((tx) => {
      const current = this.#mustSandbox(tx, resourceId);
      const replay = this.#resolveReplay(tx, ctx, operation, resourceId);
      if (replay !== undefined) {
        if (replay.state === "committed") return current;
        throw new SandboxError("provider_state_unknown", "The lifecycle outcome command is unresolved");
      }
      this.#assertCurrentFence(
        current,
        ctx.fence,
        ctx.transition.expected_resource_lifecycle_generation,
      );
      this.#assertExpectedRevision(current, ctx.expected_revision);
      if (!allowedStates.includes(current.state)) {
        throw new SandboxError("policy_denied", `${operation} is not allowed from ${current.state}`);
      }
      const pending = current.pending_provider_outcome;
      if (
        (pendingRequired && pending === undefined) ||
        (pendingRequired && pending !== undefined &&
          (pending.target_state !== targetState || pending.evidence_sha256 !== evidenceSha256))
      ) {
        throw new SandboxError("integrity_failed", "Lifecycle outcome does not name the exact externally anchored provider receipt");
      }
      this.#reserve(tx, operation, resourceId, ctx);
      const transitioned = this.#transition(
        current,
        targetState,
        reason,
        ctx.fence,
        ctx.transition.successor_resource_lifecycle_generation,
      );
      const nextHandleDigest = this.#advanceStoredHandle(
        tx,
        resourceId,
        ctx.transition.successor_resource_lifecycle_generation,
      );
      const {
        pending_provider_outcome: _pending,
        canonical_transition_required: _canonicalTransitionRequired,
        ...withoutPending
      } = transitioned;
      const completed: SandboxV1 = {
        ...withoutPending,
        ...(nextHandleDigest === undefined ? {} : { provider_handle_sha256: nextHandleDigest }),
        ...(targetState === "destroyed"
          ? {
              destroyed_at: pending?.observed_at ?? this.#now(),
              ...(pending?.terminal_disposition === undefined
                ? {}
                : { terminal_disposition: pending.terminal_disposition }),
            }
          : {}),
      };
      tx.putSandbox(completed, current.revision);
      this.#commitOperation(tx, ctx.operation_id, canonicalDigest(completed));
      this.#event(tx, completed, ctx.operation_id, "operation_committed");
      return completed;
    });
  }

  async #authorizeLifecycle(
    operation: SandboxOperation,
    resourceId: string,
    expectedDigest: Digest,
    value: LifecycleCommandContextV1,
    allowProviderDispatch = false,
  ): Promise<NormalizedLifecycleContext> {
    const fence = validateFence(value.fence);
    const capability = validateCapability(value.capability);
    const transition = validateLifecycleTransition(value.transition);
    assertOpaqueId(value.operation_id, "context.operation_id", "op");
    assertDigest(value.idempotency_key_sha256, "context.idempotency_key_sha256");
    assertDigest(value.request_sha256, "context.request_sha256");
    if (!Number.isSafeInteger(value.expected_revision) || value.expected_revision < 0) {
      throw new SandboxError("validation_failed", "Expected revision must be a non-negative safe integer");
    }
    if (
      !allowProviderDispatch &&
      ("dispatch_journal" in value || capability.dispatch_journal_anchor_sha256 !== undefined)
    ) {
      throw new SandboxError("validation_failed", "Non-provider lifecycle commands cannot carry a DISPATCHED anchor");
    }
    if (
      value.operation_id !== fence.operation_id ||
      value.request_sha256 !== expectedDigest ||
      fence.operation_digest !== expectedDigest ||
      fence.resource_id !== resourceId
    ) {
      throw new SandboxError("request_digest_mismatch", "Operation ID or request digest does not match the protected fence");
    }
    if (
      transition.successor_resource_lifecycle_generation !== fence.resource_lifecycle_generation
    ) {
      throw new SandboxError("integrity_failed", "Lifecycle command does not bind the successor fence");
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
    const authenticated = await this.#verifier.verifyCapability(capability);
    this.#assertAuthenticatedBindings(authenticated, fence);
    return {
      operation_id: value.operation_id,
      idempotency_key_sha256: value.idempotency_key_sha256,
      request_sha256: expectedDigest,
      expected_revision: value.expected_revision,
      transition,
      fence,
      capability,
    };
  }

  async #authorizeProvider(
    operation: SandboxOperation,
    resourceId: string,
    expectedDigest: Digest,
    value: MutationContextV1,
    expectedAuthorizationReceipt?: Digest,
  ): Promise<NormalizedMutationContext> {
    const base = await this.#authorizeLifecycle(operation, resourceId, expectedDigest, value, true);
    const dispatchJournal = validateDispatchedJournalAnchor(value.dispatch_journal);
    const priorFailedNoEffectAuthorization = this.#repository.transaction((tx) => {
      const prior = tx.getOperation(base.operation_id);
      return prior?.effect_phase === "failed_no_effect"
        ? prior.provider_target?.authorization_consumption_receipt_sha256
        : undefined;
    });
    const authorizationReceipt = expectedAuthorizationReceipt ??
      priorFailedNoEffectAuthorization ??
      this.#capabilityUseDigest(base.capability);
    if (
      dispatchJournal.operation_id !== base.fence.operation_id ||
      dispatchJournal.outcome_schema_version !== EFFECT_JOURNAL_OUTCOME_SCHEMA_VERSION ||
      dispatchJournal.outcome_schema_digest !== EFFECT_JOURNAL_OUTCOME_SCHEMA_DIGEST ||
      dispatchJournal.operation_execution_epoch !== base.fence.operation_execution_epoch ||
      dispatchJournal.operation_digest !== base.fence.operation_digest ||
      dispatchJournal.resource_id !== base.fence.resource_id ||
      dispatchJournal.authority_epoch !== base.fence.authority_epoch ||
      dispatchJournal.expected_resource_lifecycle_generation !==
        base.transition.expected_resource_lifecycle_generation ||
      dispatchJournal.successor_resource_lifecycle_generation !==
        base.transition.successor_resource_lifecycle_generation ||
      canonicalDigest(dispatchJournal.fence) !== canonicalDigest(base.fence) ||
      dispatchJournal.authorization_consumption_receipt_sha256 !== authorizationReceipt ||
      dispatchedJournalAnchorDigest(dispatchJournal) !== dispatchJournal.anchor_sha256 ||
      base.capability.dispatch_journal_anchor_sha256 !== dispatchJournal.anchor_sha256
    ) {
      throw new SandboxError("integrity_failed", "DISPATCHED journal anchor does not bind the exact transition, authorization, and fence");
    }
    return { ...base, dispatch_journal: dispatchJournal };
  }

  async #verifyDispatched(ctx: NormalizedMutationContext): Promise<void> {
    if (ctx.dispatch_journal.state !== "dispatched") {
      throw new SandboxError("capability_denied", "Provider effect lacks a DISPATCHED journal anchor");
    }
    const operation = this.#repository.transaction((tx) => {
      const current = tx.getOperation(ctx.operation_id);
      if (
        current === undefined ||
        !["prepared", "dispatched"].includes(current.effect_phase)
      ) {
        throw new SandboxError("integrity_failed", "Provider effect has no durable operation intent");
      }
      this.#assertProviderDispatchBarrier(tx, current, ctx);
      if (current.effect_phase === "prepared") {
        return tx.compareAndSwapOperationPhase(
          ctx.operation_id,
          ["prepared"],
          "dispatched",
          this.#now(),
        );
      }
      return current;
    });
    if (Date.parse(ctx.dispatch_journal.recorded_at) < Date.parse(operation.created_at)) {
      throw new SandboxError("integrity_failed", "External DISPATCHED anchor predates the durable intent");
    }
    const appended = validateDispatchedJournalAnchor(
      await this.#dispatchJournal.appendDispatched(ctx.dispatch_journal),
    );
    if (
      appended.anchor_sha256 !== ctx.dispatch_journal.anchor_sha256 ||
      canonicalDigest(appended) !== canonicalDigest(ctx.dispatch_journal)
    ) {
      throw new SandboxError("integrity_failed", "External journal returned a conflicting DISPATCHED anchor");
    }
    this.#repository.transaction((tx) => {
      tx.appendExternalAnchor({
        schema_version: SCHEMA_VERSION,
        record_kind: "DISPATCHED",
        outcome_schema_version: appended.outcome_schema_version,
        outcome_schema_digest: appended.outcome_schema_digest,
        operation_id: appended.operation_id,
        operation_step_id: appended.operation_step_id,
        operation_execution_epoch: appended.operation_execution_epoch,
        anchor_sha256: appended.anchor_sha256,
        frontier_sha256: appended.frontier_sha256,
        payload_sha256: canonicalDigest(appended),
        recorded_at: appended.recorded_at,
      });
    });
    const authenticated = await this.#verifier.verifyDispatchedJournalAnchor(
      appended,
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
      if (current === undefined || current.effect_phase !== "dispatched") {
        throw new SandboxError("integrity_failed", "Dispatched operation disappeared before provider invocation");
      }
      this.#assertProviderDispatchBarrier(tx, current, ctx);
    });
    await this.#physicalSafety.assertProviderDispatchAllowed({
      resource_id: ctx.fence.resource_id,
      operation: operation.operation,
      fence: ctx.fence,
      dispatch_anchor_sha256: ctx.dispatch_journal.anchor_sha256,
    });
  }

  #assertProviderDispatchBarrier(
    tx: SandboxRepositoryTxV1,
    operation: OperationRecordV1,
    ctx: NormalizedMutationContext,
  ): void {
    const now = tx.databaseTime().getTime();
    if (
      Date.parse(ctx.fence.lease_expires_at) <= now ||
      Date.parse(ctx.fence.operation_execution_expires_at) <= now ||
      Date.parse(ctx.dispatch_journal.expires_at) <= now ||
      Date.parse(ctx.capability.expires_at) <= now ||
      Date.parse(ctx.capability.not_before) > now
    ) {
      throw new SandboxError("lease_expired", "Provider dispatch barrier authorization is not current");
    }
    if (
      operation.cancellation_state !== "open" ||
      operation.dispatch_journal_anchor_sha256 !== ctx.dispatch_journal.anchor_sha256 ||
      canonicalDigest(operation.fence) !== canonicalDigest(ctx.fence) ||
      canonicalDigest(operation.provider_target ?? null) !== canonicalDigest(this.#effectTarget(ctx))
    ) {
      throw new SandboxError("integrity_failed", "Provider dispatch intent changed before invocation");
    }
    const current = this.#mustSandbox(tx, ctx.fence.resource_id);
    const expectedState: Partial<Record<SandboxOperation, SandboxState>> = {
      begin_create_inert: "creating_inert",
      begin_activate: "activating",
      expire: "expiring",
      begin_destroy: "destroying",
      resume_destroy: "destroying",
    };
    if (
      current.state !== expectedState[operation.operation] ||
      current.revision !== operation.prepared_resource_revision
    ) {
      throw new SandboxError("stale_revision", "Resource changed after provider dispatch preparation");
    }
    this.#assertCurrentFence(
      current,
      ctx.fence,
      operation.successor_resource_lifecycle_generation,
    );
    if (
      ["begin_create_inert", "begin_activate"].includes(operation.operation) &&
      current.physical_safety_state !== "clear"
    ) {
      throw new SandboxError("policy_denied", "Physical safety fence closed provider dispatch");
    }
    if (tx.getCapabilityUseOperation(operation.capability_use_sha256) !== operation.operation_id) {
      throw new SandboxError("capability_denied", "Provider dispatch capability consumption is not durable");
    }
    const authorizationReceipt = operation.provider_target?.authorization_consumption_receipt_sha256;
    if (
      operation.operation === "begin_activate" &&
      (authorizationReceipt === undefined ||
        tx.getActivationGrantUseOperation(authorizationReceipt) !== operation.operation_id)
    ) {
      throw new SandboxError("capability_denied", "Activation grant consumption is not durable");
    }
    if (
      ["begin_destroy", "resume_destroy"].includes(operation.operation) &&
      (authorizationReceipt === undefined ||
        tx.getCleanupGrantUseOperation(authorizationReceipt) !== operation.operation_id)
    ) {
      throw new SandboxError("cleanup_grant_mismatch", "Cleanup grant consumption is not durable");
    }
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

  #assertSafetyObservation(
    observation: SafetyFenceObservationV1,
    resourceId: string,
    generation: bigint,
    reason: SafetyFenceObservationV1["reason"],
    observedAt: string,
  ): void {
    assertOpaqueId(observation.resource_id, "safety_observation.resource_id", "sbx");
    assertOpaqueId(observation.signer_principal, "safety_observation.signer_principal", "principal");
    assertDigest(observation.installed_policy_sha256, "safety_observation.installed_policy_sha256");
    assertDigest(observation.process_stop_evidence_sha256, "safety_observation.process_stop_evidence_sha256");
    assertDigest(observation.network_close_evidence_sha256, "safety_observation.network_close_evidence_sha256");
    if (
      observation.schema_version !== "sandboxes.safety-fence/v1" ||
      observation.resource_id !== resourceId ||
      observation.resource_lifecycle_generation !== generation ||
      observation.reason !== reason ||
      observation.observed_at !== observedAt
    ) {
      throw new SandboxError("integrity_failed", "Physical safety controller returned a mismatched signed observation");
    }
  }

  #assertReceiptFenceBinding(
    current: SandboxV1,
    fence: CanonicalSandboxEffectFenceV1,
  ): void {
    if (
      fence.authority_epoch !== current.authority_epoch ||
      fence.route_lineage_id !== current.route_lineage_id ||
      fence.route_id !== current.route_id ||
      fence.route_epoch !== current.route_epoch ||
      fence.run_id !== current.run_id ||
      fence.attempt_id !== current.attempt_id ||
      fence.attempt_lease_id !== current.attempt_lease_id ||
      fence.lease_epoch !== current.lease_epoch ||
      fence.resource_lease_id !== current.resource_lease_id ||
      fence.resource_id !== current.id ||
      fence.resource_lifecycle_generation !== current.resource_lifecycle_generation ||
      fence.operation_execution_epoch !== current.operation_execution_epoch ||
      fence.actor_principal !== current.actor_principal ||
      fence.lease_holder_principal !== current.lease_holder_principal ||
      fence.operation_executor_principal !== current.operation_executor_principal ||
      fence.audience !== current.audience
    ) {
      throw new SandboxError("cleanup_receipt_mismatch", "Receipt full fence does not bind the current sandbox");
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
    ctx: NormalizedLifecycleContext,
  ): ReservedOperation {
    const dispatchAnchorSha256 = hasDispatchJournal(ctx)
      ? ctx.dispatch_journal.anchor_sha256
      : undefined;
    const providerTarget = hasDispatchJournal(ctx) ? this.#effectTarget(ctx) : undefined;
    const existingById = tx.getOperation(ctx.operation_id);
    if (existingById !== undefined) {
      if (
        existingById.operation !== operation ||
        existingById.resource_id !== resourceId ||
        existingById.actor_principal !== ctx.fence.actor_principal ||
        existingById.request_sha256 !== ctx.request_sha256 ||
        existingById.idempotency_key_sha256 !== ctx.idempotency_key_sha256 ||
        existingById.expected_revision !== ctx.expected_revision ||
        existingById.dispatch_journal_anchor_sha256 !== dispatchAnchorSha256 ||
        canonicalDigest(existingById.provider_target ?? null) !== canonicalDigest(providerTarget ?? null) ||
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
        existingByKey.dispatch_journal_anchor_sha256 !== dispatchAnchorSha256 ||
        canonicalDigest(existingByKey.provider_target ?? null) !== canonicalDigest(providerTarget ?? null) ||
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
      ...(hasDispatchJournal(ctx)
        ? {
            operation_step_id: ctx.dispatch_journal.operation_step_id,
            dispatch_journal_anchor_sha256: ctx.dispatch_journal.anchor_sha256,
            provider_target: this.#effectTarget(ctx),
          }
        : {}),
      operation,
      resource_id: resourceId,
      actor_principal: ctx.fence.actor_principal,
      idempotency_key_sha256: ctx.idempotency_key_sha256,
      request_sha256: ctx.request_sha256,
      capability_use_sha256: capabilityUse,
      expected_resource_lifecycle_generation:
        ctx.transition.expected_resource_lifecycle_generation,
      successor_resource_lifecycle_generation: ctx.transition.successor_resource_lifecycle_generation,
      fence: ctx.fence,
      expected_revision: ctx.expected_revision,
      prepared_resource_revision: ctx.expected_revision + 1,
      cancellation_state: "open",
      effect_phase: hasDispatchJournal(ctx) ? "prepared" : "not_applicable",
      state: "in_flight",
      created_at: now,
      updated_at: now,
    };
    tx.insertOperation(record);
    tx.consumeCapabilityUse(capabilityUse, ctx.operation_id);
    return { operation: record, replay: false };
  }

  #retryFailedNoEffect(
    tx: SandboxRepositoryTxV1,
    operationName: SandboxOperation,
    current: SandboxV1,
    ctx: NormalizedMutationContext,
    expectedState: SandboxState,
  ): OperationRecordV1 | undefined {
    const prior = tx.getOperation(ctx.operation_id);
    if (prior?.effect_phase !== "failed_no_effect") return undefined;

    const target = this.#effectTarget(ctx);
    if (
      prior.operation !== operationName ||
      prior.resource_id !== current.id ||
      prior.actor_principal !== ctx.fence.actor_principal ||
      prior.request_sha256 !== ctx.request_sha256 ||
      prior.idempotency_key_sha256 !== ctx.idempotency_key_sha256 ||
      prior.operation_step_id !== ctx.dispatch_journal.operation_step_id ||
      canonicalDigest(prior.provider_target ?? null) !== canonicalDigest(target) ||
      prior.expected_resource_lifecycle_generation !==
        ctx.transition.expected_resource_lifecycle_generation ||
      prior.successor_resource_lifecycle_generation !==
        ctx.transition.successor_resource_lifecycle_generation ||
      ctx.fence.operation_execution_epoch !== prior.fence.operation_execution_epoch + 1n
    ) {
      throw new SandboxError(
        "idempotency_key_reused",
        "failed_no_effect retry changed its semantic step, target, request, or execution sequence",
      );
    }
    if (
      current.state !== expectedState ||
      current.pending_provider_outcome?.source_operation_id !== ctx.operation_id ||
      current.pending_provider_outcome.target_state !== "failed" ||
      current.pending_provider_outcome.evidence_sha256 !== prior.outcome_anchor_sha256
    ) {
      throw new SandboxError(
        "provider_state_unknown",
        "failed_no_effect retry lacks the exact pending authoritative outcome",
      );
    }
    this.#assertExpectedRevision(current, ctx.expected_revision);
    this.#assertCurrentFence(
      current,
      ctx.fence,
      prior.successor_resource_lifecycle_generation,
    );

    const records = tx.listExternalAnchors(ctx.operation_id);
    const priorDispatch = records.find((record) =>
      record.record_kind === "DISPATCHED" &&
      record.operation_step_id === prior.operation_step_id &&
      record.operation_execution_epoch === prior.fence.operation_execution_epoch
    );
    const priorOutcome = records.find((record) =>
      record.record_kind === "OUTCOME" &&
      record.operation_step_id === prior.operation_step_id &&
      record.operation_execution_epoch === prior.fence.operation_execution_epoch
    );
    if (
      priorDispatch === undefined ||
      priorOutcome?.record_kind !== "OUTCOME" ||
      priorOutcome.outcome_kind !== "failed_no_effect" ||
      priorOutcome.anchor_sha256 !== prior.outcome_anchor_sha256 ||
      records.some((record) =>
        record.record_kind === "DISPATCHED" &&
        record.operation_step_id === prior.operation_step_id &&
        record.operation_execution_epoch > prior.fence.operation_execution_epoch
      )
    ) {
      throw new SandboxError(
        "provider_state_unknown",
        "higher execution epoch requires exactly one authoritative prior failed_no_effect outcome",
      );
    }

    const capabilityUse = this.#capabilityUseDigest(ctx.capability);
    tx.consumeCapabilityUse(capabilityUse, ctx.operation_id);
    const { pending_provider_outcome: _pending, ...stableSandbox } = current;
    const preparedSandbox: SandboxV1 = {
      ...stableSandbox,
      revision: current.revision + 1,
      authority_epoch: ctx.fence.authority_epoch,
      route_lineage_id: ctx.fence.route_lineage_id,
      route_id: ctx.fence.route_id,
      route_epoch: ctx.fence.route_epoch,
      attempt_lease_id: ctx.fence.attempt_lease_id,
      lease_epoch: ctx.fence.lease_epoch,
      resource_lease_id: ctx.fence.resource_lease_id,
      operation_execution_epoch: ctx.fence.operation_execution_epoch,
      actor_principal: ctx.fence.actor_principal,
      lease_holder_principal: ctx.fence.lease_holder_principal,
      operation_executor_principal: ctx.fence.operation_executor_principal,
      audience: ctx.fence.audience,
    };
    tx.putSandbox(preparedSandbox, current.revision);

    const {
      outcome_anchor_sha256: _priorOutcomeAnchor,
      result_sha256: _priorResult,
      error_code: _priorError,
      ...stableOperation
    } = prior;
    const preparedOperation: OperationRecordV1 = {
      ...stableOperation,
      dispatch_journal_anchor_sha256: ctx.dispatch_journal.anchor_sha256,
      provider_target: target,
      capability_use_sha256: capabilityUse,
      fence: ctx.fence,
      expected_revision: ctx.expected_revision,
      prepared_resource_revision: preparedSandbox.revision,
      cancellation_state: "open",
      effect_phase: "prepared",
      state: "in_flight",
      updated_at: this.#now(),
    };
    tx.updateOperation(preparedOperation);
    this.#event(tx, preparedSandbox, ctx.operation_id, "operation_reserved");
    return preparedOperation;
  }

  #resolveReplay(
    tx: SandboxRepositoryTxV1,
    ctx: NormalizedLifecycleContext,
    operation: SandboxOperation,
    resourceId: string,
  ): OperationRecordV1 | undefined {
    const dispatchAnchorSha256 = hasDispatchJournal(ctx)
      ? ctx.dispatch_journal.anchor_sha256
      : undefined;
    const providerTarget = hasDispatchJournal(ctx) ? this.#effectTarget(ctx) : undefined;
    const record = tx.getOperation(ctx.operation_id);
    if (
      record !== undefined &&
      record.operation === operation &&
      record.resource_id === resourceId &&
      record.request_sha256 === ctx.request_sha256 &&
      record.idempotency_key_sha256 === ctx.idempotency_key_sha256 &&
      record.actor_principal === ctx.fence.actor_principal &&
      record.expected_revision === ctx.expected_revision &&
      record.dispatch_journal_anchor_sha256 === dispatchAnchorSha256 &&
      canonicalDigest(record.provider_target ?? null) === canonicalDigest(providerTarget ?? null) &&
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
    reason: SandboxStateReason,
    _successorGeneration: bigint,
  ): Promise<SandboxV1> {
    const observedAt = this.#now();
    const physicalReason = reason === "provider_identity_mismatch"
      ? "provider_identity_mismatch" as const
      : "provider_ambiguous" as const;
    const snapshot = this.get(resourceId);
    const safetyObservation = await this.#physicalSafety.fenceResource({
      resource_id: resourceId,
      resource_lifecycle_generation: snapshot.resource_lifecycle_generation,
      reason: "provider_ambiguous",
      observed_at: observedAt,
    });
    this.#assertSafetyObservation(
      safetyObservation,
      resourceId,
      snapshot.resource_lifecycle_generation,
      "provider_ambiguous",
      observedAt,
    );
    const safetyReceipt = canonicalDigest(safetyObservation);
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
      this.#unknownOperation(tx, operationId);
      this.#event(tx, fenced, operationId, "operation_unknown");
      return fenced;
    });
  }

  async #markFailed(resourceId: string, operationId: string, _successorGeneration: bigint): Promise<void> {
    const providerReceiptSha256 = canonicalDigest({
      reason: "provider_rejected_no_effect",
      resource_id: resourceId,
    });
    const outcomeAnchor = await this.#anchorOutcome(
      operationId,
      "failed_no_effect",
      providerReceiptSha256,
    );
    this.#repository.transaction((tx) => {
      const current = this.#mustSandbox(tx, resourceId);
      const outcomePending: SandboxV1 = {
        ...current,
        revision: current.revision + 1,
        pending_provider_outcome: {
          source_operation_id: operationId,
          target_state: "failed",
          evidence_sha256: outcomeAnchor,
          provider_receipt_sha256: providerReceiptSha256,
          observed_at: this.#now(),
        },
      };
      tx.putSandbox(outcomePending, current.revision);
      const operation = tx.getOperation(operationId);
      if (operation !== undefined) {
        tx.updateOperation({
          ...operation,
          state: "aborted",
          effect_phase: "failed_no_effect",
          error_code: "provider_unavailable",
          outcome_anchor_sha256: outcomeAnchor,
          updated_at: this.#now(),
        });
      }
      this.#event(tx, outcomePending, operationId, "operation_committed");
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
    const snapshot = this.get(resourceId);
    const observedAt = this.#now();
    const safetyObservation = await this.#physicalSafety.fenceResource({
      resource_id: resourceId,
      resource_lifecycle_generation: snapshot.resource_lifecycle_generation,
      reason: "provider_ambiguous",
      observed_at: observedAt,
    });
    this.#assertSafetyObservation(
      safetyObservation,
      resourceId,
      snapshot.resource_lifecycle_generation,
      "provider_ambiguous",
      observedAt,
    );
    const safetyReceipt = canonicalDigest(safetyObservation);
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
      this.#unknownOperation(tx, operationId);
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
      handle.provider_creation_token_sha256 !==
        ctx.dispatch_journal.provider_idempotency_token_sha256 ||
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

  #providerOperation(operation: ProviderMutationOperationV1, ctx: NormalizedMutationContext): ProviderOperationV1 {
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

  async #readProbeOperation(
    ctx: NormalizedMutationContext,
    operation: ProviderOperationV1,
  ): Promise<ProviderOperationV1> {
    const target = this.#effectTarget(ctx);
    const recordedAt = this.#now();
    const anchor = await this.#readProbeJournal.appendReadProbe({
      operation_id: ctx.operation_id,
      operation_step_id: ctx.dispatch_journal.operation_step_id,
      request_sha256: ctx.request_sha256,
      fence: ctx.fence,
      target,
      recorded_at: recordedAt,
    });
    assertOpaqueId(anchor.journal_anchor_id, "read_probe.journal_anchor_id", "journal");
    assertOpaqueId(anchor.issuer_principal, "read_probe.issuer_principal", "principal");
    assertDigest(anchor.frontier_sha256, "read_probe.frontier_sha256");
    assertDigest(anchor.anchor_sha256, "read_probe.anchor_sha256");
    if (
      anchor.schema_version !== SCHEMA_VERSION ||
      anchor.state !== "read_probe" ||
      anchor.operation_id !== ctx.operation_id ||
      anchor.operation_step_id !== ctx.dispatch_journal.operation_step_id ||
      anchor.operation_digest !== ctx.request_sha256 ||
      anchor.resource_id !== ctx.fence.resource_id ||
      anchor.recorded_at !== recordedAt ||
      Date.parse(anchor.expires_at) <= this.#repository.databaseTime().getTime() ||
      canonicalDigest(anchor.fence) !== canonicalDigest(ctx.fence) ||
      canonicalDigest(anchor.target) !== canonicalDigest(target) ||
      readProbeJournalAnchorDigest(anchor) !== anchor.anchor_sha256
    ) {
      throw new SandboxError("integrity_failed", "READ_PROBE journal returned a mismatched signed anchor");
    }
    const authenticated = await this.#verifier.verifyReadProbeJournalAnchor(anchor, ctx.fence);
    this.#assertAuthenticatedBindings(authenticated, ctx.fence);
    this.#repository.transaction((tx) => {
      tx.appendExternalAnchor({
        schema_version: SCHEMA_VERSION,
        record_kind: "READ_PROBE",
        operation_id: anchor.operation_id,
        operation_step_id: anchor.operation_step_id,
        operation_execution_epoch: anchor.fence.operation_execution_epoch,
        anchor_sha256: anchor.anchor_sha256,
        frontier_sha256: anchor.frontier_sha256,
        payload_sha256: canonicalDigest(anchor),
        recorded_at: anchor.recorded_at,
      });
    });
    return {
      ...operation,
      operation: "inspect",
      external_anchor_kind: "READ_PROBE",
      external_anchor_receipt_sha256: anchor.anchor_sha256,
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
    outcomeKind: ProviderOutcomeAnchorV1["outcome_kind"],
    outcomeSha256: Digest,
  ): Promise<Digest> {
    const operation = this.#repository.transaction((tx) => tx.getOperation(operationId));
    if (operation === undefined) {
      throw new SandboxError("integrity_failed", "Cannot anchor an outcome without a durable operation");
    }
    if (
      operation.operation_step_id === undefined ||
      operation.dispatch_journal_anchor_sha256 === undefined ||
      operation.provider_target === undefined
    ) {
      throw new SandboxError("integrity_failed", "Provider outcome has no dispatched operation step");
    }
    const recordedAt = this.#now();
    const anchor = await this.#outcomeJournal.appendOutcome({
      operation_id: operationId,
      operation_step_id: operation.operation_step_id,
      operation_execution_epoch: operation.fence.operation_execution_epoch,
      dispatch_anchor_sha256: operation.dispatch_journal_anchor_sha256,
      outcome_kind: outcomeKind,
      outcome_sha256: outcomeSha256,
      recorded_at: recordedAt,
      fence: operation.fence,
      target: operation.provider_target,
    });
    assertOpaqueId(anchor.issuer_principal, "outcome_anchor.issuer_principal", "principal");
    assertEffectJournalOutcomeSchema(
      anchor.outcome_schema_version,
      anchor.outcome_schema_digest,
    );
    assertDigest(anchor.frontier_sha256, "outcome_anchor.frontier_sha256");
    assertDigest(anchor.anchor_sha256, "outcome_anchor.anchor_sha256");
    if (
      anchor.schema_version !== SCHEMA_VERSION ||
      anchor.record_kind !== "OUTCOME" ||
      anchor.outcome_schema_version !== EFFECT_JOURNAL_OUTCOME_SCHEMA_VERSION ||
      anchor.outcome_schema_digest !== EFFECT_JOURNAL_OUTCOME_SCHEMA_DIGEST ||
      anchor.operation_id !== operationId ||
      anchor.operation_step_id !== operation.operation_step_id ||
      anchor.operation_execution_epoch !== operation.fence.operation_execution_epoch ||
      anchor.dispatch_anchor_sha256 !== operation.dispatch_journal_anchor_sha256 ||
      anchor.outcome_kind !== outcomeKind ||
      anchor.outcome_sha256 !== outcomeSha256 ||
      anchor.recorded_at !== recordedAt ||
      canonicalDigest(anchor.fence) !== canonicalDigest(operation.fence) ||
      canonicalDigest(anchor.target) !== canonicalDigest(operation.provider_target) ||
      providerOutcomeAnchorDigest(anchor) !== anchor.anchor_sha256
    ) {
      throw new SandboxError("integrity_failed", "Outcome journal returned a mismatched signed frontier anchor");
    }
    const authenticated = await this.#verifier.verifyProviderOutcomeAnchor(anchor, operation.fence);
    this.#assertAuthenticatedBindings(authenticated, operation.fence);
    this.#repository.transaction((tx) => {
      tx.appendExternalAnchor({
        schema_version: SCHEMA_VERSION,
        record_kind: "OUTCOME",
        outcome_schema_version: anchor.outcome_schema_version,
        outcome_schema_digest: anchor.outcome_schema_digest,
        operation_id: anchor.operation_id,
        operation_step_id: anchor.operation_step_id,
        operation_execution_epoch: anchor.operation_execution_epoch,
        outcome_kind: anchor.outcome_kind,
        anchor_sha256: anchor.anchor_sha256,
        frontier_sha256: anchor.frontier_sha256,
        payload_sha256: canonicalDigest(anchor),
        recorded_at: anchor.recorded_at,
      });
    });
    return anchor.anchor_sha256;
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
