import type {
  AuthenticatedEffectBindingsV1,
  PhysicalSafetyControllerV1,
  ProviderDispatchJournalV1,
  ProviderReadProbeJournalV1,
  ProviderOutcomeJournalV1,
  SandboxesAuthorityVerifierV1,
} from "./service.js";
import { canonicalDigest, sha256, type Digest } from "./canonical.js";
import {
  EFFECT_JOURNAL_OUTCOME_SCHEMA_DIGEST,
  EFFECT_JOURNAL_OUTCOME_SCHEMA_VERSION,
} from "./effect-journal.js";
import type {
  ActivationGrantV1,
  CapabilityClaimsV1,
  CheckpointDurabilityReceiptV1,
  DispatchedJournalAnchorV1,
  GitPromotionReceiptRefV1,
  InfinityCleanupGrantV1,
  ReadProbeJournalAnchorV1,
  ProviderOutcomeAnchorV1,
  SafetyFenceObservationV1,
} from "./types.js";

/** Explicitly test-only verifier. Production code must inject an Infinity verifier. */
export class DeterministicTestAuthorityVerifierV1 implements SandboxesAuthorityVerifierV1 {
  readonly calls = {
    capability: 0,
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

  async verifyDispatchedJournalAnchor(
    _anchor: DispatchedJournalAnchorV1,
    fence: CapabilityClaimsV1["fence"],
  ): Promise<AuthenticatedEffectBindingsV1> {
    this.calls.dispatch_journal += 1;
    return {
      actor_principal: fence.actor_principal,
      lease_holder_principal: fence.lease_holder_principal,
      operation_executor_principal: fence.operation_executor_principal,
      audience: fence.audience,
    };
  }

  async verifyReadProbeJournalAnchor(
    _anchor: ReadProbeJournalAnchorV1,
    fence: CapabilityClaimsV1["fence"],
  ): Promise<AuthenticatedEffectBindingsV1> {
    this.calls.read_probe_journal += 1;
    return {
      actor_principal: fence.actor_principal,
      lease_holder_principal: fence.lease_holder_principal,
      operation_executor_principal: fence.operation_executor_principal,
      audience: fence.audience,
    };
  }

  async verifyProviderOutcomeAnchor(
    _anchor: ProviderOutcomeAnchorV1,
    fence: CapabilityClaimsV1["fence"],
  ): Promise<AuthenticatedEffectBindingsV1> {
    this.calls.outcome_journal += 1;
    return {
      actor_principal: fence.actor_principal,
      lease_holder_principal: fence.lease_holder_principal,
      operation_executor_principal: fence.operation_executor_principal,
      audience: fence.audience,
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

  async appendOutcome(
    input: Parameters<ProviderOutcomeJournalV1["appendOutcome"]>[0],
  ): Promise<ProviderOutcomeAnchorV1> {
    this.calls.push({ operation_id: input.operation_id, outcome_kind: input.outcome_kind });
    const base = {
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
      issuer_principal: "principal_00000000000000000000000000000061",
      frontier_sha256: sha256(
        `outcome-frontier:${input.operation_id}:${input.operation_step_id}:${input.operation_execution_epoch}:${input.outcome_kind}`,
      ),
      fence: input.fence,
      target: input.target,
      anchor_sha256: sha256("temporary-outcome-anchor"),
    };
    const { anchor_sha256: _ignored, ...protectedBytes } = base;
    return { ...base, anchor_sha256: canonicalDigest(protectedBytes) };
  }
}

export class DeterministicTestProviderDispatchJournalV1 implements ProviderDispatchJournalV1 {
  readonly calls: DispatchedJournalAnchorV1[] = [];
  onAppend: ((anchor: DispatchedJournalAnchorV1) => void) | undefined;
  failure: Error | undefined;

  async appendDispatched(anchor: DispatchedJournalAnchorV1): Promise<DispatchedJournalAnchorV1> {
    this.calls.push(structuredClone(anchor));
    this.onAppend?.(anchor);
    if (this.failure !== undefined) throw this.failure;
    return structuredClone(anchor);
  }
}

export class DeterministicTestProviderReadProbeJournalV1 implements ProviderReadProbeJournalV1 {
  readonly calls: Array<{ operation_id: string; operation_step_id: string }> = [];

  async appendReadProbe(
    input: Parameters<ProviderReadProbeJournalV1["appendReadProbe"]>[0],
  ): Promise<ReadProbeJournalAnchorV1> {
    this.calls.push({ operation_id: input.operation_id, operation_step_id: input.operation_step_id });
    const base = {
      schema_version: input.fence.audience,
      journal_anchor_id: `journal_${sha256(`read-probe-id:${input.operation_id}`).slice(7, 39)}`,
      state: "read_probe" as const,
      operation_id: input.operation_id,
      operation_step_id: input.operation_step_id,
      operation_digest: input.request_sha256,
      resource_id: input.fence.resource_id,
      recorded_at: input.recorded_at,
      expires_at: input.fence.operation_execution_expires_at,
      issuer_principal: "principal_00000000000000000000000000000062",
      frontier_sha256: sha256(`read-probe-frontier:${input.operation_id}:${input.operation_step_id}`),
      fence: input.fence,
      target: input.target,
      anchor_sha256: sha256("temporary-read-probe-anchor"),
    };
    const { anchor_sha256: _ignored, ...protectedBytes } = base;
    return { ...base, anchor_sha256: canonicalDigest(protectedBytes) };
  }
}
