// Domain types, enums, and error classes for the IP portfolio app.

export const ASSET_KINDS = ["trademark", "patent", "copyright", "brand_asset", "domain"] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

export const ASSET_STATUSES = ["draft", "pending", "registered", "abandoned", "expired"] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

export const REGISTRATION_KINDS = ["application", "registration"] as const;
export type RegistrationKind = (typeof REGISTRATION_KINDS)[number];

export const REGISTRATION_STATUSES = ["filed", "pending", "registered", "rejected", "lapsed"] as const;
export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number];

export const RENEWAL_STATUSES = ["upcoming", "due", "filed", "completed", "missed"] as const;
export type RenewalStatus = (typeof RENEWAL_STATUSES)[number];

export const DOCUMENT_TYPES = ["filing", "certificate", "assignment", "office_action", "evidence", "other"] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export interface EntityRef {
  entity_id: string;
  entity_slug: string | null;
  name: string;
  created_at: string;
}

export interface Asset {
  id: string;
  entity_id: string;
  kind: AssetKind;
  name: string;
  description: string | null;
  status: AssetStatus;
  created_at: string;
  updated_at: string;
}

export interface Registration {
  id: string;
  asset_id: string;
  jurisdiction: string;
  office: string | null;
  kind: RegistrationKind;
  app_number: string | null;
  reg_number: string | null;
  filing_date: string | null;
  registration_date: string | null;
  status: RegistrationStatus;
  created_at: string;
}

export interface Renewal {
  id: string;
  asset_id: string;
  registration_id: string | null;
  due_date: string;
  fee_amount: number | null;
  fee_currency: string | null;
  status: RenewalStatus;
  reminder_days: number;
  last_reminded_at: string | null;
  created_at: string;
}

export interface NiceClass {
  id: string;
  asset_id: string;
  nice_class: number;
  description: string | null;
  created_at: string;
}

export interface FilingDocument {
  id: string;
  asset_id: string;
  title: string;
  doc_type: DocumentType;
  doc_ref: string | null;
  created_at: string;
}

export interface AuditEvent {
  id: number;
  event_id: string;
  entity_id: string | null;
  action: string;
  resource: string;
  resource_id: string | null;
  actor_id: string;
  payload: string;
  prev_hash: string;
  row_hash: string;
  created_at: string;
}

// === Error classes ===
// Every domain error carries a machine `code` and a human `suggestion` so all
// three surfaces (CLI/MCP/API) normalize to the same {code, message, suggestion}.

export class AppError extends Error {
  readonly code: string;
  readonly status: number;
  readonly suggestion: string;
  constructor(code: string, message: string, status: number, suggestion: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.status = status;
    this.suggestion = suggestion;
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id: string) {
    super(
      `${resource.toUpperCase()}_NOT_FOUND`,
      `${resource} not found: ${id}`,
      404,
      `Use the list command/tool to find a valid ${resource} id.`,
    );
  }
}

export class ValidationError extends AppError {
  constructor(message: string, suggestion = "Check the input fields and try again.") {
    super("VALIDATION_ERROR", message, 400, suggestion);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, suggestion = "Resolve the conflicting record and retry.") {
    super("CONFLICT", message, 409, suggestion);
  }
}

export class PermissionDeniedError extends AppError {
  constructor(action: string, resource?: string) {
    super(
      "PERMISSION_DENIED",
      `Permission denied for action '${action}'${resource ? ` on ${resource}` : ""}.`,
      403,
      "Use a credential with the required scope and entity access.",
    );
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Invalid or missing API credential.") {
    super("UNAUTHORIZED", message, 401, "Provide a valid Bearer token.");
  }
}

export interface ErrorEnvelope {
  code: string;
  message: string;
  suggestion: string;
}

export function toErrorEnvelope(error: unknown): ErrorEnvelope {
  if (error instanceof AppError) {
    return { code: error.code, message: error.message, suggestion: error.suggestion };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { code: "INTERNAL_ERROR", message, suggestion: "" };
}

export function errorStatus(error: unknown): number {
  return error instanceof AppError ? error.status : 500;
}
