import type {
  AuthenticatedEffectBindingsV1,
  AuthenticatedJournalBindingsV1,
  AuthenticatedAdapterAdmissionV1,
  AuthenticatedJournalRecoveryRangeV1,
  PhysicalSafetyControllerV1,
  ProviderDispatchJournalV1,
  ProviderReadProbeJournalV1,
  ProviderOutcomeJournalV1,
  ProviderLifecycleLockV1,
  ProviderJournalRecoveryV1,
  SandboxesAuthorityVerifierV1,
} from "./service.js";
import { canonicalDigest, sha256, type Digest } from "./canonical.js";
import {
  EFFECT_JOURNAL_OUTCOME_SCHEMA_DIGEST,
  EFFECT_JOURNAL_OUTCOME_SCHEMA_VERSION,
} from "./effect-journal.js";
import type {
  ActivationGrantV1,
  AdapterDescriptorV1,
  CapabilityClaimsV1,
  CheckpointDurabilityReceiptV1,
  DispatchedJournalAnchorV1,
  EffectJournalEnvelopeV1,
  EffectJournalRecoveryRangeV1,
  GitPromotionReceiptRefV1,
  InfinityCleanupGrantV1,
  ReadProbeJournalAnchorV1,
  ProviderOutcomeAnchorV1,
  SafetyFenceObservationV1,
  ProviderLifecycleLockBindingV1,
} from "./types.js";
import { providerLifecycleLockKey } from "./service.js";

/** Hermetic FIFO stand-in for the production cross-replica lifecycle lock. */
export class DeterministicTestProviderLifecycleLockV1 implements ProviderLifecycleLockV1 {
  readonly bindings: ProviderLifecycleLockBindingV1[] = [];
  readonly #tails = new Map<Digest, Promise<void>>();
  readonly #active = new Set<Digest>();
  max_active_for_one_key = 0;

  async withLock<T>(
    binding: ProviderLifecycleLockBindingV1,
    effect: () => Promise<T>,
  ): Promise<T> {
    const expectedKey = providerLifecycleLockKey(binding);
    if (binding.schema_version !== "sandboxes.provider-lifecycle-lock/v1" || binding.lock_key_sha256 !== expectedKey) {
      throw new Error("test lifecycle lock rejected a non-canonical stable key");
    }
    this.bindings.push(structuredClone(binding));
    const prior = this.#tails.get(binding.lock_key_sha256) ?? Promise.resolve();
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const tail = prior.then(async () => gate);
    this.#tails.set(binding.lock_key_sha256, tail);
    await prior;
    if (this.#active.has(binding.lock_key_sha256)) {
      throw new Error("test lifecycle lock admitted overlapping effects for one key");
    }
    this.#active.add(binding.lock_key_sha256);
    this.max_active_for_one_key = Math.max(this.max_active_for_one_key, 1);
    try {
      return await effect();
    } finally {
      this.#active.delete(binding.lock_key_sha256);
      release();
      if (this.#tails.get(binding.lock_key_sha256) === tail) this.#tails.delete(binding.lock_key_sha256);
    }
  }
}

export class DeterministicTestJournalLedgerV1 {
  readonly envelopes: EffectJournalEnvelopeV1[] = [];

  record(anchor: EffectJournalEnvelopeV1): void {
    const digest = canonicalDigest(anchor);
    if (!this.envelopes.some((candidate) => canonicalDigest(candidate) === digest)) {
      this.envelopes.push(structuredClone(anchor));
    }
  }
}

export class DeterministicTestProviderJournalRecoveryV1 implements ProviderJournalRecoveryV1 {
  constructor(readonly ledger: DeterministicTestJournalLedgerV1) {}

