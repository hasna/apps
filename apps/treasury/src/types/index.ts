// Domain types, enums, and error classes for treasury.
// Money is stored and computed in integer MINOR units (e.g. cents) to avoid
// floating-point drift; each amount carries an ISO-4217 currency code.

export type Iso4217 = string;

export interface EntityRef {
  entity_id: string; // UUIDv4 — unguessable, NOT enumerable (BUILD-SPEC §1c)
  entity_slug: string | null;
  name: string;
  base_currency: Iso4217;
  created_at: string;
  updated_at: string;
}

export type AccountKind = "bank" | "wallet";

export interface BalanceSnapshot {
  id: string;
  entity_id: string;
  account_ref: string; // opaque upstream account/wallet id
  account_kind: AccountKind;
  currency: Iso4217;
  amount_minor: number; // integer minor units
  as_of: string; // ISO8601 — the moment the balance was observed
  source: string; // adapter/provider name (provenance)
  captured_at: string; // when treasury cached it
}

export interface FxRate {
  id: string;
  base_currency: Iso4217;
  quote_currency: Iso4217;
  rate: number; // 1 base = rate quote
  as_of: string;
  source: string;
  captured_at: string;
}

export interface CostFeed {
  id: string;
  entity_id: string;
  currency: Iso4217;
  monthly_burn_minor: number; // net monthly cash outflow, minor units
  as_of: string;
  source: string;
  captured_at: string;
}

export interface CurrencyExposure {
  currency: Iso4217;
  total_minor: number;
  in_base_minor: number; // converted to the reporting base currency
}

export interface FxExposureReport {
  base_currency: Iso4217;
  as_of: string;
  total_in_base_minor: number;
  exposures: CurrencyExposure[];
}

export interface RunwayReport {
  scope: "entity" | "group";
  entity_id: string | null;
  base_currency: Iso4217;
  cash_in_base_minor: number;
  monthly_burn_in_base_minor: number;
  runway_months: number | null; // null = infinite (no burn)
  as_of: string;
}

export interface ForecastPoint {
  month_index: number; // 0 = now
  month: string; // YYYY-MM
  projected_cash_in_base_minor: number;
}

export interface CashForecast {
  scope: "entity" | "group";
  entity_id: string | null;
  base_currency: Iso4217;
  horizon_months: number;
  starting_cash_in_base_minor: number;
  monthly_burn_in_base_minor: number;
  points: ForecastPoint[];
  as_of: string;
}

export type SweepStatus = "recommended" | "acknowledged" | "dismissed";

/**
 * A sweep / intercompany-funding RECOMMENDATION. Treasury is read/advisory and
 * NEVER moves money itself — executing a recommendation must be requested
 * through iapp-controls, which issues the single-use authorization token.
 */
export interface SweepRecommendation {
  id: string;
  from_entity_id: string;
  to_entity_id: string;
  currency: Iso4217;
  amount_minor: number;
  rationale: string;
  status: SweepStatus;
  requires_controls_authorization: true; // advisory-only invariant, always true
  created_at: string;
  updated_at: string;
}

export interface AuditEvent {
  id: number;
  entity_id: string | null;
  actor_id: string;
  action: string;
  detail: string;
  prev_hash: string;
  row_hash: string;
  created_at: string;
}

// ---- Error classes (code + message + suggestion; parity across surfaces) ----

export class TreasuryError extends Error {
  static suggestion = "";
  code = "INTERNAL_ERROR";
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class EntityNotFoundError extends TreasuryError {
  static suggestion = "Use `treasury entities list` to find the correct entity_id.";
  code = "ENTITY_NOT_FOUND";
  constructor(id: string) {
    super(`Entity not found: ${id}`);
  }
}

export class SweepNotFoundError extends TreasuryError {
  static suggestion = "Use `treasury sweeps list` to find the correct sweep id.";
  code = "SWEEP_NOT_FOUND";
  constructor(id: string) {
    super(`Sweep recommendation not found: ${id}`);
  }
}

export class ValidationError extends TreasuryError {
  static suggestion = "Check the request fields and retry.";
  code = "VALIDATION_ERROR";
  constructor(message: string) {
    super(message);
  }
}

export class PermissionDeniedError extends TreasuryError {
  static suggestion = "Your credential lacks the required scope or entity access.";
  code = "PERMISSION_DENIED";
  constructor(action: string, resource?: string) {
    super(`Permission denied for '${action}'${resource ? ` on ${resource}` : ""}.`);
  }
}

export class UnauthorizedError extends TreasuryError {
  static suggestion = "Provide a valid Bearer credential.";
  code = "UNAUTHORIZED";
  constructor(message = "Invalid or missing credential.") {
    super(message);
  }
}
