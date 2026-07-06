// Domain types, enums, and error classes for consolidations.

export type StatementType = "pl" | "bs" | "cf";
export type AccountType = "asset" | "liability" | "equity" | "revenue" | "expense";
export type RateType = "closing" | "average";
export type RunStatus = "draft" | "computed" | "finalized";
export type EliminationKind = "intercompany_balance" | "intercompany_revenue" | "investment";
export type GlImportStatus = "imported" | "mapped" | "stale";

/** A cached reference to a group entity (system-of-record is @hasna/entities). */
export interface Entity {
  id: string; // UUIDv4
  slug: string;
  name: string;
  functional_currency: string;
  country: string;
  created_at: string;
}

/** A single trial-balance / GL line pulled from an entity's accounting system. */
export interface GlLine {
  account_code: string;
  account_name: string;
  account_type: AccountType;
  balance: number; // signed, in the entity's functional currency
}

/** A per-entity, per-period GL / trial-balance import (via the accounting adapter). */
export interface GlImport {
  id: string;
  entity_id: string;
  period: string; // e.g. "2026-Q1" or "2026-03"
  source: string; // adapter provenance, e.g. "iapp-accounting:fixture"
  currency: string;
  status: GlImportStatus;
  lines: GlLine[];
  imported_at: string;
}

/** Maps an entity's local chart-of-accounts code onto the group COA. */
export interface CoaMapping {
  id: string;
  entity_id: string;
  local_account_code: string;
  group_account_code: string;
  group_account_name: string;
  statement: StatementType;
  section: string;
  created_at: string;
}

/** A period FX rate used to translate entity-currency balances to group currency. */
export interface FxRate {
  id: string;
  period: string;
  from_currency: string;
  to_currency: string;
  rate: number;
  rate_type: RateType;
  created_at: string;
}

/** An intercompany elimination entry that nets matched balances across entities. */
export interface Elimination {
  id: string;
  run_id: string | null;
  period: string;
  entity_id_from: string;
  entity_id_to: string;
  group_account_code: string;
  amount: number; // in reporting currency
  currency: string;
  kind: EliminationKind;
  description: string;
  matched: boolean;
  created_at: string;
}

/** A consolidation run for a period over a set of entities. */
export interface Run {
  id: string;
  period: string;
  reporting_currency: string;
  entity_ids: string[];
  status: RunStatus;
  created_at: string;
  computed_at: string | null;
  finalized_at: string | null;
}

/** A single line of a consolidated statement. */
export interface StatementLine {
  group_account_code: string;
  group_account_name: string;
  section: string;
  amount: number;
}

/** A consolidated statement (P&L, Balance Sheet, or Cash Flow) produced by a run. */
export interface Statement {
  id: string;
  run_id: string;
  statement_type: StatementType;
  currency: string;
  lines: StatementLine[];
  total: number;
  created_at: string;
}

/** Append-only audit event. */
export interface AuditEvent {
  id: number;
  event: string;
  actor_id: string;
  entity_id: string | null;
  detail: string;
  prev_hash: string;
  row_hash: string;
  created_at: string;
}

// --- Error classes (structured {code, message, suggestion}) ---

export class DomainError extends Error {
  static code = "INTERNAL_ERROR";
  static suggestion = "Check the error message and retry.";
  static status = 500;
  code: string;
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
    this.code = (new.target as typeof DomainError).code;
  }
}

export class ValidationError extends DomainError {
  static override code = "VALIDATION_ERROR";
  static override suggestion = "Fix the invalid field(s) and retry.";
  static override status = 400;
}

export class NotFoundError extends DomainError {
  static override code = "NOT_FOUND";
  static override suggestion = "Verify the id exists via the corresponding list operation.";
  static override status = 404;
}

export class PermissionDeniedError extends DomainError {
  static override code = "PERMISSION_DENIED";
  static override suggestion = "Use a credential with the required scope and entity access.";
  static override status = 403;
  constructor(action: string, resource?: string) {
    super(`Permission denied for '${action}'${resource ? ` on ${resource}` : ""}.`);
  }
}

export class UnauthorizedError extends DomainError {
  static override code = "UNAUTHORIZED";
  static override suggestion = "Provide a valid bearer token in the Authorization header.";
  static override status = 401;
}

export class ConflictError extends DomainError {
  static override code = "CONFLICT";
  static override suggestion = "Reconcile the conflicting state and retry.";
  static override status = 409;
}

export class InvalidRunStateError extends DomainError {
  static override code = "INVALID_RUN_STATE";
  static override suggestion = "Compute a draft run before finalizing; finalized runs are immutable.";
  static override status = 422;
}

const ERROR_CLASSES = [
  DomainError,
  ValidationError,
  NotFoundError,
  PermissionDeniedError,
  UnauthorizedError,
  ConflictError,
  InvalidRunStateError,
] as const;

const STATUS_BY_CODE: Record<string, number> = Object.fromEntries(
  ERROR_CLASSES.map((cls) => [cls.code, cls.status]),
);

const SUGGESTION_BY_CODE: Record<string, string> = Object.fromEntries(
  ERROR_CLASSES.map((cls) => [cls.code, cls.suggestion]),
);

export interface StructuredError {
  code: string;
  message: string;
  suggestion: string;
}

/** Normalize any thrown value into a structured {code, message, suggestion}. */
export function toStructuredError(error: unknown): StructuredError {
  if (error instanceof DomainError) {
    return { code: error.code, message: error.message, suggestion: SUGGESTION_BY_CODE[error.code] ?? "" };
  }
  if (error instanceof Error && "code" in error && typeof (error as { code?: unknown }).code === "string") {
    const code = (error as { code: string }).code;
    return { code, message: error.message, suggestion: SUGGESTION_BY_CODE[code] ?? "" };
  }
  if (error instanceof Error) {
    return { code: "INTERNAL_ERROR", message: error.message, suggestion: "Check the error message and retry." };
  }
  return { code: "UNKNOWN_ERROR", message: String(error), suggestion: "An unexpected error occurred." };
}

/** HTTP status for a structured error code (defaults to 500). */
export function statusForCode(code: string): number {
  return STATUS_BY_CODE[code] ?? 500;
}