  async readOperationStepRange(
    input: Parameters<ProviderJournalRecoveryV1["readOperationStepRange"]>[0],
  ): Promise<EffectJournalRecoveryRangeV1> {
    const completeOperationEnvelopes = this.ledger.envelopes
      .filter((anchor) =>
        anchor.record.operation_id === input.operation_id &&
        anchor.record.operation_step_id === input.operation_step_id &&
        anchor.journal_sequence >= input.requested_from_sequence
      )
      .sort((left, right) => left.journal_sequence < right.journal_sequence ? -1 : 1)
      .map((anchor) => structuredClone(anchor));
    const head = [...this.ledger.envelopes]
      .sort((left, right) => left.journal_sequence < right.journal_sequence ? -1 : 1)
      .at(-1);
    const signedHeadSequence = head?.journal_sequence ?? 1n;
    const signedHeadFrontierDigest = head?.frontier_digest ?? sha256("test-journal-genesis-frontier");
    const proofBytes = {
      schema_version: "infinity.effect-journal-recovery-range/v1" as const,
      operation_id: input.operation_id,
      operation_step_id: input.operation_step_id,
      requested_from_sequence: input.requested_from_sequence,
      signed_head_sequence: signedHeadSequence,
      signed_head_frontier_digest: signedHeadFrontierDigest,
      complete_operation_envelope_digests: completeOperationEnvelopes.map(canonicalDigest),
    };
    return {
      schema_version: proofBytes.schema_version,
      operation_id: input.operation_id,
      operation_step_id: input.operation_step_id,
      requested_from_sequence: input.requested_from_sequence,
      signed_head_sequence: signedHeadSequence,
      signed_head_frontier_digest: signedHeadFrontierDigest,
      signer_principal: "principal_00000000000000000000000000000060",
      signing_key_id: "key_00000000000000000000000000000060",
      signature: "R".repeat(86),
      complete_operation_envelopes: completeOperationEnvelopes,
      completeness_proof_sha256: canonicalDigest(proofBytes),
    };
  }
}

/** Explicitly test-only verifier. Production code must inject an Infinity verifier. */
export class DeterministicTestAuthorityVerifierV1 implements SandboxesAuthorityVerifierV1 {
  stored_frontier_membership_valid = true;
  journal_range_completeness_valid = true;
  readonly calls = {
    capability: 0,
    current_effect: 0,
    dispatch_journal: 0,
    read_probe_journal: 0,
    outcome_journal: 0,
    activation: 0,
    cleanup: 0,
    checkpoint: 0,
    promotion: 0,
  };

  async verifyCapability(claims: CapabilityClaimsV1): Promise<AuthenticatedEffectBindingsV1> {
    this.calls.capability += 1;
    return {
      actor_principal: claims.fence.actor_principal,
      lease_holder_principal: claims.fence.lease_holder_principal,
      operation_executor_principal: claims.fence.operation_executor_principal,
      audience: claims.fence.audience,
    };
  }

  async verifyCurrentEffectAuthorization(
    _claims: CapabilityClaimsV1,
    fence: CapabilityClaimsV1["fence"],
  ): Promise<AuthenticatedEffectBindingsV1> {
    this.calls.current_effect += 1;
    return {
      actor_principal: fence.actor_principal,
      lease_holder_principal: fence.lease_holder_principal,
      operation_executor_principal: fence.operation_executor_principal,
      audience: fence.audience,
    };
  }

  async verifyDispatchedJournalAnchor(
    anchor: DispatchedJournalAnchorV1,
    fence: CapabilityClaimsV1["fence"],
  ): Promise<AuthenticatedJournalBindingsV1> {
    this.calls.dispatch_journal += 1;
    return this.#journalBindings(anchor, fence);
  }

  async verifyReadProbeJournalAnchor(
    anchor: ReadProbeJournalAnchorV1,
    fence: CapabilityClaimsV1["fence"],
  ): Promise<AuthenticatedJournalBindingsV1> {
    this.calls.read_probe_journal += 1;
    return this.#journalBindings(anchor, fence);
  }

  async verifyProviderOutcomeAnchor(
    anchor: ProviderOutcomeAnchorV1,
    fence: CapabilityClaimsV1["fence"],
  ): Promise<AuthenticatedJournalBindingsV1> {
    this.calls.outcome_journal += 1;
    return this.#journalBindings(anchor, fence);
  }

  #journalBindings(
    anchor: DispatchedJournalAnchorV1 | ReadProbeJournalAnchorV1 | ProviderOutcomeAnchorV1,
    fence: CapabilityClaimsV1["fence"],
  ): AuthenticatedJournalBindingsV1 {
    return {
      actor_principal: fence.actor_principal,
      lease_holder_principal: fence.lease_holder_principal,
      operation_executor_principal: fence.operation_executor_principal,
      audience: fence.audience,
      anchor_schema_version: anchor.anchor_schema_version,
      journal_sequence: anchor.journal_sequence,
      prior_frontier_digest: anchor.prior_frontier_digest,
      record_digest: anchor.record_digest,
      frontier_digest: anchor.frontier_digest,
      envelope_digest: canonicalDigest(anchor),
      signer_principal: anchor.signer_principal,
      signing_key_id: anchor.signing_key_id,
      signature_verified: true,
      contiguous_predecessor_verified: true,
      stored_frontier_membership: this.stored_frontier_membership_valid as true,
    };
  }

  async verifyActivationGrant(_grant: ActivationGrantV1): Promise<void> {
    this.calls.activation += 1;
  }

  async verifyCleanupGrant(_grant: InfinityCleanupGrantV1): Promise<void> {
    this.calls.cleanup += 1;
  }

