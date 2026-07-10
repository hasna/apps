import { canonicalJson, sha256, type Digest } from "./canonical.js";
import { SandboxError } from "./errors.js";

export const EFFECT_JOURNAL_OUTCOME_SCHEMA_VERSION =
  "infinity.effect-journal-outcome/v1" as const;

export const EFFECT_JOURNAL_OUTCOME_KINDS = [
  "succeeded",
  "failed_effect",
  "failed_no_effect",
  "reconciliation_blocked",
] as const;

export type EffectJournalOutcomeKindV1 =
  (typeof EFFECT_JOURNAL_OUTCOME_KINDS)[number];

export const EFFECT_JOURNAL_OUTCOME_SCHEMA = Object.freeze({
  schema_version: EFFECT_JOURNAL_OUTCOME_SCHEMA_VERSION,
  record_kind: "OUTCOME" as const,
  outcome_kinds: Object.freeze([...EFFECT_JOURNAL_OUTCOME_KINDS]),
  ambiguity_outcome: "reconciliation_blocked" as const,
  unknown_representation: "DISPATCHED_WITHOUT_OUTCOME" as const,
});

export const EFFECT_JOURNAL_OUTCOME_SCHEMA_CANONICAL_BYTES =
  '{"ambiguity_outcome":"reconciliation_blocked","outcome_kinds":["succeeded","failed_effect","failed_no_effect","reconciliation_blocked"],"record_kind":"OUTCOME","schema_version":"infinity.effect-journal-outcome/v1","unknown_representation":"DISPATCHED_WITHOUT_OUTCOME"}' as const;

export const EFFECT_JOURNAL_OUTCOME_SCHEMA_DIGEST =
  "sha256:7ab380a0475ebf79d2ed925e20bcbb9303d78a56c358d09adbdce796e740bf20" as Digest;

export const RECONCILIATION_BLOCKED_MAPPING_FIXTURE = Object.freeze({
  mapping_schema_version: "infinity.effect-outcome-mapping/v1" as const,
  source_outcome_schema_version: EFFECT_JOURNAL_OUTCOME_SCHEMA_VERSION,
  source_outcome_schema_digest: EFFECT_JOURNAL_OUTCOME_SCHEMA_DIGEST,
  external_outcome_kind: "reconciliation_blocked" as const,
  infinity_operation_state: "quarantined" as const,
  infinity_resource_state: "quarantined" as const,
});

if (
  canonicalJson(EFFECT_JOURNAL_OUTCOME_SCHEMA) !==
    EFFECT_JOURNAL_OUTCOME_SCHEMA_CANONICAL_BYTES ||
  sha256(EFFECT_JOURNAL_OUTCOME_SCHEMA_CANONICAL_BYTES) !==
    EFFECT_JOURNAL_OUTCOME_SCHEMA_DIGEST
) {
  throw new SandboxError(
    "integrity_failed",
    "Frozen Infinity effect-journal outcome schema bytes or digest changed",
  );
}

export function assertEffectJournalOutcomeSchema(
  version: unknown,
  digest: unknown,
): void {
  if (
    version !== EFFECT_JOURNAL_OUTCOME_SCHEMA_VERSION ||
    digest !== EFFECT_JOURNAL_OUTCOME_SCHEMA_DIGEST
  ) {
    throw new SandboxError(
      "protocol_incompatible",
      "Effect-journal outcome schema version or digest mismatch",
    );
  }
}
