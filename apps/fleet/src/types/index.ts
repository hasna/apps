// === Fleet domain types, enums, and error classes ===
//
// fleet is a READ-ONLY AgentOps control tower. Its OWNED, writable domain is the
// config layer (SLOs, error-budget policies, saved views, alert thresholds,
// annotations). The fused observability layer (health/burn/cost/traces/slo-status/
// alerts) is derived read-only from upstream adapters and is never persisted as
// source-of-truth.

export type TargetType = "agent" | "company";

export type SloObjective = "availability" | "success_rate" | "error_rate" | "latency_p95";

export type Severity = "info" | "warning" | "critical";

export type Comparator = "gt" | "gte" | "lt" | "lte";

export type SavedViewKind = "dashboard" | "trace" | "burn" | "slo";

export type AlertState = "ok" | "breaching" | "exhausted";

// --- Config (writable) rows ---

export interface SavedView {
  id: string;
  entity_id: string;
  entity_slug: string | null;
  name: string;
  kind: SavedViewKind;
  spec: Record<string, unknown>;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface Slo {
  id: string;
  entity_id: string;
  entity_slug: string | null;
  target_type: TargetType;
  target_ref: string; // agent id/name or company id/name the SLO governs
  name: string;
  objective: SloObjective;
  target_value: number; // e.g. 99.5 (%) or a latency ms budget
  window_days: number;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface ErrorBudgetPolicy {
  id: string;
  slo_id: string;
  entity_id: string;
  budget_percent: number; // allowed unreliability, e.g. 0.5 means 0.5% error budget
  burn_alert_threshold: number; // fraction of budget consumed that triggers alert, e.g. 0.8
  window_days: number;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface AlertThreshold {
  id: string;
  entity_id: string;
  slo_id: string | null;
  metric: string; // e.g. "error_rate", "token_burn_per_hour", "cost_usd_per_day"
  comparator: Comparator;
  threshold_value: number;
  severity: Severity;
  enabled: boolean;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface Annotation {
  id: string;
  entity_id: string;
  target_ref: string;
  at: string; // ISO timestamp the annotation marks
  text: string;
  author: string;
  version: number;
  created_at: string;
  updated_at: string;
}

// --- Fused (read-only) shapes ---

export interface HealthRollup {
  entity_id: string;
  target_type: TargetType;
  target_ref: string;
  window_days: number;
  availability: number; // %
  success_rate: number; // %
  error_rate: number; // %
  latency_p95_ms: number;
  requests: number;
  errors: number;
  eval_score: number | null; // 0..1 from evals adapter, null if none
  status: "healthy" | "degraded" | "unhealthy";
  generated_at: string;
}

export interface TokenBurn {
  entity_id: string;
  target_type: TargetType;
  target_ref: string;
  window_days: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  tokens_per_hour: number;
  generated_at: string;
}

export interface CostSummary {
  entity_id: string;
  target_type: TargetType;
  target_ref: string;
  window_days: number;
  cost_usd: number;
  cost_per_day_usd: number;
  by_model: { model: string; cost_usd: number; total_tokens: number }[];
  generated_at: string;
}

export interface TraceSummary {
  trace_id: string;
  entity_id: string;
  target_ref: string;
  session_id: string;
  started_at: string;
  duration_ms: number;
  status: "ok" | "error";
  spans: number;
  total_tokens: number;
  cost_usd: number;
}

export interface TraceSpan {
  span_id: string;
  parent_span_id: string | null;
  name: string;
  kind: string; // "tool" | "llm" | "log" | ...
  started_at: string;
  duration_ms: number;
  status: "ok" | "error";
  attributes: Record<string, unknown>;
}

export interface TraceDetail extends TraceSummary {
  spans_detail: TraceSpan[];
}

export interface SloStatus {
  slo_id: string;
  entity_id: string;
  target_type: TargetType;
  target_ref: string;
  objective: SloObjective;
  target_value: number;
  observed_value: number;
  window_days: number;
  meeting: boolean;
  error_budget_percent: number | null;
  error_budget_consumed: number | null; // 0..1 fraction consumed
  error_budget_remaining: number | null; // 0..1 fraction remaining
  burn_alert: boolean;
  state: AlertState;
  generated_at: string;
}

export interface FleetAlert {
  id: string; // deterministic: `${slo_id|threshold_id}:${window}`
  entity_id: string;
  source: "slo" | "threshold";
  ref_id: string; // slo_id or threshold_id
  target_ref: string;
  metric: string;
  severity: Severity;
  observed_value: number;
  threshold_value: number;
  message: string;
  state: AlertState;
  generated_at: string;
}

// === Error classes (code + suggestion, mirrors the reference envelope) ===

export class ValidationError extends Error {
  static code = "VALIDATION_ERROR";
  static suggestion = "Check the input fields against the operation schema and retry.";
  code = ValidationError.code;
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export class VersionConflictError extends Error {
  static code = "VERSION_CONFLICT";
  static suggestion = "Fetch the latest version and retry.";
  code = VersionConflictError.code;
  constructor(public expectedVersion: number, public actualVersion: number) {
    super(`Version conflict: expected ${expectedVersion}, actual ${actualVersion}`);
    this.name = "VersionConflictError";
  }
}

export class PermissionDeniedError extends Error {
  static code = "PERMISSION_DENIED";
  static suggestion = "Use a credential whose role/scope permits this action for this entity.";
  code = PermissionDeniedError.code;
  constructor(action: string, resource?: string) {
    super(`Permission denied for ${action}${resource ? ` on ${resource}` : ""}.`);
    this.name = "PermissionDeniedError";
  }
}

export class EntityAccessDeniedError extends Error {
  static code = "ENTITY_ACCESS_DENIED";
  static suggestion = "Knowing an entity_id is not access; request a credential scoped to this entity.";
  code = EntityAccessDeniedError.code;
  constructor(entityId: string) {
    super(`Credential is not scoped to entity ${entityId}.`);
    this.name = "EntityAccessDeniedError";
  }
}

export class ReadOnlyResourceError extends Error {
  static code = "READ_ONLY_RESOURCE";
  static suggestion = "fleet is read-only w.r.t. upstream observability; only config resources are writable.";
  code = ReadOnlyResourceError.code;
  constructor(resource: string) {
    super(`Resource '${resource}' is read-only in fleet.`);
    this.name = "ReadOnlyResourceError";
  }
}

export class SavedViewNotFoundError extends Error {
  static code = "SAVED_VIEW_NOT_FOUND";
  static suggestion = "Use saved-view list to find the correct view ID.";
  code = SavedViewNotFoundError.code;
  constructor(id: string) {
    super(`Saved view not found: ${id}`);
    this.name = "SavedViewNotFoundError";
  }
}

export class SloNotFoundError extends Error {
  static code = "SLO_NOT_FOUND";
  static suggestion = "Use slo list to find the correct SLO ID.";
  code = SloNotFoundError.code;
  constructor(id: string) {
    super(`SLO not found: ${id}`);
    this.name = "SloNotFoundError";
  }
}

export class ErrorBudgetPolicyNotFoundError extends Error {
  static code = "ERROR_BUDGET_POLICY_NOT_FOUND";
  static suggestion = "Use error-budget list to find the correct policy ID.";
  code = ErrorBudgetPolicyNotFoundError.code;
  constructor(id: string) {
    super(`Error budget policy not found: ${id}`);
    this.name = "ErrorBudgetPolicyNotFoundError";
  }
}

export class AlertThresholdNotFoundError extends Error {
  static code = "ALERT_THRESHOLD_NOT_FOUND";
  static suggestion = "Use alert-threshold list to find the correct threshold ID.";
  code = AlertThresholdNotFoundError.code;
  constructor(id: string) {
    super(`Alert threshold not found: ${id}`);
    this.name = "AlertThresholdNotFoundError";
  }
}

export class AnnotationNotFoundError extends Error {
  static code = "ANNOTATION_NOT_FOUND";
  static suggestion = "Use annotation list to find the correct annotation ID.";
  code = AnnotationNotFoundError.code;
  constructor(id: string) {
    super(`Annotation not found: ${id}`);
    this.name = "AnnotationNotFoundError";
  }
}

export class TraceNotFoundError extends Error {
  static code = "TRACE_NOT_FOUND";
  static suggestion = "Use trace list to find an available trace ID for this entity.";
  code = TraceNotFoundError.code;
  constructor(id: string) {
    super(`Trace not found: ${id}`);
    this.name = "TraceNotFoundError";
  }
}

export class SloNotEvaluableError extends Error {
  static code = "SLO_NOT_EVALUABLE";
  static suggestion = "The SLO objective has no matching fused metric; check the objective.";
  code = SloNotEvaluableError.code;
  constructor(objective: string) {
    super(`SLO objective not evaluable: ${objective}`);
    this.name = "SloNotEvaluableError";
  }
}

export type FleetError =
  | ValidationError
  | VersionConflictError
  | PermissionDeniedError
  | EntityAccessDeniedError
  | ReadOnlyResourceError
  | SavedViewNotFoundError
  | SloNotFoundError
  | ErrorBudgetPolicyNotFoundError
  | AlertThresholdNotFoundError
  | AnnotationNotFoundError
  | TraceNotFoundError
  | SloNotEvaluableError;

export interface ErrorEnvelope {
  code: string;
  message: string;
  suggestion: string;
}

/** Normalize any thrown value to the canonical { code, message, suggestion } envelope. */
export function toErrorEnvelope(error: unknown): ErrorEnvelope {
  if (error instanceof Error && "code" in error && typeof (error as { code?: unknown }).code === "string") {
    return {
      code: (error as { code: string }).code,
      message: error.message,
      suggestion: (error.constructor as { suggestion?: string }).suggestion ?? "",
    };
  }
  if (error instanceof Error) {
    return { code: "INTERNAL_ERROR", message: error.message, suggestion: "Check the error message and retry." };
  }
  return { code: "UNKNOWN_ERROR", message: String(error), suggestion: "An unexpected error occurred." };
}