  async verifyCheckpointReceipt(_receipt: CheckpointDurabilityReceiptV1): Promise<void> {
    this.calls.checkpoint += 1;
  }

  async verifyGitPromotionReceipt(_receipt: GitPromotionReceiptRefV1): Promise<void> {
    this.calls.promotion += 1;
  }

  async verifyAdapterAdmission(
    descriptor: AdapterDescriptorV1,
  ): Promise<AuthenticatedAdapterAdmissionV1> {
    return {
      adapter_id: descriptor.adapter_id,
      adapter_version: descriptor.adapter_version,
      installation_id: descriptor.installation_id,
      provider_scope_ref: descriptor.provider_scope_ref,
      build_sha256: descriptor.build_sha256,
      descriptor_sha256: descriptor.descriptor_sha256,
      conformance_manifest_sha256: sha256(`conformance:${descriptor.descriptor_sha256}`),
      signed_conformance_manifest_verified: true,
      zero_skip_gate_verified: true,
    };
  }

  async verifyJournalRecoveryRange(
    range: EffectJournalRecoveryRangeV1,
  ): Promise<AuthenticatedJournalRecoveryRangeV1> {
    return {
      operation_id: range.operation_id,
      operation_step_id: range.operation_step_id,
      requested_from_sequence: range.requested_from_sequence,
      signed_head_sequence: range.signed_head_sequence,
      signed_head_frontier_digest: range.signed_head_frontier_digest,
      completeness_proof_sha256: range.completeness_proof_sha256,
      signer_principal: range.signer_principal,
      signing_key_id: range.signing_key_id,
      head_signature_verified: this.journal_range_completeness_valid as true,
      range_completeness_verified: this.journal_range_completeness_valid as true,
      stored_head_membership: this.journal_range_completeness_valid as true,
    };
  }
}

/** Hermetic stand-in for the node/gateway safety fence. */
export class DeterministicTestPhysicalSafetyControllerV1 implements PhysicalSafetyControllerV1 {
  readonly calls: Array<{ resource_id: string; reason: string }> = [];
  readonly observations: SafetyFenceObservationV1[] = [];
  readonly #fencedResources = new Set<string>();

  async fenceResource(input: {
    resource_id: string;
    resource_lifecycle_generation: bigint;
    reason: SafetyFenceObservationV1["reason"];
    observed_at: string;
  }): Promise<SafetyFenceObservationV1> {
    this.calls.push({ resource_id: input.resource_id, reason: input.reason });
    this.#fencedResources.add(input.resource_id);
    const observation: SafetyFenceObservationV1 = {
      schema_version: "sandboxes.safety-fence/v1",
      resource_id: input.resource_id,
      resource_lifecycle_generation: input.resource_lifecycle_generation,
      reason: input.reason,
      installed_policy_sha256: sha256(`safety-policy:${input.resource_id}:${input.reason}`),
      process_stop_evidence_sha256: sha256(`process-stop:${input.resource_id}:${input.observed_at}`),
      network_close_evidence_sha256: sha256(`network-close:${input.resource_id}:${input.observed_at}`),
      observed_at: input.observed_at,
      signer_principal: "principal_00000000000000000000000000000063",
    };
    this.observations.push(structuredClone(observation));
    return observation;
  }

  async assertProviderDispatchAllowed(input: {
    resource_id: string;
    operation: import("./types.js").SandboxOperation;
    fence: import("./types.js").CanonicalSandboxEffectFenceV1;
    dispatch_anchor_sha256: Digest;
  }): Promise<void> {
    if (
      this.#fencedResources.has(input.resource_id) &&
      ["begin_create_inert", "begin_activate"].includes(input.operation)
    ) {
      throw new Error("physical safety dispatch gate is closed");
    }
  }
}

export class DeterministicTestProviderOutcomeJournalV1 implements ProviderOutcomeJournalV1 {
  readonly calls: Array<{ operation_id: string; outcome_kind: string }> = [];
  readonly #byEnvelopeDigest = new Map<Digest, ProviderOutcomeAnchorV1>();
  constructor(readonly ledger = new DeterministicTestJournalLedgerV1()) {}

