/**
 * Shared adapter contracts for monitor-v2 native integrations (design §4).
 *
 * Vocabulary mirrors the slug_effects persistence model (design §5):
 * effect_key, integration, operation, target, state, request_digest,
 * external_id, result_pointer, last_error_class, created_at, updated_at.
 */

export type IntegrationName =
  | "todos"
  | "conversations"
  | "mementos"
  | "knowledge"
  | "skills"
  | "hooks"
  | "loops"
  | "files";

/** Effect states from the slug_effects table (design §5). */
export type EffectState = "planned" | "sent" | "confirmed" | "unknown" | "failed";

/**
 * Failure classification persisted per effect. "timeout" is an ambiguous
 * outcome: the effect may or may not have landed, so the state is "unknown"
 * and the caller reconciles before retrying (design §6 ambiguous outcomes).
 */
export type FailureClass =
  | "not_found"
  | "timeout"
  | "execution_error"
  | "invalid_input"
  | "unknown";

/**
 * The stable identity of one planned effect. The effect key is
 * hash(slug, run_id, action_index, target, operation) — the five components
 * the design names — and makes retries and ambiguity reconciliation
 * idempotent.
 */
export interface EffectRequest {
  slug: string;
  runId: string;
  actionIndex: number;
  target: string;
  operation: string;
}

/** Classified outcome of one adapter invocation. */
export interface EffectOutcome {
  state: EffectState;
  /** Package-owned external id when the surface returns one; hooks return none. */
  externalId?: string | null;
  /** Bounded pointer (digest) to the effect result; never raw content. */
  resultPointer?: string | null;
  lastErrorClass?: FailureClass | null;
  /** Bounded error detail for failure and unknown states. */
  errorDetail?: string;
}

/**
 * Persisted effect record. Field-for-field the slug_effects row (camelCase);
 * the SQLEffectStore implemented by MON-V2-02/03 will persist the same shape.
 *
 * `externalId` is null while the outcome is failed or unknown: no loop is
 * proven for the CURRENT request digest. An ambiguous prior (timeout) may
 * still have a committed loop in the surface store — the caller reconciles
 * by the effect label before creating (adapter contract; never retry by
 * creating on top of an unconfirmed prior).
 */
export interface EffectRecord {
  effectKey: string;
  integration: IntegrationName;
  operation: string;
  target: string;
  state: EffectState;
  requestDigest: string;
  externalId: string | null;
  resultPointer: string | null;
  lastErrorClass: FailureClass | null;
  createdAt: string;
  updatedAt: string;
}
