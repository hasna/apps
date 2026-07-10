import type { SandboxesAuthorityVerifierV1 } from "./service.js";
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

  async verifyCapability(_claims: CapabilityClaimsV1): Promise<void> {
    this.calls.capability += 1;
  }

  async verifyDispatchedJournalAnchor(_anchor: DispatchedJournalAnchorV1): Promise<void> {
    this.calls.dispatch_journal += 1;
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