  async appendOutcome(
    input: Parameters<ProviderOutcomeJournalV1["appendOutcome"]>[0],
  ): Promise<ProviderOutcomeAnchorV1> {
    this.calls.push({ operation_id: input.operation_id, outcome_kind: input.outcome_kind });
    const record = {
      schema_version: "sandboxes.runtime/v1" as const,
      record_kind: "OUTCOME" as const,
      outcome_schema_version: EFFECT_JOURNAL_OUTCOME_SCHEMA_VERSION,
      outcome_schema_digest: EFFECT_JOURNAL_OUTCOME_SCHEMA_DIGEST,
      operation_id: input.operation_id,
      operation_step_id: input.operation_step_id,
      operation_execution_epoch: input.operation_execution_epoch,
      dispatch_anchor_sha256: input.dispatch_anchor_sha256,
      outcome_kind: input.outcome_kind,
      outcome_sha256: input.outcome_sha256,
      recorded_at: input.recorded_at,
      fence: input.fence,
      target: input.target,
    };
    const core = {
      anchor_schema_version: "infinity.effect-journal-anchor/v1" as const,
      journal_sequence: 1_000_000n + BigInt(this.calls.length),
      prior_frontier_digest: sha256(`outcome-prior:${this.calls.length}`),
      record_digest: canonicalDigest(record),
      signer_principal: "principal_00000000000000000000000000000061",
      signing_key_id: "key_00000000000000000000000000000061",
    };
    const anchor: ProviderOutcomeAnchorV1 = {
      ...core,
      frontier_digest: canonicalDigest(core),
      signature: "C".repeat(86),
      record,
    };
    this.#byEnvelopeDigest.set(canonicalDigest(anchor), structuredClone(anchor));
    this.ledger.record(anchor);
    return anchor;
  }

  async readOutcome(envelopeDigest: Digest): Promise<ProviderOutcomeAnchorV1 | undefined> {
    const anchor = this.#byEnvelopeDigest.get(envelopeDigest);
    return anchor === undefined ? undefined : structuredClone(anchor);
  }

  forgetOutcome(envelopeDigest: Digest): void {
    this.#byEnvelopeDigest.delete(envelopeDigest);
  }
}

export class DeterministicTestProviderDispatchJournalV1 implements ProviderDispatchJournalV1 {
  readonly calls: DispatchedJournalAnchorV1[] = [];
  onAppend: ((anchor: DispatchedJournalAnchorV1) => void | Promise<void>) | undefined;
  failure: Error | undefined;
  constructor(readonly ledger = new DeterministicTestJournalLedgerV1()) {}

  async appendDispatched(anchor: DispatchedJournalAnchorV1): Promise<DispatchedJournalAnchorV1> {
    this.calls.push(structuredClone(anchor));
    await this.onAppend?.(anchor);
    if (this.failure !== undefined) throw this.failure;
    this.ledger.record(anchor);
    return structuredClone(anchor);
  }

  async readDispatched(envelopeDigest: Digest): Promise<DispatchedJournalAnchorV1 | undefined> {
    const anchor = this.calls.find((candidate) => canonicalDigest(candidate) === envelopeDigest);
    return anchor === undefined ? undefined : structuredClone(anchor);
  }
}

export class DeterministicTestProviderReadProbeJournalV1 implements ProviderReadProbeJournalV1 {
  readonly calls: Array<{ operation_id: string; operation_step_id: string }> = [];
  readonly #byEnvelopeDigest = new Map<Digest, ReadProbeJournalAnchorV1>();
  constructor(readonly ledger = new DeterministicTestJournalLedgerV1()) {}

  async appendReadProbe(
    input: Parameters<ProviderReadProbeJournalV1["appendReadProbe"]>[0],
  ): Promise<ReadProbeJournalAnchorV1> {
    this.calls.push({ operation_id: input.operation_id, operation_step_id: input.operation_step_id });
    const record = {
      schema_version: input.fence.audience,
      state: "read_probe" as const,
      operation_id: input.operation_id,
      operation_step_id: input.operation_step_id,
      operation_digest: input.request_sha256,
      resource_id: input.fence.resource_id,
      recorded_at: input.recorded_at,
      expires_at: input.fence.operation_execution_expires_at,
      fence: input.fence,
      target: input.target,
      discovery_scope: input.discovery_scope,
    };
    const core = {
      anchor_schema_version: "infinity.effect-journal-anchor/v1" as const,
      journal_sequence: 2_000_000n + BigInt(this.calls.length),
      prior_frontier_digest: sha256(`read-probe-prior:${this.calls.length}`),
      record_digest: canonicalDigest(record),
      signer_principal: "principal_00000000000000000000000000000062",
      signing_key_id: "key_00000000000000000000000000000062",
    };
    const anchor: ReadProbeJournalAnchorV1 = {
      ...core,
      frontier_digest: canonicalDigest(core),
      signature: "D".repeat(86),
      record,
    };
    this.#byEnvelopeDigest.set(canonicalDigest(anchor), structuredClone(anchor));
    this.ledger.record(anchor);
    return anchor;
  }

  async readReadProbe(envelopeDigest: Digest): Promise<ReadProbeJournalAnchorV1 | undefined> {
    const anchor = this.#byEnvelopeDigest.get(envelopeDigest);
    return anchor === undefined ? undefined : structuredClone(anchor);
  }
}
