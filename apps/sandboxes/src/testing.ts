import type {
  AuthenticatedEffectBindingsV1,
  SandboxesAuthorityVerifierV1,
} from "./service.js";
import type {
  ActivationGrantV1,
  CapabilityClaimsV1,
  CheckpointDurabilityReceiptV1,
  DispatchedJournalAnchorV1,
  GitPromotionReceiptRefV1,
  InfinityCleanupGrantV1,
} from "./types.js";

/** Explicitly test-only verifier. Production code must inject an Infinity verifier. */
export class DeterministicTestAuthorityVerifierV1 implements SandboxesAuthorityVerifierV1 {
  readonly calls = {
    capability: 0,
    dispatch_journal: 0,
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
