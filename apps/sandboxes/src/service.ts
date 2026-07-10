import {
  assertDigest,
  assertOpaqueId,
  assertRfc3339,
  canonicalDigest,
  createOpaqueId,
  nowRfc3339,
  sha256,
  type Digest,
} from "./canonical.js";
import { SandboxError } from "./errors.js";
import { HERMETIC_TEST_RUNNER } from "./hermetic-test-brand.js";
import {
  assertEffectJournalOutcomeSchema,
  EFFECT_JOURNAL_OUTCOME_SCHEMA_DIGEST,
  EFFECT_JOURNAL_OUTCOME_SCHEMA_VERSION,
} from "./effect-journal.js";
import type { ProviderHandleSealerV1 } from "./handle-sealer.js";
import {
  adapterAdmissionReceiptDigest,
  adapterDescriptorDigest,
  providerHandleBinding,
  providerHandleIdentityDigest,
  providerNonAcceptanceProofDigest,
  providerTargetFingerprintDigest,
} from "./provider-identity.js";
import type { SandboxRepositoryTxV1, SandboxRepositoryV1 } from "./repository.js";
import {
  ProviderRejectedNoEffectError,
  ProviderIdentityMismatchError,
  type AdapterCallContextV1,
  type DestroyContextV1,
  type ReconcileContextV1,
  type SandboxRunnerV1,
} from "./runner.js";
import {
  SCHEMA_VERSION,
  type ActivationReceiptV1,
  type ActivationGrantV1,
  type AdapterDescriptorV1,
  type AdapterAdmissionReceiptV1,
  type CanonicalSandboxEffectFenceV1,
  type CapabilityClaimsV1,
  type CheckpointDurabilityReceiptV1,
  type CreateSandboxV1,
  type DispatchedJournalAnchorV1,
  type DestroyObservationV1,
  type EffectJournalRecoveryRangeV1,
  type GitPromotionReceiptRefV1,
  type InfinityCleanupGrantV1,
  type LifecycleCommandContextV1,
  type LifecycleTransitionBindingV1,
  type MutationContextV1,
  type OperationRecordV1,
  type OperationResolutionV1,
  type OwnedProviderHandleV1,
  type OwnedResourcePageV1,
  type ProviderOperationV1,
  type ProviderOutcomeAnchorV1,
  type ProviderMutationOperationV1,
  type ProviderHandleBindingV1,
  type ProviderNonAcceptanceProofV1,
  type ProviderNoEffectVerificationReceiptV1,
  type ProviderEffectTargetV1,
  type ProviderDiscoveryScopeV1,
  type ProviderLifecycleLockBindingV1,
  type ReadProbeJournalAnchorV1,
  type ReconcileFindingV1,
  type SandboxDestroyTombstoneV1,
  type SandboxEventV1,
  type SandboxOperation,
  type SandboxState,
  type SandboxStateReason,
  type SandboxV1,
  type SafetyFenceObservationV1,
  type StoredSafetyFenceObservationV1,
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
  validateProviderOutcomeAnchor,
  validateProviderDiscoveryScope,
  validateReadProbeJournalAnchor,
} from "./validation.js";

export interface SandboxesAuthorityVerifierV1 {
  /** Returns identities taken from protected transport/PoP state, never request-body claims. */
  verifyCapability(claims: CapabilityClaimsV1): Promise<AuthenticatedEffectBindingsV1>;
  /** Online expiry/revocation/current-holder check used before every page/chunk pull. */
  verifyCurrentEffectAuthorization(
    claims: CapabilityClaimsV1,
    fence: CanonicalSandboxEffectFenceV1,
  ): Promise<AuthenticatedEffectBindingsV1>;
  /** Performs the online current-fence check immediately before the provider call. */
  verifyDispatchedJournalAnchor(
    anchor: DispatchedJournalAnchorV1,
    fence: CanonicalSandboxEffectFenceV1,
  ): Promise<AuthenticatedJournalBindingsV1>;
  verifyReadProbeJournalAnchor(
    anchor: ReadProbeJournalAnchorV1,
    fence: CanonicalSandboxEffectFenceV1,
  ): Promise<AuthenticatedJournalBindingsV1>;
  verifyProviderOutcomeAnchor(
    anchor: ProviderOutcomeAnchorV1,
    fence: CanonicalSandboxEffectFenceV1,
  ): Promise<AuthenticatedJournalBindingsV1>;
  verifyActivationGrant(grant: ActivationGrantV1): Promise<void>;
  verifyCleanupGrant(grant: InfinityCleanupGrantV1): Promise<void>;
  verifyCheckpointReceipt(receipt: CheckpointDurabilityReceiptV1): Promise<void>;
  verifyGitPromotionReceipt(receipt: GitPromotionReceiptRefV1): Promise<void>;
  verifyAdapterAdmission(descriptor: AdapterDescriptorV1): Promise<AuthenticatedAdapterAdmissionV1>;
  verifyJournalRecoveryRange(
    range: EffectJournalRecoveryRangeV1,
  ): Promise<AuthenticatedJournalRecoveryRangeV1>;
  verifyProviderNonAcceptanceProof(
    proof: ProviderNonAcceptanceProofV1,
  ): Promise<ProviderNoEffectVerificationReceiptV1>;
}

export interface AuthenticatedEffectBindingsV1 {
  actor_principal: string;
  lease_holder_principal: string;
  operation_executor_principal: string;
  audience: typeof SCHEMA_VERSION;
}

/**
 * Result produced only by the trusted Infinity verifier after checking the
 * Ed25519 signature and the exact predecessor in Infinity's stored frontier.
 * Request bodies and local projection rows can never manufacture this value.
 */
export interface AuthenticatedJournalBindingsV1 extends AuthenticatedEffectBindingsV1 {
  anchor_schema_version: "infinity.effect-journal-anchor/v1";
  journal_sequence: bigint;
  prior_frontier_digest: Digest;
  record_digest: Digest;
  frontier_digest: Digest;
  envelope_digest: Digest;
  signer_principal: string;
  signing_key_id: string;
  signature_verified: true;
  contiguous_predecessor_verified: true;
  stored_frontier_membership: true;
}

export type AuthenticatedAdapterAdmissionV1 = AdapterAdmissionReceiptV1;

export interface AuthenticatedJournalRecoveryRangeV1 {
  schema_version: "infinity.authenticated-journal-recovery-range/v1";
  range_sha256: Digest;
  operation_id: string;
  operation_step_id: string;
  requested_from_sequence: bigint;
  current_head_sequence: bigint;
  current_head_frontier_digest: Digest;
  current_linearizable_head: true;
  complete_range: true;
  trusted_signer: true;
  verified_at: string;
  expires_at: string;
  verification_receipt_sha256: Digest;
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
  provider_lifecycle_lock: ProviderLifecycleLockV1;
  provider_journal_recovery: ProviderJournalRecoveryV1;
}

export interface ProviderLifecycleLockV1 {
  /** Must serialize this stable key across every service replica. */
  withLock<T>(
    binding: ProviderLifecycleLockBindingV1,
    effect: () => Promise<T>,
  ): Promise<T>;
}

export interface ProviderJournalRecoveryV1 {
  readOperationStepRange(input: {
    operation_id: string;
    operation_step_id: string;
    requested_from_sequence: bigint;
  }): Promise<EffectJournalRecoveryRangeV1>;
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
    outcome_kind: ProviderOutcomeAnchorV1["record"]["outcome_kind"];
    outcome_sha256: Digest;
    recorded_at: string;
    fence: CanonicalSandboxEffectFenceV1;
    target: ProviderEffectTargetV1;
    provider_no_effect_verification_receipt_sha256?: Digest;
  }): Promise<ProviderOutcomeAnchorV1>;
  /** Linearizable authoritative read of the complete signed envelope. */
  readOutcome(envelopeDigest: Digest): Promise<ProviderOutcomeAnchorV1 | undefined>;
}

export interface ProviderDispatchJournalV1 {
  /** Linearizable append-if-absent outside the repository restore domain. */
  appendDispatched(anchor: DispatchedJournalAnchorV1): Promise<DispatchedJournalAnchorV1>;
  readDispatched(envelopeDigest: Digest): Promise<DispatchedJournalAnchorV1 | undefined>;
  /**
   * Atomically verifies the supplied current-head non-inclusion proof and then
   * append-if-absent. `already_present` never authorizes a provider mutation.
   */
  recoverDispatched(input: {
    anchor: DispatchedJournalAnchorV1;
    current_head_noninclusion_receipt_sha256: Digest;
  }): Promise<{
    disposition: "inserted" | "already_present";
    anchor: DispatchedJournalAnchorV1;
    current_head_receipt_sha256: Digest;
  }>;
}

