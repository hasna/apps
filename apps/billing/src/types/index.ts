/**
 * Domain types, enums, and error classes for @hasna/billing.
 *
 * Billing is a thin orchestration layer over Stripe Billing (NOT a rebuilt
 * engine). It mirrors Stripe subscription/invoice state and owns its own
 * derived dunning tables. Every record is anchored to an `entity_id` (the
 * seller entity, an unguessable UUIDv4) per BUILD-SPEC §1c.
 */

// ---- Enums ---------------------------------------------------------------

export const SUBSCRIPTION_STATUSES = [
  "trialing",
  "active",
  "past_due",
  "canceled",
  "unpaid",
  "paused",
  "incomplete",
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const INVOICE_STATUSES = ["draft", "open", "paid", "uncollectible", "void"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

/** Stripe payment decline codes we branch retry strategy on. */
export const DECLINE_CODES = [
  "insufficient_funds",
  "card_declined",
  "expired_card",
  "incorrect_cvc",
  "processing_error",
  "do_not_honor",
  "lost_card",
  "stolen_card",
  "generic_decline",
] as const;
export type DeclineCode = (typeof DECLINE_CODES)[number];

export const DUNNING_RUN_OUTCOMES = [
  "scheduled",
  "retry_succeeded",
  "retry_failed",
  "pre_dunning_notified",
  "downgraded",
  "canceled",
  "abandoned",
] as const;
export type DunningRunOutcome = (typeof DUNNING_RUN_OUTCOMES)[number];

export const EVENT_STATUSES = ["received", "processed", "ignored", "failed"] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

// ---- Row shapes ----------------------------------------------------------

export interface CustomerRow {
  id: string;
  entity_id: string;
  entity_slug: string | null;
  stripe_customer_id: string | null;
  email: string;
  name: string | null;
  currency: string;
  delinquent: number;
  created_at: string;
  updated_at: string;
}

export interface SubscriptionRow {
  id: string;
  entity_id: string;
  customer_id: string;
  stripe_subscription_id: string | null;
  plan: string;
  status: SubscriptionStatus;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: number;
  created_at: string;
  updated_at: string;
}

export interface InvoiceRow {
  id: string;
  entity_id: string;
  customer_id: string;
  subscription_id: string | null;
  stripe_invoice_id: string | null;
  amount_due: number;
  amount_paid: number;
  currency: string;
  status: InvoiceStatus;
  attempt_count: number;
  due_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface DunningPolicyRow {
  id: string;
  entity_id: string;
  name: string;
  /** JSON: decline_code -> retry schedule (offsets in hours) + actions. */
  rules_json: string;
  pre_dunning_hours: number;
  max_attempts: number;
  downgrade_plan: string | null;
  active: number;
  created_at: string;
  updated_at: string;
}

export interface DunningRunRow {
  id: string;
  entity_id: string;
  invoice_id: string;
  policy_id: string;
  attempt: number;
  decline_code: string | null;
  outcome: DunningRunOutcome;
  scheduled_at: string | null;
  executed_at: string | null;
  detail: string | null;
  created_at: string;
}

export interface EventRow {
  id: string;
  entity_id: string;
  /** Stripe event id — the idempotency key. */
  stripe_event_id: string;
  type: string;
  status: EventStatus;
  payload_json: string;
  received_at: string;
  processed_at: string | null;
}

export interface AuditRow {
  id: string;
  entity_id: string | null;
  actor_id: string;
  action: string;
  resource: string;
  resource_id: string | null;
  detail: string | null;
  prev_hash: string;
  row_hash: string;
  created_at: string;
}

// ---- Decline-code retry schedule ----------------------------------------

export interface RetryRule {
  /** Retry offsets after the failed charge, in hours. Empty = no retry. */
  retry_offsets_hours: number[];
  /** Terminal action if all retries are exhausted. */
  on_exhausted: "cancel" | "downgrade" | "mark_uncollectible" | "none";
}

export type RetrySchedule = Partial<Record<DeclineCode | "default", RetryRule>>;

// ---- Errors --------------------------------------------------------------

export class BillingError extends Error {
  static code = "BILLING_ERROR";
  static suggestion = "";
  code: string;
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
    this.code = (new.target as typeof BillingError).code;
  }
}

export class NotFoundError extends BillingError {
  static override code = "NOT_FOUND";
  static override suggestion = "Verify the id and that your credential is scoped to its entity.";
}
export class CustomerNotFoundError extends NotFoundError {
  static override code = "CUSTOMER_NOT_FOUND";
}
export class SubscriptionNotFoundError extends NotFoundError {
  static override code = "SUBSCRIPTION_NOT_FOUND";
}
export class InvoiceNotFoundError extends NotFoundError {
  static override code = "INVOICE_NOT_FOUND";
}
export class DunningPolicyNotFoundError extends NotFoundError {
  static override code = "DUNNING_POLICY_NOT_FOUND";
}
export class DunningRunNotFoundError extends NotFoundError {
  static override code = "DUNNING_RUN_NOT_FOUND";
}
export class EventNotFoundError extends NotFoundError {
  static override code = "EVENT_NOT_FOUND";
}

export class ValidationError extends BillingError {
  static override code = "VALIDATION_ERROR";
  static override suggestion = "Check the request fields and retry.";
}

export class InvalidTransitionError extends BillingError {
  static override code = "INVALID_TRANSITION";
  static override suggestion = "The requested state change is not allowed from the current status.";
}

export class WebhookVerificationError extends BillingError {
  static override code = "WEBHOOK_VERIFICATION_FAILED";
  static override suggestion =
    "Provide a valid Stripe-Signature (t=<unix>,v1=<hmac-sha256>) for the configured signing secret; forged or unsigned events are rejected.";
}

export class PermissionDeniedError extends BillingError {
  static override code = "PERMISSION_DENIED";
  static override suggestion = "Your credential lacks the required scope or entity access.";
  constructor(action: string, resource?: string) {
    super(`Permission denied for ${action}${resource ? ` on ${resource}` : ""}.`);
  }
}

export class UnauthorizedError extends BillingError {
  static override code = "UNAUTHORIZED";
  static override suggestion = "Provide a valid Bearer token.";
}

/** Extract the `{code, message, suggestion}` envelope for any surface. */
export function errorEnvelope(error: unknown): { code: string; message: string; suggestion: string } {
  if (error instanceof BillingError) {
    return {
      code: error.code,
      message: error.message,
      suggestion: (error.constructor as typeof BillingError).suggestion || "",
    };
  }
  if (error instanceof Error && "code" in error && typeof (error as { code?: unknown }).code === "string") {
    return { code: (error as { code: string }).code, message: error.message, suggestion: "" };
  }
  if (error instanceof Error) {
    return { code: "INTERNAL_ERROR", message: error.message, suggestion: "Check the error and retry." };
  }
  return { code: "UNKNOWN_ERROR", message: String(error), suggestion: "An unexpected error occurred." };
}

export const ERROR_STATUS: Record<string, number> = {
  NOT_FOUND: 404,
  CUSTOMER_NOT_FOUND: 404,
  SUBSCRIPTION_NOT_FOUND: 404,
  INVOICE_NOT_FOUND: 404,
  DUNNING_POLICY_NOT_FOUND: 404,
  DUNNING_RUN_NOT_FOUND: 404,
  EVENT_NOT_FOUND: 404,
  VALIDATION_ERROR: 400,
  INVALID_TRANSITION: 422,
  WEBHOOK_VERIFICATION_FAILED: 400,
  PERMISSION_DENIED: 403,
  UNAUTHORIZED: 401,
  INVALID_LIST_QUERY: 400,
  INTERNAL_ERROR: 500,
  UNKNOWN_ERROR: 500,
};