export interface ProviderReadProbeJournalV1 {
  appendReadProbe(input: {
    operation_id: string;
    operation_step_id: string;
    request_sha256: Digest;
    fence: CanonicalSandboxEffectFenceV1;
    target: ProviderEffectTargetV1;
    discovery_scope: ProviderDiscoveryScopeV1;
    recorded_at: string;
  }): Promise<ReadProbeJournalAnchorV1>;
  readReadProbe(envelopeDigest: Digest): Promise<ReadProbeJournalAnchorV1 | undefined>;
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

interface VerifiedAdapterContextV1 {
  descriptor: AdapterDescriptorV1;
  admission_receipt_sha256: Digest;
}

interface VerifiedJournalRecoveryRangeV1 {
  range: EffectJournalRecoveryRangeV1;
  current_head_noninclusion_receipt_sha256: Digest;
}

interface NormalizedMutationContext extends NormalizedLifecycleContext {
  dispatch_journal: DispatchedJournalAnchorV1;
  failed_no_effect_retry_proof?: {
    prior_execution_epoch: bigint;
    outcome_envelope_digest: Digest;
    outcome_frontier_digest: Digest;
  };
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

export function providerCreationTokenDigest(input: {
  resource_id: string;
  resource_lease_id: string;
  allocation_key_sha256: Digest;
  spec_sha256: Digest;
}): Digest {
  return canonicalDigest({
    schema_version: "sandboxes.provider-creation-token/v1",
    resource_id: input.resource_id,
    resource_lease_id: input.resource_lease_id,
    allocation_key_sha256: input.allocation_key_sha256,
    spec_sha256: input.spec_sha256,
  });
}

export function providerIdempotencyTokenDigest(input: {
  operation_id: string;
  operation_step_id: string;
  operation_digest: Digest;
  resource_id: string;
  provider_creation_token_sha256: Digest;
}): Digest {
  return canonicalDigest({
    schema_version: "sandboxes.provider-effect-token/v1",
    operation_id: input.operation_id,
    operation_step_id: input.operation_step_id,
    operation_digest: input.operation_digest,
    resource_id: input.resource_id,
    provider_creation_token_sha256: input.provider_creation_token_sha256,
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
  return canonicalDigest(anchor);
}

export function readProbeJournalAnchorDigest(anchor: ReadProbeJournalAnchorV1): Digest {
  return canonicalDigest(anchor);
}

export function providerOutcomeAnchorDigest(anchor: ProviderOutcomeAnchorV1): Digest {
  return canonicalDigest(anchor);
}

export function effectJournalRecordDigest(record: unknown): Digest {
  return canonicalDigest(record);
}

export function providerLifecycleLockKey(input: {
  installation_id: string;
  adapter_id: AdapterDescriptorV1["adapter_id"];
  provider_scope_ref: string;
  resource_id: string;
  resource_lease_id: string;
  provider_creation_token_sha256: Digest;
}): Digest {
  return canonicalDigest({
    schema_version: "sandboxes.provider-lifecycle-lock-key/v1",
    installation_id: input.installation_id,
    adapter_id: input.adapter_id,
    provider_scope_ref: input.provider_scope_ref,
    resource_id: input.resource_id,
    resource_lease_id: input.resource_lease_id,
    provider_creation_token_sha256: input.provider_creation_token_sha256,
  });
}

export function effectJournalFrontierDigest(
  anchor: Pick<
    DispatchedJournalAnchorV1,
    | "anchor_schema_version"
    | "journal_sequence"
    | "prior_frontier_digest"
    | "record_digest"
    | "signer_principal"
    | "signing_key_id"
  >,
): Digest {
  return canonicalDigest({
    anchor_schema_version: anchor.anchor_schema_version,
    journal_sequence: anchor.journal_sequence,
    prior_frontier_digest: anchor.prior_frontier_digest,
    record_digest: anchor.record_digest,
    signer_principal: anchor.signer_principal,
    signing_key_id: anchor.signing_key_id,
  });
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
  readonly #lifecycleLock: ProviderLifecycleLockV1;
  readonly #journalRecovery: ProviderJournalRecoveryV1;

  constructor(config: SandboxesServiceConfigV1) {
    this.#repository = config.repository;
    this.#runner = config.runner;
    this.#sealer = config.handle_sealer;
    this.#verifier = config.authority_verifier;
    this.#physicalSafety = config.physical_safety_controller;
    this.#outcomeJournal = config.provider_outcome_journal;
    this.#dispatchJournal = config.provider_dispatch_journal;
    this.#readProbeJournal = config.provider_read_probe_journal;
    this.#lifecycleLock = config.provider_lifecycle_lock;
    this.#journalRecovery = config.provider_journal_recovery;
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
    const expectedCreationToken = providerCreationTokenDigest({
      resource_id: input.resource_id,
      resource_lease_id: ctx.fence.resource_lease_id,
      allocation_key_sha256: input.allocation_key_sha256,
      spec_sha256: canonicalDigest(input.spec),
    });
    if (ctx.dispatch_journal.record.provider_creation_token_sha256 !== expectedCreationToken) {
      throw new SandboxError(
        "request_digest_mismatch",
        "Provider creation token does not bind the exact allocation key, spec, lease, and resource",
      );
    }
    const adapter = await this.#verifiedDescriptor();
    const { descriptor, admission_receipt_sha256: adapterAdmissionReceiptSha256 } = adapter;
    await this.#assertDescriptorSupportsCreate(descriptor, input);
    if (!descriptor.inert_create || !descriptor.exact_operation_lookup) {
      throw new SandboxError("unsupported_runtime_feature", "Runner lacks mandatory inert-create reconciliation");
    }
    const expectedTargetFingerprint = providerTargetFingerprintDigest({
      adapter_id: descriptor.adapter_id,
      adapter_version: descriptor.adapter_version,
      installation_id: descriptor.installation_id,
      provider_scope_ref: descriptor.provider_scope_ref,
      resource_kind: "strong_vm",
      resource_id: input.resource_id,
      resource_lease_id: ctx.fence.resource_lease_id,
      provider_creation_token_sha256: expectedCreationToken,
      spec_sha256: canonicalDigest(input.spec),
    });
    if (ctx.dispatch_journal.record.immutable_fingerprint_sha256 !== expectedTargetFingerprint) {
      throw new SandboxError(
        "request_digest_mismatch",
        "Provider target fingerprint does not bind the admitted installation, scope, resource, lease, token, and spec",
      );
    }

    const createdAt = await this.#now();
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
      adapter_descriptor: descriptor,
      adapter_admission_receipt_sha256: adapterAdmissionReceiptSha256,
      provider_creation_token_sha256: expectedCreationToken,
      create_inert_operation_id: ctx.operation_id,
      durable_checkpoint_receipt_sha256: [],
      git_promotion_receipt_sha256: [],
      created_at: createdAt,
      expires_at: input.spec.expires_at,
    };

    const reservation = await this.#repository.transaction((tx) => {
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
    const providerResult = await this.#withProviderLifecycleLock(ctx, descriptor, undefined, async () => {
      let handle: OwnedProviderHandleV1;
      let exactOperationLookupComplete = false;
      let existingReadProbe: ProviderOperationV1 | undefined;
      const recoveredDispatch = reservation.reconcile
        ? await this.#recoverExternalDispatch(ctx)
        : undefined;
      const mustReconcile = recoveredDispatch?.disposition === "already_present";
      if (mustReconcile) {
        const readProbe = await this.#readProbeOperation(ctx, op, descriptor);
        existingReadProbe = readProbe;
        await this.#assertCurrentEffectGuard(ctx, readProbe);
        await this.#assertCurrentAdapterAdmission(
          descriptor,
          adapterAdmissionReceiptSha256,
        );
        const observation = await this.#runner.lookupOperation(
          this.#reconcileContext(ctx, descriptor, readProbe),
          readProbe,
        );
        if (observation.state !== "completed" || observation.handle === undefined) {
          return { kind: "unknown" as const, reason: "ambiguous_provider_state" as const };
        }
        handle = observation.handle;
        exactOperationLookupComplete = true;
      } else {
        let providerReachable = false;
        try {
          await this.#verifyDispatched(ctx, recoveredDispatch?.disposition === "inserted");
          const finalBarrierReceiptSha256 = await this.#assertFinalProviderMutationBarrier(
            ctx,
            descriptor,
            adapterAdmissionReceiptSha256,
          );
          providerReachable = true;
          handle = await this.#runner.createInert(
            this.#adapterContext(
              ctx,
              descriptor,
              adapterAdmissionReceiptSha256,
              finalBarrierReceiptSha256,
            ),
            input.spec,
            op,
            input.allocation_key_sha256,
          );
        } catch (error) {
          if (!providerReachable) throw error;
          const nonAcceptanceProof = await this.#verifiedProviderNonAcceptance(
            error,
            ctx,
            descriptor,
          );
          if (nonAcceptanceProof !== undefined) {
            await this.#markFailed(
              initial.id,
              ctx.operation_id,
              ctx.transition.successor_resource_lifecycle_generation,
              nonAcceptanceProof.provider_receipt_sha256,
              nonAcceptanceProof.verification_receipt_sha256,
            );
            throw new SandboxError("provider_unavailable", "Provider rejected inert creation without an effect");
          }
          const readProbe = await this.#readProbeOperation(ctx, op, descriptor);
          existingReadProbe = readProbe;
          await this.#assertCurrentEffectGuard(ctx, readProbe);
          await this.#assertCurrentAdapterAdmission(
            descriptor,
            adapterAdmissionReceiptSha256,
          );
          const observation = await this.#runner.lookupOperation(
            this.#reconcileContext(ctx, descriptor, readProbe),
            readProbe,
          );
          if (observation.state !== "completed" || observation.handle === undefined) {
            return { kind: "unknown" as const, reason: "ambiguous_provider_state" as const };
          }
          handle = observation.handle;
          exactOperationLookupComplete = true;
        }
      }
      try {
        this.#assertCreatedHandle(handle, initial, ctx, descriptor);
        await this.#verifyExactOwnedResource(
          ctx,
          descriptor,
          adapterAdmissionReceiptSha256,
          handle,
          op,
          "inert",
          exactOperationLookupComplete,
          existingReadProbe,
        );
      } catch {
        return { kind: "unknown" as const, reason: "provider_identity_mismatch" as const };
      }
      const providerReceiptSha256 = canonicalDigest({
        resource_id: handle.resource_id,
        provider_creation_token_sha256: handle.provider_creation_token_sha256,
        creation_receipt_sha256: handle.creation_receipt_sha256,
        immutable_fingerprint_sha256: handle.immutable_fingerprint_sha256,
        provider_identity_sha256: handle.provider_identity_sha256,
      });
      const recoveredOutcome = mustReconcile
        ? await this.#readAuthenticatedExistingOutcome(ctx)
        : undefined;
      if (
        recoveredOutcome !== undefined &&
        (
          recoveredOutcome.record.outcome_kind !== "succeeded" ||
          recoveredOutcome.record.outcome_sha256 !== providerReceiptSha256
        )
      ) {
        return { kind: "unknown" as const, reason: "provider_identity_mismatch" as const };
      }
      const createOutcomeAnchor = recoveredOutcome === undefined
        ? await this.#anchorOutcome(ctx.operation_id, "succeeded", providerReceiptSha256)
        : providerOutcomeAnchorDigest(recoveredOutcome);
      const sandbox = await this.#commitCreateProviderOutcome(
        initial.id,
        ctx,
        handle,
        providerReceiptSha256,
        createOutcomeAnchor,
      );
      return { kind: "succeeded" as const, sandbox };
    });
    if (providerResult.kind === "unknown") {
      return this.#markUnknown(
        initial.id,
        ctx.operation_id,
        providerResult.reason,
        ctx.transition.successor_resource_lifecycle_generation,
      );
    }
    return providerResult.sandbox;
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
    await this.#assertGrantFresh(grant.expires_at);
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
    const adapter = await this.#verifiedDescriptor();
    const { descriptor, admission_receipt_sha256: adapterAdmissionReceiptSha256 } = adapter;
    await this.#repository.transaction((tx) => {
      this.#assertPersistedDescriptor(
        this.#mustSandbox(tx, resourceId),
        descriptor,
        adapterAdmissionReceiptSha256,
      );
    });

    const reservation = await this.#repository.transaction((tx) => {
      const current = this.#mustSandbox(tx, resourceId);
      const replay = this.#resolveReplay(tx, ctx, "begin_activate", resourceId);
      if (replay !== undefined) {
        if (replay.state === "committed") {
          return { operation: replay, replay: true, current, recover_external_dispatch: false };
        }
        if (["prepared", "dispatched"].includes(replay.effect_phase)) {
          return {
            operation: replay,
            replay: false,
            current,
            recover_external_dispatch: replay.effect_phase === "dispatched",
          };
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
          recover_external_dispatch: false,
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
      if (operation.replay) {
        return { ...operation, current, recover_external_dispatch: false };
      }
      tx.consumeActivationGrant(activationGrantUse, ctx.operation_id);
      const sealed = tx.getHandle(resourceId);
      if (sealed === undefined) throw new SandboxError("integrity_failed", "Inert handle receipt is missing");
      const predecessorHandle = this.#openStoredHandle(sealed, current);
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
      return { ...operation, current: activating, recover_external_dispatch: false };
    });
    if (reservation.replay) return this.get(resourceId);
    const sealed = await this.#repository.transaction((tx) => tx.getHandle(resourceId));
    if (sealed === undefined) throw new SandboxError("integrity_failed", "Inert handle receipt is missing");
    const handle = this.#openStoredHandle(sealed, reservation.current);
    this.#assertHandleGeneration(handle, ctx);
    this.#assertPersistedDescriptor(
      reservation.current,
      descriptor,
      adapterAdmissionReceiptSha256,
    );
    const mutation = this.#providerOperation("activate", ctx);
    const providerResult = await this.#withProviderLifecycleLock(ctx, descriptor, handle, async () => {
      const recoveredDispatch = reservation.recover_external_dispatch
        ? await this.#recoverExternalDispatch(ctx)
        : undefined;
      if (recoveredDispatch?.disposition === "already_present") {
        const recoveredOutcome = await this.#readAuthenticatedExistingOutcome(ctx);
        if (recoveredOutcome?.record.outcome_kind !== "succeeded") {
          return { kind: "unknown" as const, reason: "ambiguous_provider_state" as const };
        }
        try {
          await this.#verifyExactOwnedResource(
            ctx,
            descriptor,
            adapterAdmissionReceiptSha256,
            handle,
            mutation,
            "active",
            true,
          );
        } catch {
          return { kind: "unknown" as const, reason: "provider_identity_mismatch" as const };
        }
        const sandbox = await this.#commitActivationProviderOutcome(
          resourceId,
          ctx,
          recoveredOutcome.record.outcome_sha256,
          providerOutcomeAnchorDigest(recoveredOutcome),
          recoveredOutcome.record.recorded_at,
        );
        return { kind: "succeeded" as const, sandbox };
      }
      let providerReachable = false;
      let activationReceipt: ActivationReceiptV1 | undefined;
      let activationOutcomeAnchor: Digest | undefined;
      try {
        await this.#verifyDispatched(ctx, recoveredDispatch?.disposition === "inserted");
        providerReachable = true;
        await this.#verifyExactOwnedResource(
          ctx,
          descriptor,
          adapterAdmissionReceiptSha256,
          handle,
          mutation,
          "inert",
          true,
        );
        const finalBarrierReceiptSha256 = await this.#assertFinalProviderMutationBarrier(
          ctx,
          descriptor,
          adapterAdmissionReceiptSha256,
          handle,
          grant.expires_at,
        );
        activationReceipt = await this.#runner.activate(
          this.#adapterContext(
            ctx,
            descriptor,
            adapterAdmissionReceiptSha256,
            finalBarrierReceiptSha256,
          ),
          handle,
          grant,
          mutation,
        );
        if (
          activationReceipt.immutable_fingerprint_sha256 !== handle.immutable_fingerprint_sha256 ||
          activationReceipt.network_policy_sha256 !== grant.network_policy_sha256 ||
          activationReceipt.network_policy_sha256 !== reservation.current.spec.network_policy.policy_sha256
        ) {
          return { kind: "unknown" as const, reason: "provider_identity_mismatch" as const };
        }
        await this.#verifyExactOwnedResource(
          ctx,
          descriptor,
          adapterAdmissionReceiptSha256,
          handle,
          mutation,
          "active",
          true,
        );
        activationOutcomeAnchor = await this.#anchorOutcome(
          ctx.operation_id,
          "succeeded",
          activationReceipt.receipt_sha256,
        );
      } catch (error) {
        if (!providerReachable) throw error;
        const nonAcceptanceProof = await this.#verifiedProviderNonAcceptance(error, ctx, descriptor);
        if (nonAcceptanceProof !== undefined) {
          await this.#markFailed(
            resourceId,
            ctx.operation_id,
            ctx.transition.successor_resource_lifecycle_generation,
            nonAcceptanceProof.provider_receipt_sha256,
            nonAcceptanceProof.verification_receipt_sha256,
          );
          throw new SandboxError("provider_unavailable", "Provider rejected activation without an effect");
        }
        return {
          kind: "unknown" as const,
          reason: error instanceof ProviderIdentityMismatchError
            ? "provider_identity_mismatch" as const
            : "ambiguous_provider_state" as const,
        };
      }
      if (activationReceipt === undefined || activationOutcomeAnchor === undefined) {
        throw new SandboxError("integrity_failed", "Activation success lost its signed outcome");
      }
      const sandbox = await this.#commitActivationProviderOutcome(
        resourceId,
        ctx,
        activationReceipt.receipt_sha256,
        activationOutcomeAnchor,
        activationReceipt.activated_at,
      );
      return { kind: "succeeded" as const, sandbox };
    });
    if (providerResult.kind === "unknown") {
      return this.#markUnknown(
        resourceId,
        ctx.operation_id,
        providerResult.reason,
        ctx.transition.successor_resource_lifecycle_generation,
      );
    }
    return providerResult.sandbox;
  }

  async expire(resourceId: string, contextValue: MutationContextV1): Promise<SandboxV1> {
    assertOpaqueId(resourceId, "resource_id", "sbx");
    const ctx = await this.#authorizeProvider("expire", resourceId, expireRequestDigest(resourceId), contextValue);
    const adapter = await this.#verifiedDescriptor();
    const { descriptor, admission_receipt_sha256: adapterAdmissionReceiptSha256 } = adapter;
    await this.#repository.transaction((tx) => {
      this.#assertPersistedDescriptor(
        this.#mustSandbox(tx, resourceId),
        descriptor,
        adapterAdmissionReceiptSha256,
      );
    });
    const reservation = await this.#repository.transaction((tx) => {
      const current = this.#mustSandbox(tx, resourceId);
      const replay = this.#resolveReplay(tx, ctx, "expire", resourceId);
      if (replay !== undefined) {
        if (replay.state === "committed") {
          return { operation: replay, replay: true, current, recover_external_dispatch: false };
        }
        if (["prepared", "dispatched"].includes(replay.effect_phase)) {
          return {
            operation: replay,
            replay: false,
            current,
            recover_external_dispatch: replay.effect_phase === "dispatched",
          };
        }
        throw new SandboxError("provider_state_unknown", "The original expiry operation is unresolved");
      }
      const retry = this.#retryFailedNoEffect(tx, "expire", current, ctx, "expiring");
      if (retry !== undefined) {
        return {
          operation: retry,
          replay: false,
          current: this.#mustSandbox(tx, resourceId),
          recover_external_dispatch: false,
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
      if (operation.replay) {
        return { ...operation, current, recover_external_dispatch: false };
      }
      const sealed = tx.getHandle(resourceId);
      if (sealed === undefined) throw new SandboxError("integrity_failed", "Provider handle is missing");
      const predecessorHandle = this.#openStoredHandle(sealed, current);
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
      return { ...operation, current: expiring, recover_external_dispatch: false };
    });
    if (reservation.replay) return this.get(resourceId);
    const sealed = await this.#repository.transaction((tx) => tx.getHandle(resourceId));
    if (sealed === undefined) throw new SandboxError("integrity_failed", "Provider handle is missing");
    const handle = this.#openStoredHandle(sealed, reservation.current);
    this.#assertHandleGeneration(handle, ctx);
    this.#assertPersistedDescriptor(
      reservation.current,
      descriptor,
      adapterAdmissionReceiptSha256,
    );
    const mutation = this.#providerOperation("expire", ctx);
    const providerResult = await this.#withProviderLifecycleLock(ctx, descriptor, handle, async () => {
      const recoveredDispatch = reservation.recover_external_dispatch
        ? await this.#recoverExternalDispatch(ctx)
        : undefined;
      if (recoveredDispatch?.disposition === "already_present") {
        const recoveredOutcome = await this.#readAuthenticatedExistingOutcome(ctx);
        if (recoveredOutcome?.record.outcome_kind !== "succeeded") {
          return { kind: "unknown" as const };
        }
        try {
          await this.#verifyExactOwnedResource(
            ctx,
            descriptor,
            adapterAdmissionReceiptSha256,
            handle,
            mutation,
            "inert",
            true,
          );
        } catch {
          return { kind: "unknown" as const };
        }
        const sandbox = await this.#commitExpireProviderOutcome(
          resourceId,
          ctx,
          providerOutcomeAnchorDigest(recoveredOutcome),
        );
        return { kind: "succeeded" as const, sandbox };
      }
      let providerReachable = false;
      let expireOutcomeAnchor: Digest | undefined;
      try {
        await this.#verifyDispatched(ctx, recoveredDispatch?.disposition === "inserted");
        providerReachable = true;
        await this.#verifyExactOwnedResource(
          ctx,
          descriptor,
          adapterAdmissionReceiptSha256,
          handle,
          mutation,
          "active",
          true,
        );
        const finalBarrierReceiptSha256 = await this.#assertFinalProviderMutationBarrier(
          ctx,
          descriptor,
          adapterAdmissionReceiptSha256,
          handle,
        );
        const expireReceipt = await this.#runner.expire(
          this.#adapterContext(
            ctx,
            descriptor,
            adapterAdmissionReceiptSha256,
            finalBarrierReceiptSha256,
          ),
          handle,
          mutation,
        );
        if (!['inert', 'quarantined'].includes(expireReceipt.state)) {
          return { kind: "unknown" as const };
        }
        await this.#verifyExactOwnedResource(
          ctx,
          descriptor,
          adapterAdmissionReceiptSha256,
          handle,
          mutation,
          "inert",
          true,
        );
        expireOutcomeAnchor = await this.#anchorOutcome(
          ctx.operation_id,
          "succeeded",
          expireReceipt.receipt_sha256,
        );
      } catch (error) {
        if (!providerReachable) throw error;
        const nonAcceptanceProof = await this.#verifiedProviderNonAcceptance(error, ctx, descriptor);
        if (nonAcceptanceProof !== undefined) {
          await this.#markFailed(
            resourceId,
            ctx.operation_id,
            ctx.transition.successor_resource_lifecycle_generation,
            nonAcceptanceProof.provider_receipt_sha256,
            nonAcceptanceProof.verification_receipt_sha256,
          );
          throw new SandboxError("provider_unavailable", "Provider rejected expiry without an effect");
        }
        return { kind: "unknown" as const };
      }
      if (expireOutcomeAnchor === undefined) {
        throw new SandboxError("integrity_failed", "Expiry success lost its signed outcome");
      }
      const sandbox = await this.#commitExpireProviderOutcome(
        resourceId,
        ctx,
        expireOutcomeAnchor,
      );
      return { kind: "succeeded" as const, sandbox };
    });
    if (providerResult.kind === "unknown") {
      return this.#markUnknown(
        resourceId,
        ctx.operation_id,
        "ambiguous_provider_state",
        ctx.transition.successor_resource_lifecycle_generation,
      );
    }
    return providerResult.sandbox;
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
    await this.#assertGrantFresh(grant.expires_at);
    const adapter = await this.#verifiedDescriptor();
    const { descriptor, admission_receipt_sha256: adapterAdmissionReceiptSha256 } = adapter;
    await this.#repository.transaction((tx) => {
      this.#assertPersistedDescriptor(
        this.#mustSandbox(tx, resourceId),
        descriptor,
        adapterAdmissionReceiptSha256,
      );
    });
    if (!descriptor.atomic_incarnation_bound_delete) {
      throw new SandboxError(
        "unsupported_runtime_feature",
        "Cleanup requires provider-native atomic incarnation-bound conditional delete",
      );
    }

    const reservation = await this.#repository.transaction((tx) => {
      const current = this.#mustSandbox(tx, resourceId);
      const replay = this.#resolveReplay(tx, ctx, "begin_destroy", resourceId);
      if (replay !== undefined) {
        if (replay.state === "committed") {
          return { operation: replay, replay: true, current, recover_external_dispatch: false };
        }
        if (["prepared", "dispatched"].includes(replay.effect_phase)) {
          return {
            operation: replay,
            replay: false,
            current,
            recover_external_dispatch: replay.effect_phase === "dispatched",
          };
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
          recover_external_dispatch: false,
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
      this.#assertCleanupBasis(tx, current, grant);
      const operation = this.#reserve(tx, "begin_destroy", resourceId, ctx);
      if (operation.replay) {
        return { ...operation, current, recover_external_dispatch: false };
      }
      tx.updateOperation({
        ...operation.operation,
        cleanup_authorization: {
          cleanup_grant_sha256: canonicalDigest(grant),
          basis_kind: grant.basis.kind,
          basis_receipt_sha256: grant.basis.receipt_sha256,
        },
        updated_at: this.#txNow(tx),
      });
      tx.consumeCleanupGrant(cleanupGrantUse, ctx.operation_id);
      const predecessorSealed = tx.getHandle(resourceId);
      if (predecessorSealed === undefined) {
        throw new SandboxError("cleanup_grant_mismatch", "Cleanup target handle disappeared");
      }
      const predecessorHandle = this.#openStoredHandle(predecessorSealed, current);
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
      return { ...operation, current: destroying, recover_external_dispatch: false };
    });
    if (reservation.replay) return this.get(resourceId);

    const sealed = await this.#repository.transaction((tx) => tx.getHandle(resourceId));
    if (sealed === undefined) {
      return this.#quarantineCleanup(
        resourceId,
        ctx.operation_id,
        "provider_identity_mismatch",
        ctx.transition.successor_resource_lifecycle_generation,
      );
    }
    const handle = this.#openStoredHandle(sealed, reservation.current);
    this.#assertHandleGeneration(handle, ctx);
    const providerOp = this.#providerOperation("destroy", ctx);
    this.#assertPersistedDescriptor(
      reservation.current,
      descriptor,
      adapterAdmissionReceiptSha256,
    );
    const providerResult = await this.#withProviderLifecycleLock(ctx, descriptor, handle, async () => {
      const recoveredDispatch = reservation.recover_external_dispatch
        ? await this.#recoverExternalDispatch(ctx)
        : undefined;
      if (recoveredDispatch?.disposition === "already_present") {
        const recoveredOutcome = await this.#readAuthenticatedExistingOutcome(ctx);
        if (
          recoveredOutcome === undefined ||
          !["succeeded", "failed_effect"].includes(recoveredOutcome.record.outcome_kind)
        ) {
          return { kind: "unknown" as const, identity_mismatch: false };
        }
        const absent = recoveredOutcome.record.outcome_kind === "succeeded";
        try {
          if (absent) {
            await this.#verifyExactAbsence(
              ctx,
              descriptor,
              adapterAdmissionReceiptSha256,
              handle,
              providerOp,
            );
          } else {
            await this.#verifyExactOwnedResource(
              ctx,
              descriptor,
              adapterAdmissionReceiptSha256,
              handle,
              providerOp,
              ["inert", "active"],
              true,
            );
          }
        } catch {
          return { kind: "unknown" as const, identity_mismatch: true };
        }
        const observation: DestroyObservationV1 = {
          state: absent ? "absent" : "still_present",
          provider_receipt_sha256: recoveredOutcome.record.outcome_sha256,
          observed_at: recoveredOutcome.record.recorded_at,
        };
        const sandbox = await this.#commitDestroyProviderOutcome(
          resourceId,
          ctx,
          grant,
          observation,
          providerOutcomeAnchorDigest(recoveredOutcome),
        );
        return { kind: "resolved" as const, sandbox };
      }
      let providerReachable = false;
      let destroyObservation: DestroyObservationV1 | undefined;
      let destroyOutcomeAnchor: Digest | undefined;
      try {
        await this.#verifyDispatched(ctx, recoveredDispatch?.disposition === "inserted");
        providerReachable = true;
        await this.#verifyExactOwnedResource(
          ctx,
          descriptor,
          adapterAdmissionReceiptSha256,
          handle,
          providerOp,
          ["inert", "active"],
          true,
        );
        const finalBarrierReceiptSha256 = await this.#assertFinalProviderMutationBarrier(
          ctx,
          descriptor,
          adapterAdmissionReceiptSha256,
          handle,
          grant.expires_at,
        );
        const destroyContext: DestroyContextV1 = {
          ...this.#adapterContext(
            ctx,
            descriptor,
            adapterAdmissionReceiptSha256,
            finalBarrierReceiptSha256,
          ),
          cleanup_grant_sha256: canonicalDigest(grant),
          cleanup_basis_receipt_sha256: grant.basis.receipt_sha256,
        };
        destroyObservation = await this.#runner.destroy(destroyContext, handle, providerOp);
        if (destroyObservation.state === "unknown") return { kind: "unknown" as const };
        if (destroyObservation.state === "absent") {
          await this.#verifyExactAbsence(
            ctx,
            descriptor,
            adapterAdmissionReceiptSha256,
            handle,
            providerOp,
          );
        } else {
          await this.#verifyExactOwnedResource(
            ctx,
            descriptor,
            adapterAdmissionReceiptSha256,
            handle,
            providerOp,
            ["inert", "active"],
            true,
          );
        }
        destroyOutcomeAnchor = await this.#anchorOutcome(
          ctx.operation_id,
          destroyObservation.state === "absent" ? "succeeded" : "failed_effect",
          destroyObservation.provider_receipt_sha256,
        );
      } catch (error) {
        if (!providerReachable) throw error;
        const nonAcceptanceProof = await this.#verifiedProviderNonAcceptance(error, ctx, descriptor);
        if (nonAcceptanceProof !== undefined) {
          await this.#markFailed(
            resourceId,
            ctx.operation_id,
            ctx.transition.successor_resource_lifecycle_generation,
            nonAcceptanceProof.provider_receipt_sha256,
            nonAcceptanceProof.verification_receipt_sha256,
          );
          throw new SandboxError("provider_unavailable", "Provider rejected cleanup without an effect");
        }
        return {
          kind: "unknown" as const,
          identity_mismatch:
            error instanceof ProviderIdentityMismatchError ||
            (error instanceof SandboxError && error.code === "integrity_failed"),
        };
      }
      if (destroyObservation === undefined || destroyOutcomeAnchor === undefined) {
        throw new SandboxError("integrity_failed", "Cleanup success lost its signed outcome");
      }
      const sandbox = await this.#commitDestroyProviderOutcome(
        resourceId,
        ctx,
        grant,
        destroyObservation,
        destroyOutcomeAnchor,
      );
      return { kind: "resolved" as const, sandbox };
    });
    if (providerResult.kind === "unknown") {
      return this.#quarantineCleanup(
        resourceId,
        ctx.operation_id,
        providerResult.identity_mismatch === true
          ? "provider_identity_mismatch"
          : "ambiguous_provider_state",
        ctx.transition.successor_resource_lifecycle_generation,
        "cleanup_failed",
      );
    }
    return providerResult.sandbox;
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
      ["creating_inert", "inert", "activating", "active", "expiring", "lost"],
      "quarantined",
      "ambiguous_provider_state",
      false,
    );
  }

  async get(resourceId: string): Promise<SandboxV1> {
    assertOpaqueId(resourceId, "resource_id", "sbx");
    return await this.#repository.transaction((tx) => this.#mustSandbox(tx, resourceId));
  }

  async list(): Promise<SandboxV1[]> {
    return await this.#repository.transaction((tx) => tx.listSandboxes());
  }

  async events(resourceId: string): Promise<SandboxEventV1[]> {
    assertOpaqueId(resourceId, "resource_id", "sbx");
    return await this.#repository.transaction((tx) => tx.listEvents(resourceId));
  }

  async resolveOperation(operationId: string): Promise<OperationResolutionV1> {
    assertOpaqueId(operationId, "operation_id", "op");
    const operation = await this.#repository.transaction((tx) => tx.getOperation(operationId));
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
    return await this.#withSandboxLifecycleGate(resourceId, async () =>
      this.#repository.transaction((tx) => {
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
      tx.putCheckpointReceipt(receipt);
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
      }),
    );
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
    return await this.#withSandboxLifecycleGate(resourceId, async () =>
      this.#repository.transaction((tx) => {
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
      tx.putGitPromotionReceipt(receipt);
      if (current.git_promotion_receipt_sha256.includes(receipt.receipt_sha256)) return current;
      const updated: SandboxV1 = {
        ...current,
        revision: current.revision + 1,
        git_promotion_receipt_sha256: [...current.git_promotion_receipt_sha256, receipt.receipt_sha256],
      };
      tx.putSandbox(updated, current.revision);
      return updated;
      }),
    );
  }

  async expiredCandidates(): Promise<SandboxV1[]> {
    const now = (await this.#repository.databaseTime()).getTime();
    return (await this.list()).filter(
      (sandbox) =>
        Date.parse(sandbox.expires_at) <= now &&
        ["creating_inert", "inert", "activating", "active", "expiring", "failed"].includes(sandbox.state),
    );
  }

  async observeExpired(resourceId: string): Promise<ReconcileFindingV1> {
    assertOpaqueId(resourceId, "resource_id", "sbx");
    return await this.#withSandboxLifecycleGate(resourceId, async () => {
    const now = await this.#repository.databaseTime();
    const snapshot = await this.#repository.transaction((tx) => this.#mustSandbox(tx, resourceId));
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
    return await this.#repository.transaction((tx) => {
      const current = this.#mustSandbox(tx, resourceId);
      if (Date.parse(current.expires_at) > now.getTime()) {
        throw new SandboxError("policy_denied", "Sandbox TTL has not expired");
      }
      const observationId = createOpaqueId("observation");
      this.#appendSafetyObservation(tx, observationId, safetyObservation);
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
    });
  }

  async reconcileExpired(
    resourceId: string,
    contextValue: LifecycleCommandContextV1,
  ): Promise<ReconcileFindingV1> {
    assertOpaqueId(resourceId, "resource_id", "sbx");
    const snapshot = await this.get(resourceId);
    const ctx = await this.#authorizeLifecycle(
      "quarantine",
      resourceId,
      quarantineRequestDigest(resourceId, snapshot.expires_at),
      contextValue,
    );
    return await this.#withSandboxLifecycleGate(resourceId, async () => {
    if (Date.parse(snapshot.expires_at) > (await this.#repository.databaseTime()).getTime()) {
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
    const now = await this.#repository.databaseTime();
    return await this.#repository.transaction((tx) => {
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
        current,
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
    return await this.#withSandboxLifecycleGate(resourceId, async () =>
      this.#repository.transaction((tx) => {
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
        current,
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
              destroyed_at: pending?.observed_at ?? this.#txNow(tx),
              ...(pending?.terminal_disposition === undefined
                ? {}
                : { terminal_disposition: pending.terminal_disposition }),
            }
          : {}),
      };
      tx.putSandbox(completed, current.revision);
      if (targetState === "destroyed") {
        if (pending === undefined) {
          throw new SandboxError("integrity_failed", "Destroyed state requires the anchored provider outcome");
        }
        this.#putDestroyTombstone(tx, current, completed, pending, ctx);
      }
      this.#commitOperation(tx, ctx.operation_id, canonicalDigest(completed));
      this.#event(tx, completed, ctx.operation_id, "operation_committed");
      return completed;
      }),
    );
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
    await this.#assertFenceFresh(fence);
    await this.#assertWindow(capability.not_before, capability.expires_at, "capability_denied");
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
    const dispatchRecord = dispatchJournal.record;
    const priorOperation = await this.#repository.transaction((tx) => tx.getOperation(base.operation_id));
    const priorFailedNoEffectAuthorization = priorOperation?.effect_phase === "failed_no_effect"
      ? priorOperation.provider_target?.authorization_consumption_receipt_sha256
      : undefined;
    const authorizationReceipt = expectedAuthorizationReceipt ??
      priorFailedNoEffectAuthorization ??
      this.#capabilityUseDigest(base.capability);
    if (
      dispatchRecord.operation_id !== base.fence.operation_id ||
      dispatchRecord.outcome_schema_version !== EFFECT_JOURNAL_OUTCOME_SCHEMA_VERSION ||
      dispatchRecord.outcome_schema_digest !== EFFECT_JOURNAL_OUTCOME_SCHEMA_DIGEST ||
      dispatchRecord.operation_execution_epoch !== base.fence.operation_execution_epoch ||
      dispatchRecord.operation_digest !== base.fence.operation_digest ||
      dispatchRecord.resource_id !== base.fence.resource_id ||
      dispatchRecord.authority_epoch !== base.fence.authority_epoch ||
      dispatchRecord.expected_resource_lifecycle_generation !==
        base.transition.expected_resource_lifecycle_generation ||
      dispatchRecord.successor_resource_lifecycle_generation !==
        base.transition.successor_resource_lifecycle_generation ||
      canonicalDigest(dispatchRecord.fence) !== canonicalDigest(base.fence) ||
      dispatchRecord.authorization_consumption_receipt_sha256 !== authorizationReceipt ||
      dispatchRecord.provider_idempotency_token_sha256 !== providerIdempotencyTokenDigest({
        operation_id: dispatchRecord.operation_id,
        operation_step_id: dispatchRecord.operation_step_id,
        operation_digest: dispatchRecord.operation_digest,
        resource_id: dispatchRecord.resource_id,
        provider_creation_token_sha256: dispatchRecord.provider_creation_token_sha256,
      }) ||
      base.capability.dispatch_journal_anchor_sha256 !== dispatchedJournalAnchorDigest(dispatchJournal)
    ) {
      throw new SandboxError("integrity_failed", "DISPATCHED journal anchor does not bind the exact transition, authorization, and fence");
    }
    const failedNoEffectRetryProof = priorOperation?.effect_phase === "failed_no_effect"
      ? await this.#authenticatePriorFailedNoEffect(priorOperation)
      : undefined;
    return {
      ...base,
      dispatch_journal: dispatchJournal,
      ...(failedNoEffectRetryProof === undefined
        ? {}
        : { failed_no_effect_retry_proof: failedNoEffectRetryProof }),
    };
  }

  async #authenticatePriorFailedNoEffect(
    prior: OperationRecordV1,
  ): Promise<NonNullable<NormalizedMutationContext["failed_no_effect_retry_proof"]>> {
    if (
      prior.effect_phase !== "failed_no_effect" ||
      prior.operation_step_id === undefined ||
      prior.dispatch_journal_anchor_sha256 === undefined ||
      prior.outcome_anchor_sha256 === undefined ||
      prior.provider_target === undefined
    ) {
      throw new SandboxError(
        "provider_state_unknown",
        "failed_no_effect retry lacks a complete prior mutation identity",
      );
    }
    const records = await this.#repository.transaction((tx) => tx.listExternalAnchors(prior.operation_id));
    const priorDispatches = records.filter((record) =>
      "record_kind" in record &&
      record.record_kind === "DISPATCHED" &&
      record.operation_step_id === prior.operation_step_id &&
      record.operation_execution_epoch === prior.fence.operation_execution_epoch
    );
    const priorOutcomes = records.filter((record) =>
      "record_kind" in record &&
      record.record_kind === "OUTCOME" &&
      record.operation_step_id === prior.operation_step_id &&
      record.operation_execution_epoch === prior.fence.operation_execution_epoch
    );
    const priorDispatch = priorDispatches[0];
    const priorOutcome = priorOutcomes[0];
    if (
      priorDispatches.length !== 1 ||
      priorOutcomes.length !== 1 ||
      priorDispatch === undefined ||
      priorOutcome === undefined ||
      !("record_kind" in priorOutcome) ||
      priorOutcome.record_kind !== "OUTCOME" ||
      priorOutcome.outcome_kind !== "failed_no_effect" ||
      priorDispatch.envelope_digest !== prior.dispatch_journal_anchor_sha256 ||
      priorOutcome.envelope_digest !== prior.outcome_anchor_sha256 ||
      records.some((record) =>
        "record_kind" in record &&
        record.record_kind === "DISPATCHED" &&
        record.operation_step_id === prior.operation_step_id &&
        record.operation_execution_epoch > prior.fence.operation_execution_epoch
      )
    ) {
      throw new SandboxError(
        "provider_state_unknown",
        "higher execution epoch requires one exact prior DISPATCHED and failed_no_effect OUTCOME",
      );
    }
    const { range: recoveryRange } = await this.#verifiedJournalRecoveryRange({
      operation_id: prior.operation_id,
      operation_step_id: prior.operation_step_id,
      requested_from_sequence: priorDispatch.journal_sequence,
    });
    const recoveredDispatches = recoveryRange.complete_operation_envelopes.filter((anchor) =>
      "record_kind" in anchor.record &&
      anchor.record.record_kind === "DISPATCHED" &&
      anchor.record.operation_execution_epoch === prior.fence.operation_execution_epoch
    );
    const recoveredOutcomes = recoveryRange.complete_operation_envelopes.filter((anchor) =>
      "record_kind" in anchor.record &&
      anchor.record.record_kind === "OUTCOME" &&
      anchor.record.operation_execution_epoch === prior.fence.operation_execution_epoch
    );
    if (
      recoveredDispatches.length !== 1 ||
      recoveredOutcomes.length !== 1 ||
      canonicalDigest(recoveredDispatches[0]) !== prior.dispatch_journal_anchor_sha256 ||
      canonicalDigest(recoveredOutcomes[0]) !== prior.outcome_anchor_sha256 ||
      recoveryRange.complete_operation_envelopes.some((anchor) =>
        "record_kind" in anchor.record &&
        anchor.record.record_kind === "DISPATCHED" &&
        anchor.record.operation_execution_epoch > prior.fence.operation_execution_epoch
      )
    ) {
      throw new SandboxError(
        "provider_state_unknown",
        "signed journal head/range proof does not establish the complete prior failed_no_effect step",
      );
    }
    const rereadValue = await this.#outcomeJournal.readOutcome(prior.outcome_anchor_sha256);
    if (rereadValue === undefined) {
      throw new SandboxError(
        "provider_state_unknown",
        "authoritative prior OUTCOME envelope is unavailable",
      );
    }
    const reread = validateProviderOutcomeAnchor(rereadValue);
    const record = reread.record;
    if (
      canonicalDigest(reread) !== prior.outcome_anchor_sha256 ||
      reread.journal_sequence !== priorOutcome.journal_sequence ||
      reread.prior_frontier_digest !== priorOutcome.prior_frontier_digest ||
      reread.record_digest !== priorOutcome.record_digest ||
      reread.frontier_digest !== priorOutcome.frontier_digest ||
      record.operation_id !== prior.operation_id ||
      record.operation_step_id !== prior.operation_step_id ||
      record.operation_execution_epoch !== prior.fence.operation_execution_epoch ||
      record.dispatch_anchor_sha256 !== prior.dispatch_journal_anchor_sha256 ||
      record.outcome_kind !== "failed_no_effect" ||
      canonicalDigest(record.fence) !== canonicalDigest(prior.fence) ||
      canonicalDigest(record.target) !== canonicalDigest(prior.provider_target)
    ) {
      throw new SandboxError(
        "provider_state_unknown",
        "authoritative prior failed_no_effect envelope does not bind the stored mutation",
      );
    }
    const authenticated = await this.#verifier.verifyProviderOutcomeAnchor(reread, prior.fence);
    this.#assertAuthenticatedJournalBindings(authenticated, reread, prior.fence);
    return {
      prior_execution_epoch: prior.fence.operation_execution_epoch,
      outcome_envelope_digest: canonicalDigest(reread),
      outcome_frontier_digest: reread.frontier_digest,
    };
  }

  async #verifiedJournalRecoveryRange(input: {
    operation_id: string;
    operation_step_id: string;
    requested_from_sequence: bigint;
  }): Promise<VerifiedJournalRecoveryRangeV1> {
    const range = await this.#journalRecovery.readOperationStepRange(input);
    assertOpaqueId(range.operation_id, "journal_recovery.operation_id", "op");
    assertOpaqueId(range.operation_step_id, "journal_recovery.operation_step_id", "step");
    assertDigest(range.signed_head_frontier_digest, "journal_recovery.signed_head_frontier_digest");
    assertDigest(range.completeness_proof_sha256, "journal_recovery.completeness_proof_sha256");
    if (
      range.schema_version !== "infinity.effect-journal-recovery-range/v1" ||
      range.operation_id !== input.operation_id ||
      range.operation_step_id !== input.operation_step_id ||
      range.requested_from_sequence !== input.requested_from_sequence ||
      range.requested_from_sequence < 1n ||
      range.signed_head_sequence < 1n ||
      !/^[A-Za-z0-9_-]{86}$/.test(range.signature)
    ) {
      throw new SandboxError("integrity_failed", "Journal recovery range has mismatched closed identity bytes");
    }
    let priorSequence: bigint | undefined;
    const normalized = range.complete_operation_envelopes.map((value) => {
      const anchor = "state" in value.record
        ? value.record.state === "dispatched"
          ? validateDispatchedJournalAnchor(value)
          : validateReadProbeJournalAnchor(value)
        : validateProviderOutcomeAnchor(value);
      if (
        anchor.record.operation_id !== input.operation_id ||
        anchor.record.operation_step_id !== input.operation_step_id ||
        anchor.journal_sequence < input.requested_from_sequence ||
        (priorSequence !== undefined && anchor.journal_sequence <= priorSequence)
      ) {
        throw new SandboxError("integrity_failed", "Journal recovery range is not a complete ordered operation-step projection");
      }
      priorSequence = anchor.journal_sequence;
      return anchor;
    });
    const authenticated = await this.#verifier.verifyJournalRecoveryRange(range);
    assertDigest(authenticated.range_sha256, "journal_recovery_auth.range_sha256");
    assertDigest(
      authenticated.current_head_frontier_digest,
      "journal_recovery_auth.current_head_frontier_digest",
    );
    assertDigest(
      authenticated.verification_receipt_sha256,
      "journal_recovery_auth.verification_receipt_sha256",
    );
    assertRfc3339(authenticated.verified_at, "journal_recovery_auth.verified_at");
    assertRfc3339(authenticated.expires_at, "journal_recovery_auth.expires_at");
    const authKeys = new Set([
      "schema_version",
      "range_sha256",
      "operation_id",
      "operation_step_id",
      "requested_from_sequence",
      "current_head_sequence",
      "current_head_frontier_digest",
      "current_linearizable_head",
      "complete_range",
      "trusted_signer",
      "verified_at",
      "expires_at",
      "verification_receipt_sha256",
    ]);
    const {
      verification_receipt_sha256: verificationReceiptSha256,
      ...verificationReceiptBytes
    } = authenticated;
    const now = (await this.#repository.databaseTime()).getTime();
    if (
      Object.keys(authenticated).length !== authKeys.size ||
      Object.keys(authenticated).some((key) => !authKeys.has(key)) ||
      authenticated.schema_version !== "infinity.authenticated-journal-recovery-range/v1" ||
      authenticated.range_sha256 !== canonicalDigest(range) ||
      authenticated.operation_id !== range.operation_id ||
      authenticated.operation_step_id !== range.operation_step_id ||
      authenticated.requested_from_sequence !== range.requested_from_sequence ||
      authenticated.current_head_sequence !== range.signed_head_sequence ||
      authenticated.current_head_frontier_digest !== range.signed_head_frontier_digest ||
      authenticated.current_linearizable_head !== true ||
      authenticated.complete_range !== true ||
      authenticated.trusted_signer !== true ||
      verificationReceiptSha256 !== canonicalDigest(verificationReceiptBytes) ||
      Date.parse(authenticated.verified_at) > now ||
      Date.parse(authenticated.expires_at) <= now
    ) {
      throw new SandboxError(
        "integrity_failed",
        "Journal recovery lacks the current linearizable signed head and completeness proof",
      );
    }
    return {
      range: { ...range, complete_operation_envelopes: normalized },
      current_head_noninclusion_receipt_sha256:
        authenticated.verification_receipt_sha256,
    };
  }

  async #readAuthenticatedExistingOutcome(
    ctx: NormalizedMutationContext,
  ): Promise<ProviderOutcomeAnchorV1 | undefined> {
    const expectedDispatchDigest = dispatchedJournalAnchorDigest(ctx.dispatch_journal);
    const { range } = await this.#verifiedJournalRecoveryRange({
      operation_id: ctx.operation_id,
      operation_step_id: ctx.dispatch_journal.record.operation_step_id,
      requested_from_sequence: ctx.dispatch_journal.journal_sequence,
    });
    const dispatches = range.complete_operation_envelopes.filter(
      (anchor): anchor is DispatchedJournalAnchorV1 =>
        "record_kind" in anchor.record &&
        anchor.record.record_kind === "DISPATCHED" &&
        anchor.record.operation_execution_epoch === ctx.fence.operation_execution_epoch,
    );
    const outcomes = range.complete_operation_envelopes.filter(
      (anchor): anchor is ProviderOutcomeAnchorV1 =>
        "record_kind" in anchor.record &&
        anchor.record.record_kind === "OUTCOME" &&
        anchor.record.operation_execution_epoch === ctx.fence.operation_execution_epoch,
    );
    if (
      dispatches.length !== 1 ||
      canonicalDigest(dispatches[0]) !== expectedDispatchDigest ||
      range.complete_operation_envelopes.some(
        (anchor) =>
          "record_kind" in anchor.record &&
          anchor.record.record_kind === "DISPATCHED" &&
          anchor.record.operation_execution_epoch > ctx.fence.operation_execution_epoch,
      ) ||
      outcomes.length > 1
    ) {
      throw new SandboxError(
        "provider_state_unknown",
        "Current signed journal head does not contain one exact dispatch and at most one outcome",
      );
    }
    const recovered = outcomes[0];
    if (recovered === undefined) return undefined;
    const record = recovered.record;
    if (
      record.schema_version !== SCHEMA_VERSION ||
      record.record_kind !== "OUTCOME" ||
      record.outcome_schema_version !== EFFECT_JOURNAL_OUTCOME_SCHEMA_VERSION ||
      record.outcome_schema_digest !== EFFECT_JOURNAL_OUTCOME_SCHEMA_DIGEST ||
      record.operation_id !== ctx.operation_id ||
      record.operation_step_id !== ctx.dispatch_journal.record.operation_step_id ||
      record.operation_execution_epoch !== ctx.fence.operation_execution_epoch ||
      record.dispatch_anchor_sha256 !== expectedDispatchDigest ||
      canonicalDigest(record.fence) !== canonicalDigest(ctx.fence) ||
      canonicalDigest(record.target) !== canonicalDigest(this.#effectTarget(ctx))
    ) {
      throw new SandboxError(
        "integrity_failed",
        "Recovered signed outcome does not bind the exact current provider effect",
      );
    }
    const recoveredDigest = providerOutcomeAnchorDigest(recovered);
    const rereadValue = await this.#outcomeJournal.readOutcome(recoveredDigest);
    if (rereadValue === undefined) {
      throw new SandboxError(
        "provider_state_unknown",
        "Recovered signed outcome is unavailable from the authoritative journal",
      );
    }
    const reread = validateProviderOutcomeAnchor(rereadValue);
    if (providerOutcomeAnchorDigest(reread) !== recoveredDigest) {
      throw new SandboxError(
        "integrity_failed",
        "Recovered range outcome and authoritative journal readback disagree",
      );
    }
    const authenticated = await this.#verifier.verifyProviderOutcomeAnchor(reread, ctx.fence);
    this.#assertAuthenticatedJournalBindings(authenticated, reread, ctx.fence);
    await this.#repository.transaction((tx) => {
      tx.appendExternalAnchor({
        schema_version: SCHEMA_VERSION,
        record_kind: "OUTCOME",
        outcome_schema_version: record.outcome_schema_version,
        outcome_schema_digest: record.outcome_schema_digest,
        operation_id: record.operation_id,
        operation_step_id: record.operation_step_id,
        operation_execution_epoch: record.operation_execution_epoch,
        outcome_kind: record.outcome_kind,
        journal_sequence: reread.journal_sequence,
        prior_frontier_digest: reread.prior_frontier_digest,
        record_digest: reread.record_digest,
        frontier_digest: reread.frontier_digest,
        envelope_digest: recoveredDigest,
        recorded_at: record.recorded_at,
      });
    });
    return reread;
  }

  async #recoverExternalDispatch(
    ctx: NormalizedMutationContext,
  ): Promise<{ disposition: "inserted" | "already_present" }> {
    const dispatchRecord = ctx.dispatch_journal.record;
    const verifiedRange = await this.#verifiedJournalRecoveryRange({
      operation_id: dispatchRecord.operation_id,
      operation_step_id: dispatchRecord.operation_step_id,
      requested_from_sequence: ctx.dispatch_journal.journal_sequence,
    });
    const result = await this.#dispatchJournal.recoverDispatched({
      anchor: ctx.dispatch_journal,
      current_head_noninclusion_receipt_sha256:
        verifiedRange.current_head_noninclusion_receipt_sha256,
    });
    if (
      !["inserted", "already_present"].includes(result.disposition) ||
      result.current_head_receipt_sha256 !==
        verifiedRange.current_head_noninclusion_receipt_sha256 ||
      canonicalDigest(validateDispatchedJournalAnchor(result.anchor)) !==
        canonicalDigest(ctx.dispatch_journal)
    ) {
      throw new SandboxError(
        "integrity_failed",
        "Atomic dispatch recovery returned a conflicting disposition or identity",
      );
    }
    await this.#readVerifyStoreDispatched(result.anchor, ctx);
    return { disposition: result.disposition };
  }

  async #verifyDispatched(
    ctx: NormalizedMutationContext,
    recoveredAndInserted = false,
  ): Promise<void> {
    const dispatchRecord = ctx.dispatch_journal.record;
    if (dispatchRecord.state !== "dispatched") {
      throw new SandboxError("capability_denied", "Provider effect lacks a DISPATCHED journal anchor");
    }
    const operation = await this.#repository.transaction((tx) => {
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
          this.#txNow(tx),
        );
      }
      return current;
    });
    if (recoveredAndInserted) {
      await this.#readVerifyStoreDispatched(ctx.dispatch_journal, ctx);
    } else {
      const appendResponse = validateDispatchedJournalAnchor(
        await this.#dispatchJournal.appendDispatched(ctx.dispatch_journal),
      );
      await this.#readVerifyStoreDispatched(appendResponse, ctx);
    }
    if (
      ctx.capability.dispatch_journal_anchor_sha256 !== dispatchedJournalAnchorDigest(ctx.dispatch_journal) ||
      dispatchRecord.operation_id !== ctx.fence.operation_id ||
      dispatchRecord.operation_digest !== ctx.fence.operation_digest ||
      canonicalDigest(dispatchRecord.fence) !== canonicalDigest(ctx.fence)
    ) {
      throw new SandboxError("integrity_failed", "DISPATCHED journal anchor changed before provider dispatch");
    }
    await this.#repository.transaction((tx) => {
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
      dispatch_anchor_sha256: dispatchedJournalAnchorDigest(ctx.dispatch_journal),
    });
  }

  async #readVerifyStoreDispatched(
    appendResponseValue: DispatchedJournalAnchorV1,
    ctx: NormalizedMutationContext,
  ): Promise<void> {
    const appendResponse = validateDispatchedJournalAnchor(appendResponseValue);
    const rereadValue = await this.#dispatchJournal.readDispatched(canonicalDigest(appendResponse));
    if (rereadValue === undefined) {
      throw new SandboxError("integrity_failed", "External journal did not read back the complete DISPATCHED envelope");
    }
    const appended = validateDispatchedJournalAnchor(rereadValue);
    if (
      canonicalDigest(appendResponse) !== canonicalDigest(ctx.dispatch_journal) ||
      canonicalDigest(appended) !== canonicalDigest(appendResponse)
    ) {
      throw new SandboxError("integrity_failed", "External journal returned a conflicting DISPATCHED anchor");
    }
    const authenticated = await this.#verifier.verifyDispatchedJournalAnchor(
      appended,
      ctx.fence,
    );
    this.#assertAuthenticatedJournalBindings(authenticated, appended, ctx.fence);
    const appendedRecord = appended.record;
    await this.#repository.transaction((tx) => {
      tx.appendExternalAnchor({
        schema_version: SCHEMA_VERSION,
        record_kind: "DISPATCHED",
        outcome_schema_version: appendedRecord.outcome_schema_version,
        outcome_schema_digest: appendedRecord.outcome_schema_digest,
        operation_id: appendedRecord.operation_id,
        operation_step_id: appendedRecord.operation_step_id,
        operation_execution_epoch: appendedRecord.operation_execution_epoch,
        journal_sequence: appended.journal_sequence,
        prior_frontier_digest: appended.prior_frontier_digest,
        record_digest: appended.record_digest,
        frontier_digest: appended.frontier_digest,
        envelope_digest: canonicalDigest(appended),
        recorded_at: appendedRecord.recorded_at,
      });
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
      Date.parse(ctx.dispatch_journal.record.expires_at) <= now ||
      Date.parse(ctx.capability.expires_at) <= now ||
      Date.parse(ctx.capability.not_before) > now
    ) {
      throw new SandboxError("lease_expired", "Provider dispatch barrier authorization is not current");
    }
    if (
      operation.cancellation_state !== "open" ||
      operation.dispatch_journal_anchor_sha256 !== dispatchedJournalAnchorDigest(ctx.dispatch_journal) ||
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

  #assertAuthenticatedJournalBindings(
    authenticated: AuthenticatedJournalBindingsV1,
    anchor: DispatchedJournalAnchorV1 | ReadProbeJournalAnchorV1 | ProviderOutcomeAnchorV1,
    fence: CanonicalSandboxEffectFenceV1,
  ): void {
    this.#assertAuthenticatedBindings(authenticated, fence);
    if (
      authenticated.anchor_schema_version !== anchor.anchor_schema_version ||
      authenticated.journal_sequence !== anchor.journal_sequence ||
      authenticated.prior_frontier_digest !== anchor.prior_frontier_digest ||
      authenticated.record_digest !== anchor.record_digest ||
      authenticated.frontier_digest !== anchor.frontier_digest ||
      authenticated.envelope_digest !== canonicalDigest(anchor) ||
      authenticated.signer_principal !== anchor.signer_principal ||
      authenticated.signing_key_id !== anchor.signing_key_id ||
      authenticated.signature_verified !== true ||
      authenticated.contiguous_predecessor_verified !== true ||
      authenticated.stored_frontier_membership !== true
    ) {
      throw new SandboxError(
        "integrity_failed",
        "Journal envelope lacks trusted signature, contiguous predecessor, or stored-frontier membership",
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

  #appendSafetyObservation(
    tx: SandboxRepositoryTxV1,
    observationId: string,
    observation: SafetyFenceObservationV1,
  ): void {
    const record: StoredSafetyFenceObservationV1 = {
      schema_version: SCHEMA_VERSION,
      observation_id: observationId,
      resource_id: observation.resource_id,
      observation_sha256: canonicalDigest(observation),
      observation,
      recorded_at: observation.observed_at,
    };
    tx.appendSafetyFenceObservation(record);
  }

  #putDestroyTombstone(
    tx: SandboxRepositoryTxV1,
    prior: SandboxV1,
    destroyed: SandboxV1,
    pending: NonNullable<SandboxV1["pending_provider_outcome"]>,
    ctx: NormalizedLifecycleContext,
  ): void {
    const destroyOperation = tx.getOperation(pending.source_operation_id);
    const authorization = destroyOperation?.cleanup_authorization;
    if (
      destroyOperation === undefined ||
      authorization === undefined ||
      destroyOperation.outcome_anchor_sha256 !== pending.evidence_sha256 ||
      prior.provider_handle_sha256 === undefined ||
      pending.terminal_disposition === undefined ||
      destroyed.destroyed_at === undefined
    ) {
      throw new SandboxError(
        "integrity_failed",
        "Destroy tombstone lacks its exact grant, handle, outcome, or terminal evidence",
      );
    }
    const protectedBytes = {
      schema_version: "sandboxes.destroy-tombstone/v1" as const,
      tombstone_id: createOpaqueId("tombstone"),
      resource_id: destroyed.id,
      destroy_operation_id: destroyOperation.operation_id,
      record_operation_id: ctx.operation_id,
      expected_resource_lifecycle_generation:
        destroyOperation.expected_resource_lifecycle_generation,
      destroy_resource_lifecycle_generation:
        destroyOperation.successor_resource_lifecycle_generation,
      terminal_resource_lifecycle_generation: destroyed.resource_lifecycle_generation,
      adapter_descriptor_sha256: destroyed.adapter_descriptor_sha256,
      provider_handle_sha256: prior.provider_handle_sha256,
      cleanup_grant_sha256: authorization.cleanup_grant_sha256,
      cleanup_basis_kind: authorization.basis_kind,
      cleanup_basis_receipt_sha256: authorization.basis_receipt_sha256,
      provider_outcome_anchor_sha256: pending.evidence_sha256,
      provider_receipt_sha256: pending.provider_receipt_sha256,
      terminal_disposition: pending.terminal_disposition,
      destroy_fence: destroyOperation.fence,
      record_fence: ctx.fence,
      destroyed_at: destroyed.destroyed_at,
    };
    const tombstone: SandboxDestroyTombstoneV1 = {
      ...protectedBytes,
      tombstone_sha256: canonicalDigest(protectedBytes),
    };
    tx.putDestroyTombstone(tombstone);
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

  async #assertFenceFresh(fence: CanonicalSandboxEffectFenceV1): Promise<void> {
    const now = (await this.#repository.databaseTime()).getTime();
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

  async #assertWindow(notBefore: string, expiresAt: string, code: "capability_denied"): Promise<void> {
    const now = (await this.#repository.databaseTime()).getTime();
    if (Date.parse(notBefore) > now || Date.parse(expiresAt) <= now) {
      throw new SandboxError(code, "Authorization window is not current");
    }
  }

  async #assertGrantFresh(expiresAt: string): Promise<void> {
    if (Date.parse(expiresAt) <= (await this.#repository.databaseTime()).getTime()) {
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

  #assertCleanupBasis(
    tx: SandboxRepositoryTxV1,
    current: SandboxV1,
    grant: InfinityCleanupGrantV1,
  ): void {
    switch (grant.basis.kind) {
      case "checkpoint_durable":
        if (
          !current.durable_checkpoint_receipt_sha256.includes(grant.basis.receipt_sha256) ||
          tx.getCheckpointReceipt(grant.basis.receipt_sha256)?.resource_id !== current.id
        ) {
          throw new SandboxError("checkpoint_not_durable", "Cleanup checkpoint basis is not attached and durable");
        }
        break;
      case "git_promotion":
        if (
          !current.git_promotion_receipt_sha256.includes(grant.basis.receipt_sha256) ||
          tx.getGitPromotionReceipt(grant.basis.receipt_sha256)?.resource_id !== current.id
        ) {
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
      ? dispatchedJournalAnchorDigest(ctx.dispatch_journal)
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
    const now = this.#txNow(tx);
    const capabilityUse = this.#capabilityUseDigest(ctx.capability);
    const record: OperationRecordV1 = {
      schema_version: SCHEMA_VERSION,
      operation_id: ctx.operation_id,
      ...(hasDispatchJournal(ctx)
        ? {
            operation_step_id: ctx.dispatch_journal.record.operation_step_id,
            dispatch_journal_anchor_sha256: dispatchedJournalAnchorDigest(ctx.dispatch_journal),
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
    const retryProof = ctx.failed_no_effect_retry_proof;
    if (
      retryProof === undefined ||
      retryProof.prior_execution_epoch !== prior.fence.operation_execution_epoch ||
      retryProof.outcome_envelope_digest !== prior.outcome_anchor_sha256 ||
      prior.operation !== operationName ||
      prior.resource_id !== current.id ||
      prior.actor_principal !== ctx.fence.actor_principal ||
      prior.request_sha256 !== ctx.request_sha256 ||
      prior.idempotency_key_sha256 !== ctx.idempotency_key_sha256 ||
      prior.operation_step_id !== ctx.dispatch_journal.record.operation_step_id ||
      canonicalDigest(prior.provider_target ?? null) !== canonicalDigest(target) ||
      prior.expected_resource_lifecycle_generation !==
        ctx.transition.expected_resource_lifecycle_generation ||
      prior.successor_resource_lifecycle_generation !==
        ctx.transition.successor_resource_lifecycle_generation ||
      ctx.fence.operation_execution_epoch !== prior.fence.operation_execution_epoch + 1n
    ) {
      throw new SandboxError(
        "idempotency_key_reused",
        "failed_no_effect retry lacks authenticated proof or changed its semantic step, target, request, or execution sequence",
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
      "record_kind" in record &&
      record.record_kind === "DISPATCHED" &&
      record.operation_step_id === prior.operation_step_id &&
      record.operation_execution_epoch === prior.fence.operation_execution_epoch
    );
    const priorOutcome = records.find((record) =>
      "record_kind" in record &&
      record.record_kind === "OUTCOME" &&
      record.operation_step_id === prior.operation_step_id &&
      record.operation_execution_epoch === prior.fence.operation_execution_epoch
    );
    if (
      priorDispatch === undefined ||
      priorOutcome === undefined ||
      !("record_kind" in priorOutcome) ||
      priorOutcome.record_kind !== "OUTCOME" ||
      priorOutcome.outcome_kind !== "failed_no_effect" ||
      priorOutcome.envelope_digest !== prior.outcome_anchor_sha256 ||
      records.some((record) =>
        "record_kind" in record &&
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
      dispatch_journal_anchor_sha256: dispatchedJournalAnchorDigest(ctx.dispatch_journal),
      provider_target: target,
      capability_use_sha256: capabilityUse,
      fence: ctx.fence,
      expected_revision: ctx.expected_revision,
      prepared_resource_revision: preparedSandbox.revision,
      cancellation_state: "open",
      effect_phase: "prepared",
      state: "in_flight",
      updated_at: this.#txNow(tx),
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
      ? dispatchedJournalAnchorDigest(ctx.dispatch_journal)
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

  async #commitCreateProviderOutcome(
    resourceId: string,
    ctx: NormalizedMutationContext,
    handle: OwnedProviderHandleV1,
    providerReceiptSha256: Digest,
    outcomeAnchorSha256: Digest,
  ): Promise<SandboxV1> {
    return await this.#repository.transaction((tx) => {
      const current = this.#mustSandbox(tx, resourceId);
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
        provider_identity_sha256: handle.provider_identity_sha256,
        immutable_fingerprint_sha256: handle.immutable_fingerprint_sha256,
        allocated_at: this.#txNow(tx),
        pending_provider_outcome: {
          source_operation_id: ctx.operation_id,
          target_state: "inert",
          evidence_sha256: outcomeAnchorSha256,
          provider_receipt_sha256: providerReceiptSha256,
          observed_at: this.#txNow(tx),
        },
      };
      tx.putSandbox(outcomePending, current.revision);
      tx.putHandle(sealed);
      this.#commitOperation(
        tx,
        ctx.operation_id,
        canonicalDigest(outcomePending),
        outcomeAnchorSha256,
      );
      this.#event(tx, outcomePending, ctx.operation_id, "operation_committed");
      return outcomePending;
    });
  }

  async #commitActivationProviderOutcome(
    resourceId: string,
    ctx: NormalizedMutationContext,
    providerReceiptSha256: Digest,
    outcomeAnchorSha256: Digest,
    observedAt: string,
  ): Promise<SandboxV1> {
    return await this.#repository.transaction((tx) => {
      const current = this.#mustSandbox(tx, resourceId);
      if (current.state !== "activating") {
        throw new SandboxError("stale_revision", "Activation CAS was superseded");
      }
      const outcomePending: SandboxV1 = {
        ...current,
        revision: current.revision + 1,
        pending_provider_outcome: {
          source_operation_id: ctx.operation_id,
          target_state: "active",
          evidence_sha256: outcomeAnchorSha256,
          provider_receipt_sha256: providerReceiptSha256,
          observed_at: observedAt,
        },
      };
      tx.putSandbox(outcomePending, current.revision);
      this.#commitOperation(
        tx,
        ctx.operation_id,
        canonicalDigest(outcomePending),
        outcomeAnchorSha256,
      );
      this.#event(tx, outcomePending, ctx.operation_id, "operation_committed");
      return outcomePending;
    });
  }

  async #commitExpireProviderOutcome(
    resourceId: string,
    ctx: NormalizedMutationContext,
    outcomeAnchorSha256: Digest,
  ): Promise<SandboxV1> {
    return await this.#repository.transaction((tx) => {
      const current = this.#mustSandbox(tx, resourceId);
      if (current.state !== "expiring") {
        throw new SandboxError("stale_revision", "Expiry CAS was superseded");
      }
      this.#commitOperation(
        tx,
        ctx.operation_id,
        canonicalDigest(current),
        outcomeAnchorSha256,
      );
      this.#event(tx, current, ctx.operation_id, "operation_committed");
      return current;
    });
  }

  async #commitDestroyProviderOutcome(
    resourceId: string,
    ctx: NormalizedMutationContext,
    grant: InfinityCleanupGrantV1,
    observation: DestroyObservationV1,
    outcomeAnchorSha256: Digest,
  ): Promise<SandboxV1> {
    return await this.#repository.transaction((tx) => {
      const current = this.#mustSandbox(tx, resourceId);
      if (current.state !== "destroying") {
        throw new SandboxError("stale_revision", "Cleanup CAS was superseded");
      }
      const absent = observation.state === "absent";
      const outcomePending: SandboxV1 = {
        ...current,
        revision: current.revision + 1,
        pending_provider_outcome: {
          source_operation_id: ctx.operation_id,
          target_state: absent ? "destroyed" : "cleanup_failed",
          evidence_sha256: outcomeAnchorSha256,
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
      this.#commitOperation(
        tx,
        ctx.operation_id,
        canonicalDigest(outcomePending),
        outcomeAnchorSha256,
      );
      this.#event(tx, outcomePending, ctx.operation_id, "operation_committed");
      return outcomePending;
    });
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
      updated_at: this.#txNow(tx),
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
      updated_at: this.#txNow(tx),
    });
  }

  async #markUnknown(
    resourceId: string,
    operationId: string,
    reason: SandboxStateReason,
    _successorGeneration: bigint,
  ): Promise<SandboxV1> {
    return await this.#withSandboxLifecycleGate(resourceId, async () => {
    const observedAt = await this.#now();
    const physicalReason = reason === "provider_identity_mismatch"
      ? "provider_identity_mismatch" as const
      : "provider_ambiguous" as const;
    const snapshot = await this.get(resourceId);
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
    return await this.#repository.transaction((tx) => {
      const current = this.#mustSandbox(tx, resourceId);
      const observationId = createOpaqueId("observation");
      this.#appendSafetyObservation(tx, observationId, safetyObservation);
      const fenced: SandboxV1 = {
        ...current,
        revision: current.revision + 1,
        physical_safety_state: "fenced",
        physical_safety_reason: physicalReason,
        safety_observation_id: observationId,
        safety_fence_receipt_sha256: safetyReceipt,
        canonical_transition_required: "quarantined",
      };
      tx.putSandbox(fenced, current.revision);
      this.#unknownOperation(tx, operationId);
      this.#event(tx, fenced, operationId, "operation_unknown");
      return fenced;
    });
    });
  }

  async #verifiedProviderNonAcceptance(
    error: unknown,
    ctx: NormalizedMutationContext,
    _descriptor: AdapterDescriptorV1,
  ): Promise<{
    provider_receipt_sha256: Digest;
    verification_receipt_sha256: Digest;
  } | undefined> {
    if (!(error instanceof ProviderRejectedNoEffectError) || error.proof === undefined) {
      return undefined;
    }
    try {
      const proof = error.proof;
      const allowed = new Set([
        "schema_version",
        "target",
        "operation_execution_epoch",
        "request_sha256",
        "provider_receipt_sha256",
        "proof_kind",
        "observed_at",
        "expires_at",
        "issuer_principal",
        "signing_key_id",
        "proof_sha256",
        "signature",
      ]);
      if (Object.keys(proof).length !== allowed.size || Object.keys(proof).some((key) => !allowed.has(key))) {
        return undefined;
      }
      assertDigest(proof.request_sha256, "provider_non_acceptance.request_sha256");
      assertDigest(proof.provider_receipt_sha256, "provider_non_acceptance.provider_receipt_sha256");
      assertDigest(proof.proof_sha256, "provider_non_acceptance.proof_sha256");
      assertOpaqueId(proof.issuer_principal, "provider_non_acceptance.issuer_principal", "principal");
      assertOpaqueId(proof.signing_key_id, "provider_non_acceptance.signing_key_id", "key");
      assertRfc3339(proof.observed_at, "provider_non_acceptance.observed_at");
      assertRfc3339(proof.expires_at, "provider_non_acceptance.expires_at");
      const target = this.#effectTarget(ctx);
      const now = (await this.#repository.databaseTime()).getTime();
      if (
        proof.schema_version !== "sandboxes.provider-no-effect-proof/v1" ||
        !["token_not_accepted", "conditional_precondition_rejected"].includes(proof.proof_kind) ||
        proof.operation_execution_epoch !== ctx.fence.operation_execution_epoch ||
        proof.request_sha256 !== ctx.request_sha256 ||
        canonicalDigest(proof.target) !== canonicalDigest(target) ||
        proof.proof_sha256 !== providerNonAcceptanceProofDigest(proof) ||
        !/^[A-Za-z0-9_-]{86}$/.test(proof.signature) ||
        Date.parse(proof.observed_at) < Date.parse(ctx.dispatch_journal.record.recorded_at) ||
        Date.parse(proof.observed_at) > now ||
        Date.parse(proof.expires_at) <= now ||
        Date.parse(proof.expires_at) > Date.parse(ctx.fence.operation_execution_expires_at)
      ) {
        return undefined;
      }
      const authenticated = await this.#verifier.verifyProviderNonAcceptanceProof(proof);
      const receiptKeys = new Set([
        "schema_version",
        "proof_sha256",
        "target_sha256",
        "operation_execution_epoch",
        "request_sha256",
        "provider_receipt_sha256",
        "proof_kind",
        "verified_at",
        "expires_at",
        "verifier_principal",
        "signing_key_id",
        "receipt_sha256",
      ]);
      assertDigest(authenticated.receipt_sha256, "provider_non_acceptance_verification.receipt_sha256");
      assertRfc3339(authenticated.verified_at, "provider_non_acceptance_verification.verified_at");
      assertRfc3339(authenticated.expires_at, "provider_non_acceptance_verification.expires_at");
      const { receipt_sha256: receiptDigest, ...receiptBytes } = authenticated;
      if (
        Object.keys(authenticated).length !== receiptKeys.size ||
        Object.keys(authenticated).some((key) => !receiptKeys.has(key)) ||
        authenticated.schema_version !== "sandboxes.provider-no-effect-verification-receipt/v1" ||
        authenticated.proof_sha256 !== proof.proof_sha256 ||
        authenticated.target_sha256 !== canonicalDigest(proof.target) ||
        authenticated.operation_execution_epoch !== proof.operation_execution_epoch ||
        authenticated.request_sha256 !== proof.request_sha256 ||
        authenticated.provider_receipt_sha256 !== proof.provider_receipt_sha256 ||
        authenticated.proof_kind !== proof.proof_kind ||
        receiptDigest !== canonicalDigest(receiptBytes) ||
        Date.parse(authenticated.verified_at) > now ||
        Date.parse(authenticated.expires_at) <= now
      ) {
        return undefined;
      }
      return {
        provider_receipt_sha256: proof.provider_receipt_sha256,
        verification_receipt_sha256: authenticated.receipt_sha256,
      };
    } catch {
      return undefined;
    }
  }

  async #markFailed(
    resourceId: string,
    operationId: string,
    _successorGeneration: bigint,
    providerReceiptSha256: Digest,
    verificationReceiptSha256: Digest,
  ): Promise<void> {
    assertDigest(providerReceiptSha256, "provider_non_acceptance_receipt_sha256");
    const outcomeAnchor = await this.#anchorOutcome(
      operationId,
      "failed_no_effect",
      providerReceiptSha256,
      verificationReceiptSha256,
    );
    await this.#repository.transaction((tx) => {
      const current = this.#mustSandbox(tx, resourceId);
      const outcomePending: SandboxV1 = {
        ...current,
        revision: current.revision + 1,
        pending_provider_outcome: {
          source_operation_id: operationId,
          target_state: "failed",
          evidence_sha256: outcomeAnchor,
          provider_receipt_sha256: providerReceiptSha256,
          observed_at: this.#txNow(tx),
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
          updated_at: this.#txNow(tx),
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
    return await this.#withSandboxLifecycleGate(resourceId, async () => {
    const physicalReason = reason === "provider_identity_mismatch"
      ? "provider_identity_mismatch" as const
      : "provider_ambiguous" as const;
    const snapshot = await this.get(resourceId);
    const observedAt = await this.#now();
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
    return await this.#repository.transaction((tx) => {
      const current = this.#mustSandbox(tx, resourceId);
      const observationId = createOpaqueId("observation");
      this.#appendSafetyObservation(tx, observationId, safetyObservation);
      const fenced: SandboxV1 = {
        ...current,
        revision: current.revision + 1,
        physical_safety_state: "fenced",
        physical_safety_reason: physicalReason,
        safety_observation_id: observationId,
        safety_fence_receipt_sha256: safetyReceipt,
        canonical_transition_required: "quarantined",
      };
      tx.putSandbox(fenced, current.revision);
      this.#unknownOperation(tx, operationId);
      this.#event(tx, fenced, operationId, "operation_unknown");
      return fenced;
    });
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

  async #verifiedDescriptor(): Promise<VerifiedAdapterContextV1> {
    const value = await this.#runner.descriptor();
    const allowed = new Set([
      "schema_version",
      "adapter_id",
      "adapter_version",
      "build_sha256",
      "descriptor_sha256",
      "installation_id",
      "provider_scope_ref",
      "status",
      "runtime_class",
      "supported_architectures",
      "isolation_evidence_sha256",
      "guest_kernel_boundary_evidence_sha256",
      "network_modes",
      "network_enforcement_evidence_sha256",
      "exact_operation_lookup",
      "inert_create",
      "whole_scope_cancel",
      "native_bounded_files",
      "read_only_workspace_enforcement",
      "atomic_incarnation_bound_delete",
      "ownership_reconciliation",
      "destructive_operation_semantics",
      "provider_hard_ttl_semantics",
      "output_framing",
      "max_ttl_ms",
      "resource_limits",
    ]);
    if (Object.keys(value).length !== allowed.size || Object.keys(value).some((key) => !allowed.has(key))) {
      throw new SandboxError("integrity_failed", "Adapter descriptor is not a closed V1 document");
    }
    assertDigest(value.build_sha256, "adapter_descriptor.build_sha256");
    assertDigest(value.descriptor_sha256, "adapter_descriptor.descriptor_sha256");
    assertDigest(value.isolation_evidence_sha256, "adapter_descriptor.isolation_evidence_sha256");
    assertDigest(
      value.guest_kernel_boundary_evidence_sha256,
      "adapter_descriptor.guest_kernel_boundary_evidence_sha256",
    );
    assertDigest(
      value.network_enforcement_evidence_sha256,
      "adapter_descriptor.network_enforcement_evidence_sha256",
    );
    const { descriptor_sha256: suppliedDigest, ...protectedDescriptor } = value;
    const booleans = [
      value.exact_operation_lookup,
      value.inert_create,
      value.whole_scope_cancel,
      value.native_bounded_files,
      value.atomic_incarnation_bound_delete,
    ];
    if (
      value.schema_version !== SCHEMA_VERSION ||
      !["fake", "e2b", "daytona_cloud"].includes(value.adapter_id) ||
      !["test_only", "pending_conformance", "admitted"].includes(value.status) ||
      value.runtime_class !== "strong_vm" ||
      !Array.isArray(value.supported_architectures) ||
      value.supported_architectures.length === 0 ||
      new Set(value.supported_architectures).size !== value.supported_architectures.length ||
      value.supported_architectures.some((architecture) =>
        !["x86_64", "arm64"].includes(architecture)
      ) ||
      value.adapter_version.length === 0 ||
      value.installation_id.length === 0 ||
      value.provider_scope_ref.length === 0 ||
      !Array.isArray(value.network_modes) ||
      value.network_modes.length === 0 ||
      new Set(value.network_modes).size !== value.network_modes.length ||
      value.network_modes.some((mode) => !["deny_all", "broker_only"].includes(mode)) ||
      value.read_only_workspace_enforcement !== "external_read_only_mount" ||
      value.ownership_reconciliation !== "exact_token_and_incarnation" ||
      value.destructive_operation_semantics !== "atomic_incarnation_bound_delete" ||
      value.provider_hard_ttl_semantics !== "stop_only_no_delete" ||
      value.output_framing !== "bounded_frames_v1" ||
      !Number.isSafeInteger(value.max_ttl_ms) ||
      value.max_ttl_ms <= 0 ||
      canonicalDigest(Object.keys(value.resource_limits).sort()) !== canonicalDigest([
        "max_disk_bytes",
        "max_file_bytes",
        "max_memory_bytes",
        "max_output_bytes",
        "max_page_entries",
        "max_processes",
      ]) ||
      Object.values(value.resource_limits).some((limit) =>
        !Number.isSafeInteger(limit) || limit <= 0
      ) ||
      booleans.some((flag) => typeof flag !== "boolean") ||
      suppliedDigest !== adapterDescriptorDigest(protectedDescriptor)
    ) {
      throw new SandboxError(
        "integrity_failed",
        "Adapter descriptor digest does not bind its exact closed behavior and provider identity facts",
      );
    }
    const descriptor = structuredClone(value);
    if (descriptor.adapter_id === "fake") {
      if (
        descriptor.status !== "test_only" ||
        (this.#runner as SandboxRunnerV1 & { [HERMETIC_TEST_RUNNER]?: true })[
          HERMETIC_TEST_RUNNER
        ] !== true
      ) {
        throw new SandboxError("unsupported_runtime_feature", "Fake adapter is not a branded hermetic test runner");
      }
      return {
        descriptor,
        admission_receipt_sha256: canonicalDigest({
          schema_version: "sandboxes.hermetic-adapter-admission/v1",
          descriptor_sha256: descriptor.descriptor_sha256,
        }),
      };
    }
    if (descriptor.status !== "admitted") {
      throw new SandboxError("unsupported_runtime_feature", "Managed adapter is pending signed admission");
    }
    const admission = await this.#verifier.verifyAdapterAdmission(descriptor);
    const admissionKeys = new Set([
      "schema_version",
      "registry_id",
      "adapter_id",
      "adapter_version",
      "build_sha256",
      "descriptor_sha256",
      "installation_id",
      "provider_scope_ref",
      "status",
      "conformance_manifest_sha256",
      "issued_at",
      "expires_at",
      "issuer_principal",
      "signing_key_id",
      "receipt_sha256",
      "signature",
    ]);
    assertDigest(admission.build_sha256, "adapter_admission.build_sha256");
    assertDigest(admission.descriptor_sha256, "adapter_admission.descriptor_sha256");
    assertDigest(
      admission.conformance_manifest_sha256,
      "adapter_admission.conformance_manifest_sha256",
    );
    assertDigest(admission.receipt_sha256, "adapter_admission.receipt_sha256");
    assertRfc3339(admission.issued_at, "adapter_admission.issued_at");
    assertRfc3339(admission.expires_at, "adapter_admission.expires_at");
    assertOpaqueId(admission.issuer_principal, "adapter_admission.issuer_principal", "principal");
    assertOpaqueId(admission.signing_key_id, "adapter_admission.signing_key_id", "key");
    const now = (await this.#repository.databaseTime()).getTime();
    if (
      Object.keys(admission).length !== admissionKeys.size ||
      Object.keys(admission).some((key) => !admissionKeys.has(key)) ||
      admission.schema_version !== "sandboxes.adapter-admission-receipt/v1" ||
      admission.registry_id !== "sandboxes.managed-v1" ||
      admission.adapter_id !== descriptor.adapter_id ||
      admission.adapter_version !== descriptor.adapter_version ||
      admission.build_sha256 !== descriptor.build_sha256 ||
      admission.descriptor_sha256 !== descriptor.descriptor_sha256 ||
      admission.installation_id !== descriptor.installation_id ||
      admission.provider_scope_ref !== descriptor.provider_scope_ref ||
      admission.status !== "admitted" ||
      admission.receipt_sha256 !== adapterAdmissionReceiptDigest(admission) ||
      !/^[A-Za-z0-9_-]{86}$/.test(admission.signature) ||
      Date.parse(admission.issued_at) > now ||
      Date.parse(admission.expires_at) <= now
    ) {
      throw new SandboxError("capability_denied", "Managed adapter admission receipt is not current and exact");
    }
    return { descriptor, admission_receipt_sha256: admission.receipt_sha256 };
  }

  async #assertCurrentAdapterAdmission(
    descriptor: AdapterDescriptorV1,
    admissionReceiptSha256: Digest,
  ): Promise<void> {
    const current = await this.#verifiedDescriptor();
    if (
      canonicalDigest(current.descriptor) !== canonicalDigest(descriptor) ||
      current.admission_receipt_sha256 !== admissionReceiptSha256
    ) {
      throw new SandboxError(
        "capability_denied",
        "Adapter descriptor or signed admission changed before provider reachability",
      );
    }
  }

  async #assertDescriptorSupportsCreate(
    descriptor: AdapterDescriptorV1,
    input: CreateSandboxV1,
  ): Promise<void> {
    const architecture = input.spec.architecture === "amd64" ? "x86_64" : "arm64";
    const limits = descriptor.resource_limits;
    const ttlMs = Date.parse(input.spec.expires_at) - (await this.#repository.databaseTime()).getTime();
    if (
      !descriptor.supported_architectures.includes(architecture) ||
      !descriptor.network_modes.includes(input.spec.network_policy.mode) ||
      input.spec.max_runtime_ms > descriptor.max_ttl_ms ||
      ttlMs <= 0 ||
      ttlMs > descriptor.max_ttl_ms ||
      input.spec.resources.pids > limits.max_processes ||
      input.spec.resources.memory_bytes > limits.max_memory_bytes ||
      input.spec.resources.disk_bytes > limits.max_disk_bytes ||
      input.spec.resources.output_bytes > limits.max_output_bytes
    ) {
      throw new SandboxError(
        "unsupported_runtime_feature",
        "Adapter admission does not cover the requested architecture, policy, TTL, or resource limits",
      );
    }
  }

  #assertPersistedDescriptor(
    sandbox: SandboxV1,
    descriptor: AdapterDescriptorV1,
    admissionReceiptSha256 = sandbox.adapter_admission_receipt_sha256,
  ): void {
    const persisted = sandbox.adapter_descriptor;
    if (persisted === undefined) {
      throw new SandboxError("integrity_failed", "Sandbox lacks its exact admitted adapter descriptor");
    }
    const { descriptor_sha256: persistedDigest, ...persistedProtected } = persisted;
    const { descriptor_sha256: currentDigest, ...currentProtected } = descriptor;
    if (
      persistedDigest !== adapterDescriptorDigest(persistedProtected) ||
      currentDigest !== adapterDescriptorDigest(currentProtected) ||
      sandbox.adapter_descriptor_sha256 !== persistedDigest ||
      canonicalDigest(persisted) !== canonicalDigest(descriptor) ||
      sandbox.adapter_admission_receipt_sha256 !== admissionReceiptSha256
    ) {
      throw new SandboxError("integrity_failed", "Runner descriptor changed after resource creation");
    }
  }

  #handleBindingForSandbox(sandbox: SandboxV1): ProviderHandleBindingV1 {
    this.#assertPersistedDescriptor(sandbox, sandbox.adapter_descriptor);
    if (
      sandbox.provider_identity_sha256 === undefined ||
      sandbox.immutable_fingerprint_sha256 === undefined
    ) {
      throw new SandboxError("integrity_failed", "Sandbox lacks its protected provider handle identity");
    }
    return {
      adapter_id: sandbox.adapter_descriptor.adapter_id,
      adapter_version: sandbox.adapter_descriptor.adapter_version,
      installation_id: sandbox.adapter_descriptor.installation_id,
      provider_scope_ref: sandbox.adapter_descriptor.provider_scope_ref,
      resource_id: sandbox.id,
      resource_lease_id: sandbox.resource_lease_id,
      resource_lifecycle_generation: sandbox.resource_lifecycle_generation,
      provider_creation_token_sha256: sandbox.provider_creation_token_sha256,
      immutable_fingerprint_sha256: sandbox.immutable_fingerprint_sha256,
      provider_identity_sha256: sandbox.provider_identity_sha256,
      spec_sha256: sandbox.spec_sha256,
    };
  }

  #openStoredHandle(
    sealed: import("./types.js").SealedProviderHandleV1,
    sandbox: SandboxV1,
  ): OwnedProviderHandleV1 {
    if (
      sandbox.provider_handle_sha256 === undefined ||
      sandbox.provider_handle_sha256 !== sealed.provider_handle_sha256
    ) {
      throw new SandboxError("integrity_failed", "Stored provider handle does not match the sandbox receipt");
    }
    const handle = this.#sealer.open(sealed, this.#handleBindingForSandbox(sandbox));
    if (canonicalDigest(providerHandleBinding(handle)) !== canonicalDigest(this.#handleBindingForSandbox(sandbox))) {
      throw new SandboxError("integrity_failed", "Opened provider handle does not match expected protected bindings");
    }
    return handle;
  }

  async #withSandboxLifecycleGate<T>(
    resourceId: string,
    effect: () => Promise<T>,
  ): Promise<T> {
    const sandbox = await this.#repository.transaction((tx) => this.#mustSandbox(tx, resourceId));
    this.#assertPersistedDescriptor(sandbox, sandbox.adapter_descriptor);
    const stableIdentity = {
      installation_id: sandbox.adapter_descriptor.installation_id,
      adapter_id: sandbox.adapter_descriptor.adapter_id,
      provider_scope_ref: sandbox.adapter_descriptor.provider_scope_ref,
      resource_id: sandbox.id,
      resource_lease_id: sandbox.resource_lease_id,
      provider_creation_token_sha256: sandbox.provider_creation_token_sha256,
    };
    const binding: ProviderLifecycleLockBindingV1 = {
      schema_version: "sandboxes.provider-lifecycle-lock/v1",
      lock_key_sha256: providerLifecycleLockKey(stableIdentity),
      ...stableIdentity,
    };
    return await this.#lifecycleLock.withLock(binding, async () => {
      const current = await this.#repository.transaction((tx) => this.#mustSandbox(tx, resourceId));
      this.#assertPersistedDescriptor(current, current.adapter_descriptor);
      const currentIdentity = {
        installation_id: current.adapter_descriptor.installation_id,
        adapter_id: current.adapter_descriptor.adapter_id,
        provider_scope_ref: current.adapter_descriptor.provider_scope_ref,
        resource_id: current.id,
        resource_lease_id: current.resource_lease_id,
        provider_creation_token_sha256: current.provider_creation_token_sha256,
      };
      if (providerLifecycleLockKey(currentIdentity) !== binding.lock_key_sha256) {
        throw new SandboxError("integrity_failed", "Lifecycle gate identity changed while acquiring its lock");
      }
      return await effect();
    });
  }

  async #assertFinalProviderMutationBarrier(
    ctx: NormalizedMutationContext,
    descriptor: AdapterDescriptorV1,
    adapterAdmissionReceiptSha256: Digest,
    handle?: OwnedProviderHandleV1,
    grantExpiresAt?: string,
  ): Promise<Digest> {
    const operation = await this.#repository.transaction((tx) => tx.getOperation(ctx.operation_id));
    if (operation === undefined) {
      throw new SandboxError("integrity_failed", "Final provider mutation barrier lost its operation");
    }
    await this.#physicalSafety.assertProviderDispatchAllowed({
      resource_id: ctx.fence.resource_id,
      operation: operation.operation,
      fence: ctx.fence,
      dispatch_anchor_sha256: dispatchedJournalAnchorDigest(ctx.dispatch_journal),
    });
    await this.#assertCurrentAdapterAdmission(descriptor, adapterAdmissionReceiptSha256);
    // These are the final online admission and authorization reads. Only the
    // linearizable local database barrier below may run before the mutation.
    const currentAuthorizationReceiptSha256 = await this.#assertCurrentEffectGuard(ctx);
    return await this.#repository.transaction((tx) => {
      const finalOperation = tx.getOperation(ctx.operation_id);
      if (finalOperation === undefined || finalOperation.effect_phase !== "dispatched") {
        throw new SandboxError("provider_state_unknown", "Provider mutation is no longer dispatched");
      }
      this.#assertProviderDispatchBarrier(tx, finalOperation, ctx);
      const current = this.#mustSandbox(tx, ctx.fence.resource_id);
      this.#assertPersistedDescriptor(
        current,
        descriptor,
        adapterAdmissionReceiptSha256,
      );
      const now = tx.databaseTime().getTime();
      if (grantExpiresAt !== undefined && Date.parse(grantExpiresAt) <= now) {
        throw new SandboxError("capability_denied", "Provider mutation grant expired during preflight");
      }
      if (handle !== undefined) {
        const sealed = tx.getHandle(current.id);
        if (sealed === undefined) {
          throw new SandboxError("integrity_failed", "Final provider mutation barrier lost its handle");
        }
        const stored = this.#openStoredHandle(sealed, current);
        if (stored.provider_identity_sha256 !== handle.provider_identity_sha256) {
          throw new SandboxError("integrity_failed", "Final provider mutation handle identity changed");
        }
      }
      return canonicalDigest({
        schema_version: "sandboxes.final-currentness-barrier-receipt/v1",
        operation_id: ctx.operation_id,
        operation_step_id: ctx.dispatch_journal.record.operation_step_id,
        operation_execution_epoch: ctx.fence.operation_execution_epoch,
        request_sha256: ctx.request_sha256,
        resource_id: current.id,
        resource_lifecycle_generation: current.resource_lifecycle_generation,
        dispatch_anchor_sha256: dispatchedJournalAnchorDigest(ctx.dispatch_journal),
        current_authorization_receipt_sha256: currentAuthorizationReceiptSha256,
        adapter_descriptor_sha256: descriptor.descriptor_sha256,
        adapter_admission_receipt_sha256: adapterAdmissionReceiptSha256,
        provider_handle_sha256: current.provider_handle_sha256 ?? null,
        grant_expires_at: grantExpiresAt ?? null,
        database_observed_at: this.#txNow(tx),
      });
    });
  }

  #assertCreatedHandle(
    handle: OwnedProviderHandleV1,
    sandbox: SandboxV1,
    ctx: NormalizedMutationContext,
    descriptor: AdapterDescriptorV1,
  ): void {
    const allowed = new Set([
      "schema_version",
      "adapter_id",
      "adapter_version",
      "installation_id",
      "provider_scope_ref",
      "resource_kind",
      "opaque_resource_id",
      "ownership_nonce",
      "create_inert_operation_id",
      "provider_creation_token_sha256",
      "creation_receipt_sha256",
      "provider_created_at",
      "provider_resource_version",
      "provider_identity_sha256",
      "immutable_fingerprint_sha256",
      "resource_lease_id",
      "resource_id",
      "resource_lifecycle_generation",
      "spec_sha256",
    ]);
    if (Object.keys(handle).length !== allowed.size || Object.keys(handle).some((key) => !allowed.has(key))) {
      throw new SandboxError("integrity_failed", "Provider handle is not a closed V1 document");
    }
    assertOpaqueId(handle.create_inert_operation_id, "provider_handle.create_inert_operation_id", "op");
    assertOpaqueId(handle.resource_lease_id, "provider_handle.resource_lease_id", "resource_lease");
    assertOpaqueId(handle.resource_id, "provider_handle.resource_id", "sbx");
    assertDigest(handle.provider_creation_token_sha256, "provider_handle.provider_creation_token_sha256");
    assertDigest(handle.creation_receipt_sha256, "provider_handle.creation_receipt_sha256");
    assertDigest(handle.provider_identity_sha256, "provider_handle.provider_identity_sha256");
    assertDigest(handle.immutable_fingerprint_sha256, "provider_handle.immutable_fingerprint_sha256");
    assertDigest(handle.spec_sha256, "provider_handle.spec_sha256");
    assertRfc3339(handle.provider_created_at, "provider_handle.provider_created_at");
    if (
      handle.schema_version !== SCHEMA_VERSION ||
      handle.resource_kind !== "strong_vm" ||
      handle.adapter_id !== descriptor.adapter_id ||
      handle.adapter_version !== descriptor.adapter_version ||
      handle.installation_id !== descriptor.installation_id ||
      handle.provider_scope_ref !== descriptor.provider_scope_ref ||
      handle.opaque_resource_id.length === 0 ||
      handle.opaque_resource_id.length > 512 ||
      handle.ownership_nonce.length < 16 ||
      handle.ownership_nonce.length > 512 ||
      handle.provider_resource_version.length === 0 ||
      handle.provider_resource_version.length > 512 ||
      handle.provider_identity_sha256 !== providerHandleIdentityDigest(handle) ||
      handle.resource_id !== sandbox.id ||
      handle.resource_lease_id !== sandbox.resource_lease_id ||
      handle.resource_lifecycle_generation !== ctx.fence.resource_lifecycle_generation ||
      handle.create_inert_operation_id !== ctx.operation_id ||
      handle.provider_creation_token_sha256 !==
        ctx.dispatch_journal.record.provider_creation_token_sha256 ||
      handle.immutable_fingerprint_sha256 !==
        ctx.dispatch_journal.record.immutable_fingerprint_sha256 ||
      handle.spec_sha256 !== sandbox.spec_sha256
    ) {
      throw new SandboxError("integrity_failed", "Provider handle does not bind the reserved resource");
    }
  }

  async #verifyExactOwnedResource(
    ctx: NormalizedMutationContext,
    descriptor: AdapterDescriptorV1,
    adapterAdmissionReceiptSha256: Digest,
    handle: OwnedProviderHandleV1,
    mutation: ProviderOperationV1,
    expectedState: "inert" | "active" | ReadonlyArray<"inert" | "active">,
    operationLookupAlreadyRead = false,
    existingReadProbe?: ProviderOperationV1,
  ): Promise<void> {
    const readProbe = existingReadProbe ?? await this.#readProbeOperation(ctx, mutation, descriptor);
    const reconcile = this.#reconcileContext(ctx, descriptor, readProbe);
    if (!operationLookupAlreadyRead) {
      await this.#assertCurrentEffectGuard(ctx, readProbe);
      await this.#assertCurrentAdapterAdmission(descriptor, adapterAdmissionReceiptSha256);
      const operationObservation = await this.#runner.lookupOperation(reconcile, readProbe, handle);
      if (
      operationObservation.state !== "completed" ||
      operationObservation.handle === undefined ||
      this.#providerIdentityDigest(operationObservation.handle) !== this.#providerIdentityDigest(handle)
      ) {
        throw new SandboxError("integrity_failed", "Provider operation readback did not return the exact owned handle");
      }
    }
    const inspectionBarrierReceiptSha256 = await this.#assertCurrentEffectGuard(ctx, readProbe);
    await this.#assertCurrentAdapterAdmission(descriptor, adapterAdmissionReceiptSha256);
    const observation = await this.#runner.inspect(
      this.#adapterContextForOperation(
        ctx,
        readProbe,
        descriptor,
        adapterAdmissionReceiptSha256,
        inspectionBarrierReceiptSha256,
      ),
      handle,
      readProbe,
    );
    if (
      !(Array.isArray(expectedState)
        ? expectedState.includes(observation.state as "inert" | "active")
        : observation.state === expectedState) ||
      observation.handle === undefined ||
      this.#providerIdentityDigest(observation.handle) !== this.#providerIdentityDigest(handle) ||
      observation.immutable_fingerprint_sha256 !== handle.immutable_fingerprint_sha256 ||
      observation.provider_resource_version !== handle.provider_resource_version
    ) {
      throw new SandboxError("integrity_failed", "Provider inspection did not match the exact owned incarnation");
    }
    const matches: OwnedResourcePageV1["resources"] = [];
    let cursor: string | undefined;
    const seenCursors = new Set<string>();
    for (let pageCount = 0; pageCount < 1_000; pageCount += 1) {
      await this.#assertCurrentEffectGuard(ctx, readProbe);
      await this.#assertCurrentAdapterAdmission(descriptor, adapterAdmissionReceiptSha256);
      const page = await this.#runner.listOwnedResources(reconcile, readProbe, cursor);
      matches.push(...page.resources.filter((resource) => resource.resource_id === handle.resource_id));
      if (page.next_cursor === undefined) break;
      if (seenCursors.has(page.next_cursor)) {
        throw new SandboxError("integrity_failed", "Provider ownership enumeration cursor repeated");
      }
      seenCursors.add(page.next_cursor);
      cursor = page.next_cursor;
      if (pageCount === 999) {
        throw new SandboxError("integrity_failed", "Provider ownership enumeration exceeded its bounded page count");
      }
    }
    if (
      matches.length !== 1 ||
      matches[0]?.installation_id !== handle.installation_id ||
      matches[0]?.provider_scope_ref !== handle.provider_scope_ref ||
      matches[0]?.opaque_resource_id !== handle.opaque_resource_id ||
      matches[0]?.ownership_nonce !== handle.ownership_nonce ||
      matches[0]?.provider_creation_token_sha256 !== handle.provider_creation_token_sha256 ||
      matches[0]?.immutable_fingerprint_sha256 !== handle.immutable_fingerprint_sha256 ||
      !(Array.isArray(expectedState)
        ? expectedState.includes(matches[0]?.state as "inert" | "active")
        : matches[0]?.state === expectedState)
    ) {
      throw new SandboxError("integrity_failed", "Provider ownership labels did not enumerate exactly one owned incarnation");
    }
    await this.#assertCurrentEffectGuard(ctx, readProbe);
  }

  #providerIdentityDigest(handle: OwnedProviderHandleV1): Digest {
    if (handle.provider_identity_sha256 !== providerHandleIdentityDigest(handle)) {
      throw new SandboxError("integrity_failed", "Provider handle identity preimage does not match its digest");
    }
    return handle.provider_identity_sha256;
  }

  async #verifyExactAbsence(
    ctx: NormalizedMutationContext,
    descriptor: AdapterDescriptorV1,
    adapterAdmissionReceiptSha256: Digest,
    handle: OwnedProviderHandleV1,
    mutation: ProviderOperationV1,
  ): Promise<void> {
    const readProbe = await this.#readProbeOperation(ctx, mutation, descriptor);
    const reconcile = this.#reconcileContext(ctx, descriptor, readProbe);
    const inspectionBarrierReceiptSha256 = await this.#assertCurrentEffectGuard(ctx, readProbe);
    await this.#assertCurrentAdapterAdmission(descriptor, adapterAdmissionReceiptSha256);
    const observation = await this.#runner.inspect(
      this.#adapterContextForOperation(
        ctx,
        readProbe,
        descriptor,
        adapterAdmissionReceiptSha256,
        inspectionBarrierReceiptSha256,
      ),
      handle,
      readProbe,
    );
    if (observation.state !== "absent" || observation.handle !== undefined) {
      throw new SandboxError("provider_state_unknown", "Provider did not prove exact terminal absence");
    }
    let cursor: string | undefined;
    const seenCursors = new Set<string>();
    for (let pageCount = 0; pageCount < 1_000; pageCount += 1) {
      await this.#assertCurrentEffectGuard(ctx, readProbe);
      await this.#assertCurrentAdapterAdmission(descriptor, adapterAdmissionReceiptSha256);
      const page = await this.#runner.listOwnedResources(reconcile, readProbe, cursor);
      if (page.resources.some((resource) => resource.resource_id === handle.resource_id)) {
        throw new SandboxError("provider_state_unknown", "Provider enumeration still contains the destroyed identity");
      }
      if (page.next_cursor === undefined) break;
      if (seenCursors.has(page.next_cursor) || pageCount === 999) {
        throw new SandboxError("integrity_failed", "Provider absence enumeration did not terminate safely");
      }
      seenCursors.add(page.next_cursor);
      cursor = page.next_cursor;
    }
    await this.#assertCurrentEffectGuard(ctx, readProbe);
  }

  async #assertCurrentEffectGuard(
    ctx: NormalizedMutationContext,
    readProbe?: ProviderOperationV1,
  ): Promise<Digest> {
    await this.#assertFenceFresh(ctx.fence);
    const authenticated = await this.#verifier.verifyCurrentEffectAuthorization(
      ctx.capability,
      ctx.fence,
    );
    this.#assertAuthenticatedBindings(authenticated, ctx.fence);
    if (readProbe !== undefined) {
      if (readProbe.external_anchor_kind !== "READ_PROBE") {
        throw new SandboxError("integrity_failed", "Provider discovery continuation lacks a READ_PROBE receipt");
      }
      const anchorValue = await this.#readProbeJournal.readReadProbe(
        readProbe.external_anchor_receipt_sha256,
      );
      if (anchorValue === undefined) {
        throw new SandboxError("capability_denied", "Signed provider discovery scope is no longer readable");
      }
      const anchor = validateReadProbeJournalAnchor(anchorValue);
      if (
        canonicalDigest(anchor) !== readProbe.external_anchor_receipt_sha256 ||
        canonicalDigest(anchor.record.target) !== canonicalDigest(readProbe.target) ||
        anchor.record.discovery_scope.resource_id !== readProbe.target.resource_id ||
        anchor.record.discovery_scope.provider_creation_token_sha256 !==
          readProbe.target.provider_creation_token_sha256 ||
        anchor.record.discovery_scope.immutable_fingerprint_sha256 !==
          readProbe.target.immutable_fingerprint_sha256
      ) {
        throw new SandboxError("integrity_failed", "Signed provider discovery scope changed between pages");
      }
      const journalBindings = await this.#verifier.verifyReadProbeJournalAnchor(anchor, ctx.fence);
      this.#assertAuthenticatedJournalBindings(journalBindings, anchor, ctx.fence);
    }
    const databaseObservedAt = await this.#repository.transaction((tx) => {
      const operation = tx.getOperation(ctx.operation_id);
      const sandbox = tx.getSandbox(ctx.fence.resource_id);
      if (
        operation === undefined ||
        sandbox === undefined ||
        !["dispatched", "unknown"].includes(operation.effect_phase) ||
        operation.cancellation_state !== "open" ||
        operation.dispatch_journal_anchor_sha256 !== dispatchedJournalAnchorDigest(ctx.dispatch_journal) ||
        operation.operation_step_id !== ctx.dispatch_journal.record.operation_step_id ||
        canonicalDigest(operation.provider_target ?? null) !== canonicalDigest(this.#effectTarget(ctx)) ||
        canonicalDigest(operation.fence) !== canonicalDigest(ctx.fence) ||
        sandbox.resource_lifecycle_generation !== operation.successor_resource_lifecycle_generation
      ) {
        throw new SandboxError("provider_state_unknown", "Provider read continuation lost the current dispatched effect");
      }
      return this.#txNow(tx);
    });
    return canonicalDigest({
      schema_version: "sandboxes.current-effect-authorization-receipt/v1",
      operation_id: ctx.operation_id,
      operation_step_id: ctx.dispatch_journal.record.operation_step_id,
      operation_execution_epoch: ctx.fence.operation_execution_epoch,
      request_sha256: ctx.request_sha256,
      target_sha256: canonicalDigest(this.#effectTarget(ctx)),
      dispatch_anchor_sha256: dispatchedJournalAnchorDigest(ctx.dispatch_journal),
      read_probe_anchor_sha256: readProbe?.external_anchor_receipt_sha256 ?? null,
      database_observed_at: databaseObservedAt,
    });
  }

  #assertHandleGeneration(handle: OwnedProviderHandleV1, ctx: NormalizedMutationContext): void {
    if (
      handle.resource_id !== ctx.fence.resource_id ||
      handle.resource_lease_id !== ctx.fence.resource_lease_id ||
      handle.resource_lifecycle_generation !== ctx.fence.resource_lifecycle_generation ||
      handle.immutable_fingerprint_sha256 !==
        ctx.dispatch_journal.record.immutable_fingerprint_sha256
    ) {
      throw new SandboxError("stale_resource_lifecycle_generation", "Sealed provider handle generation is stale");
    }
  }

  #advanceStoredHandle(
    tx: SandboxRepositoryTxV1,
    current: SandboxV1,
    generation: bigint,
  ): Digest | undefined {
    const sealed = tx.getHandle(current.id);
    if (sealed === undefined) return undefined;
    const handle = this.#openStoredHandle(sealed, current);
    if (handle.resource_lifecycle_generation !== current.resource_lifecycle_generation) {
      throw new SandboxError("integrity_failed", "Stale provider handle cannot be upgraded to a successor generation");
    }
    const next = this.#sealer.seal({ ...handle, resource_lifecycle_generation: generation });
    tx.putHandle(next);
    return next.provider_handle_sha256;
  }

  async #withProviderLifecycleLock<T>(
    ctx: NormalizedMutationContext,
    descriptor: AdapterDescriptorV1,
    handle: OwnedProviderHandleV1 | undefined,
    effect: () => Promise<T>,
  ): Promise<T> {
    const target = this.#effectTarget(ctx);
    if (
      handle !== undefined &&
      (
        handle.adapter_id !== descriptor.adapter_id ||
        handle.adapter_version !== descriptor.adapter_version ||
        handle.installation_id !== descriptor.installation_id ||
        handle.provider_scope_ref !== descriptor.provider_scope_ref ||
        handle.resource_id !== target.resource_id ||
        handle.resource_lease_id !== ctx.fence.resource_lease_id ||
        handle.provider_creation_token_sha256 !== target.provider_creation_token_sha256
        || handle.provider_identity_sha256 !== providerHandleIdentityDigest(handle)
      )
    ) {
      throw new SandboxError("integrity_failed", "Lifecycle lock cannot bind a mismatched provider incarnation");
    }
    const stableIdentity = {
      installation_id: descriptor.installation_id,
      adapter_id: descriptor.adapter_id,
      provider_scope_ref: descriptor.provider_scope_ref,
      resource_id: target.resource_id,
      resource_lease_id: ctx.fence.resource_lease_id,
      provider_creation_token_sha256: target.provider_creation_token_sha256,
    };
    const binding: ProviderLifecycleLockBindingV1 = {
      schema_version: "sandboxes.provider-lifecycle-lock/v1",
      lock_key_sha256: providerLifecycleLockKey(stableIdentity),
      ...stableIdentity,
      ...(handle === undefined
        ? {}
        : {
            bound_provider_identity: {
              opaque_resource_id: handle.opaque_resource_id,
              ownership_nonce: handle.ownership_nonce,
              immutable_fingerprint_sha256: handle.immutable_fingerprint_sha256,
              provider_resource_version: handle.provider_resource_version,
            },
          }),
    };
    return await this.#lifecycleLock.withLock(binding, async () => {
      await this.#assertFenceFresh(ctx.fence);
      return await effect();
    });
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
      external_anchor_receipt_sha256: dispatchedJournalAnchorDigest(ctx.dispatch_journal),
      deadline: ctx.fence.operation_execution_expires_at,
    };
  }

  async #readProbeOperation(
    ctx: NormalizedMutationContext,
    operation: ProviderOperationV1,
    descriptor: AdapterDescriptorV1,
  ): Promise<ProviderOperationV1> {
    const target = this.#effectTarget(ctx);
    const discoveryScope = this.#providerDiscoveryScope(descriptor, target);
    const recordedAt = await this.#now();
    const appendResponse = validateReadProbeJournalAnchor(await this.#readProbeJournal.appendReadProbe({
      operation_id: ctx.operation_id,
      operation_step_id: ctx.dispatch_journal.record.operation_step_id,
      request_sha256: ctx.request_sha256,
      fence: ctx.fence,
      target,
      discovery_scope: discoveryScope,
      recorded_at: recordedAt,
    }));
    const rereadValue = await this.#readProbeJournal.readReadProbe(canonicalDigest(appendResponse));
    if (rereadValue === undefined) {
      throw new SandboxError("integrity_failed", "External journal did not read back the complete READ_PROBE envelope");
    }
    const anchor = validateReadProbeJournalAnchor(rereadValue);
    if (canonicalDigest(anchor) !== canonicalDigest(appendResponse)) {
      throw new SandboxError("integrity_failed", "READ_PROBE append and authoritative readback disagree");
    }
    const probeRecord = anchor.record;
    if (
      probeRecord.schema_version !== SCHEMA_VERSION ||
      probeRecord.state !== "read_probe" ||
      probeRecord.operation_id !== ctx.operation_id ||
      probeRecord.operation_step_id !== ctx.dispatch_journal.record.operation_step_id ||
      probeRecord.operation_digest !== ctx.request_sha256 ||
      probeRecord.resource_id !== ctx.fence.resource_id ||
      probeRecord.recorded_at !== recordedAt ||
      Date.parse(probeRecord.expires_at) <= (await this.#repository.databaseTime()).getTime() ||
      canonicalDigest(probeRecord.fence) !== canonicalDigest(ctx.fence) ||
      canonicalDigest(probeRecord.target) !== canonicalDigest(target)
      || canonicalDigest(probeRecord.discovery_scope) !== canonicalDigest(discoveryScope)
    ) {
      throw new SandboxError("integrity_failed", "READ_PROBE journal returned a mismatched signed anchor");
    }
    const authenticated = await this.#verifier.verifyReadProbeJournalAnchor(anchor, ctx.fence);
    this.#assertAuthenticatedJournalBindings(authenticated, anchor, ctx.fence);
    await this.#repository.transaction((tx) => {
      tx.appendExternalAnchor({
        schema_version: SCHEMA_VERSION,
        anchor_kind: "READ_PROBE",
        operation_id: probeRecord.operation_id,
        operation_step_id: probeRecord.operation_step_id,
        operation_execution_epoch: probeRecord.fence.operation_execution_epoch,
        journal_sequence: anchor.journal_sequence,
        prior_frontier_digest: anchor.prior_frontier_digest,
        record_digest: anchor.record_digest,
        frontier_digest: anchor.frontier_digest,
        envelope_digest: canonicalDigest(anchor),
        recorded_at: probeRecord.recorded_at,
      });
    });
    return {
      ...operation,
      operation: "inspect",
      external_anchor_kind: "READ_PROBE",
      external_anchor_receipt_sha256: readProbeJournalAnchorDigest(anchor),
    };
  }

  #adapterContext(
    ctx: NormalizedMutationContext,
    descriptor: AdapterDescriptorV1,
    adapterAdmissionReceiptSha256: Digest,
    finalCurrentnessBarrierReceiptSha256: Digest,
  ): AdapterCallContextV1 {
    return this.#adapterContextWithAnchor(
      ctx,
      dispatchedJournalAnchorDigest(ctx.dispatch_journal),
      descriptor,
      adapterAdmissionReceiptSha256,
      finalCurrentnessBarrierReceiptSha256,
    );
  }

  #adapterContextForOperation(
    ctx: NormalizedMutationContext,
    operation: ProviderOperationV1,
    descriptor: AdapterDescriptorV1,
    adapterAdmissionReceiptSha256: Digest,
    finalCurrentnessBarrierReceiptSha256: Digest,
  ): AdapterCallContextV1 {
    return this.#adapterContextWithAnchor(
      ctx,
      operation.external_anchor_receipt_sha256,
      descriptor,
      adapterAdmissionReceiptSha256,
      finalCurrentnessBarrierReceiptSha256,
    );
  }

  #adapterContextWithAnchor(
    ctx: NormalizedMutationContext,
    externalAnchorReceiptSha256: Digest,
    descriptor: AdapterDescriptorV1,
    adapterAdmissionReceiptSha256: Digest,
    finalCurrentnessBarrierReceiptSha256: Digest,
  ): AdapterCallContextV1 {
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
      external_anchor_receipt_sha256: externalAnchorReceiptSha256,
      final_currentness_barrier_receipt_sha256:
        finalCurrentnessBarrierReceiptSha256,
      adapter_descriptor_sha256: descriptor.descriptor_sha256,
      adapter_admission_receipt_sha256: adapterAdmissionReceiptSha256,
    };
  }

  #effectTarget(ctx: NormalizedMutationContext): import("./types.js").ProviderEffectTargetV1 {
    return {
      operation_id: ctx.operation_id,
      operation_digest: ctx.request_sha256,
      operation_step_id: ctx.dispatch_journal.record.operation_step_id,
      resource_id: ctx.fence.resource_id,
      resource_lifecycle_generation: ctx.fence.resource_lifecycle_generation,
      provider_idempotency_token_sha256:
        ctx.dispatch_journal.record.provider_idempotency_token_sha256,
      provider_creation_token_sha256:
        ctx.dispatch_journal.record.provider_creation_token_sha256,
      immutable_fingerprint_sha256: ctx.dispatch_journal.record.immutable_fingerprint_sha256,
      authorization_consumption_receipt_sha256:
        ctx.dispatch_journal.record.authorization_consumption_receipt_sha256,
    };
  }

  #providerDiscoveryScope(
    descriptor: AdapterDescriptorV1,
    target: ProviderEffectTargetV1,
  ): ProviderDiscoveryScopeV1 {
    const protectedBytes = {
      schema_version: "sandboxes.provider-discovery-scope/v1" as const,
      read_kind: "exact_operation_and_owned_resource" as const,
      installation_id: descriptor.installation_id,
      provider_scope_ref: descriptor.provider_scope_ref,
      resource_id: target.resource_id,
      provider_creation_token_sha256: target.provider_creation_token_sha256,
      immutable_fingerprint_sha256: target.immutable_fingerprint_sha256,
      max_pages: 1_000,
    };
    return { ...protectedBytes, scope_sha256: canonicalDigest(protectedBytes) };
  }

  #reconcileContext(
    ctx: NormalizedMutationContext,
    descriptor: AdapterDescriptorV1,
    readProbe: ProviderOperationV1,
  ): ReconcileContextV1 {
    const scope = this.#providerDiscoveryScope(descriptor, readProbe.target);
    return {
      installation_id: scope.installation_id,
      provider_scope_ref: scope.provider_scope_ref,
      resource_id: scope.resource_id,
      provider_creation_token_sha256: scope.provider_creation_token_sha256,
      immutable_fingerprint_sha256: scope.immutable_fingerprint_sha256,
      discovery_scope_receipt_sha256: readProbe.external_anchor_receipt_sha256,
      complete_read_probe_envelope_sha256: readProbe.external_anchor_receipt_sha256,
      max_pages: scope.max_pages,
      deadline: ctx.fence.operation_execution_expires_at,
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
    outcomeKind: ProviderOutcomeAnchorV1["record"]["outcome_kind"],
    outcomeSha256: Digest,
    providerNoEffectVerificationReceiptSha256?: Digest,
  ): Promise<Digest> {
    if (
      (outcomeKind === "failed_no_effect") !==
        (providerNoEffectVerificationReceiptSha256 !== undefined)
    ) {
      throw new SandboxError(
        "integrity_failed",
        "failed_no_effect outcome requires exactly one trusted provider-proof verification receipt",
      );
    }
    if (providerNoEffectVerificationReceiptSha256 !== undefined) {
      assertDigest(
        providerNoEffectVerificationReceiptSha256,
        "provider_no_effect_verification_receipt_sha256",
      );
    }
    const operation = await this.#repository.transaction((tx) => tx.getOperation(operationId));
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
    const recordedAt = await this.#now();
    const appendResponse = validateProviderOutcomeAnchor(await this.#outcomeJournal.appendOutcome({
      operation_id: operationId,
      operation_step_id: operation.operation_step_id,
      operation_execution_epoch: operation.fence.operation_execution_epoch,
      dispatch_anchor_sha256: operation.dispatch_journal_anchor_sha256,
      outcome_kind: outcomeKind,
      outcome_sha256: outcomeSha256,
      recorded_at: recordedAt,
      fence: operation.fence,
      target: operation.provider_target,
      ...(providerNoEffectVerificationReceiptSha256 === undefined
        ? {}
        : {
            provider_no_effect_verification_receipt_sha256:
              providerNoEffectVerificationReceiptSha256,
          }),
    }));
    const rereadValue = await this.#outcomeJournal.readOutcome(canonicalDigest(appendResponse));
    if (rereadValue === undefined) {
      throw new SandboxError("integrity_failed", "External journal did not read back the complete OUTCOME envelope");
    }
    const anchor = validateProviderOutcomeAnchor(rereadValue);
    if (canonicalDigest(anchor) !== canonicalDigest(appendResponse)) {
      throw new SandboxError("integrity_failed", "OUTCOME append and authoritative readback disagree");
    }
    const outcomeRecord = anchor.record;
    assertEffectJournalOutcomeSchema(
      outcomeRecord.outcome_schema_version,
      outcomeRecord.outcome_schema_digest,
    );
    if (
      outcomeRecord.schema_version !== SCHEMA_VERSION ||
      outcomeRecord.record_kind !== "OUTCOME" ||
      outcomeRecord.outcome_schema_version !== EFFECT_JOURNAL_OUTCOME_SCHEMA_VERSION ||
      outcomeRecord.outcome_schema_digest !== EFFECT_JOURNAL_OUTCOME_SCHEMA_DIGEST ||
      outcomeRecord.operation_id !== operationId ||
      outcomeRecord.operation_step_id !== operation.operation_step_id ||
      outcomeRecord.operation_execution_epoch !== operation.fence.operation_execution_epoch ||
      outcomeRecord.dispatch_anchor_sha256 !== operation.dispatch_journal_anchor_sha256 ||
      outcomeRecord.outcome_kind !== outcomeKind ||
      outcomeRecord.outcome_sha256 !== outcomeSha256 ||
      outcomeRecord.recorded_at !== recordedAt ||
      canonicalDigest(outcomeRecord.fence) !== canonicalDigest(operation.fence) ||
      canonicalDigest(outcomeRecord.target) !== canonicalDigest(operation.provider_target)
    ) {
      throw new SandboxError("integrity_failed", "Outcome journal returned a mismatched signed frontier anchor");
    }
    const authenticated = await this.#verifier.verifyProviderOutcomeAnchor(anchor, operation.fence);
    this.#assertAuthenticatedJournalBindings(authenticated, anchor, operation.fence);
    await this.#repository.transaction((tx) => {
      tx.appendExternalAnchor({
        schema_version: SCHEMA_VERSION,
        record_kind: "OUTCOME",
        outcome_schema_version: outcomeRecord.outcome_schema_version,
        outcome_schema_digest: outcomeRecord.outcome_schema_digest,
        operation_id: outcomeRecord.operation_id,
        operation_step_id: outcomeRecord.operation_step_id,
        operation_execution_epoch: outcomeRecord.operation_execution_epoch,
        outcome_kind: outcomeRecord.outcome_kind,
        journal_sequence: anchor.journal_sequence,
        prior_frontier_digest: anchor.prior_frontier_digest,
        record_digest: anchor.record_digest,
        frontier_digest: anchor.frontier_digest,
        envelope_digest: canonicalDigest(anchor),
        recorded_at: outcomeRecord.recorded_at,
      });
    });
    return providerOutcomeAnchorDigest(anchor);
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
      recorded_at: this.#txNow(tx),
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

  async #now(): Promise<string> {
    return nowRfc3339(await this.#repository.databaseTime());
  }

  #txNow(tx: SandboxRepositoryTxV1): string {
    return nowRfc3339(tx.databaseTime());
  }
}
