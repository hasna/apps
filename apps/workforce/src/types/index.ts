// Domain types, enums, and typed error classes for @hasna/workforce.
//
// The org treats humans, contractors AND autonomous agents as first-class
// members. Agents always have an owning human (owner_id). Records anchor to an
// entity via home_entity_id / entity_id (UUIDv4) per the cross-app contract.

export type MemberKind = "human" | "contractor" | "agent";
export const MEMBER_KINDS: MemberKind[] = ["human", "contractor", "agent"];

export type MemberStatus = "active" | "suspended" | "offboarded";
export const MEMBER_STATUSES: MemberStatus[] = ["active", "suspended", "offboarded"];

export type CapabilityLevel = "novice" | "intermediate" | "advanced" | "expert";
export const CAPABILITY_LEVELS: CapabilityLevel[] = ["novice", "intermediate", "advanced", "expert"];

export type LifecycleEventType = "hire" | "role_change" | "suspend" | "reactivate" | "offboard";
export const LIFECYCLE_EVENT_TYPES: LifecycleEventType[] = [
  "hire",
  "role_change",
  "suspend",
  "reactivate",
  "offboard",
];

export type AssignmentStatus = "active" | "ended";
export const ASSIGNMENT_STATUSES: AssignmentStatus[] = ["active", "ended"];

export interface Member {
  id: string;
  kind: MemberKind;
  name: string;
  owner_id: string | null;
  role: string;
  home_entity_id: string;
  home_entity_slug: string | null;
  status: MemberStatus;
  email: string | null;
  created_at: string;
  updated_at: string;
  version: number;
}

export interface Capability {
  id: string;
  member_id: string;
  name: string;
  category: string;
  level: CapabilityLevel;
  notes: string | null;
  created_at: string;
}

export interface LifecycleEvent {
  id: string;
  member_id: string;
  event_type: LifecycleEventType;
  effective_date: string;
  from_role: string | null;
  to_role: string | null;
  reason: string | null;
  recorded_at: string;
  prev_hash: string;
  row_hash: string;
}

export interface Assignment {
  id: string;
  member_id: string;
  entity_id: string;
  project: string | null;
  role_on_assignment: string;
  allocation_pct: number;
  start_date: string;
  end_date: string | null;
  status: AssignmentStatus;
  created_at: string;
  updated_at: string;
  version: number;
}

// ---- Error classes: every one carries `code` + static `suggestion` so all
// three surfaces (CLI/MCP/API) serialize identically to {code, message, suggestion}.

export class WorkforceError extends Error {
  static code = "WORKFORCE_ERROR";
  static suggestion = "";
  code: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = new.target.name;
    this.code = code ?? (new.target as typeof WorkforceError).code;
  }
}

export class MemberNotFoundError extends WorkforceError {
  static code = "MEMBER_NOT_FOUND";
  static suggestion = "Use list_members to find the correct member id.";
  constructor(id: string) {
    super(`Member not found: ${id}`, MemberNotFoundError.code);
  }
}

export class AssignmentNotFoundError extends WorkforceError {
  static code = "ASSIGNMENT_NOT_FOUND";
  static suggestion = "Use list_assignments to find the correct assignment id.";
  constructor(id: string) {
    super(`Assignment not found: ${id}`, AssignmentNotFoundError.code);
  }
}

export class CapabilityNotFoundError extends WorkforceError {
  static code = "CAPABILITY_NOT_FOUND";
  static suggestion = "Use list_capabilities to find the correct capability id.";
  constructor(id: string) {
    super(`Capability not found: ${id}`, CapabilityNotFoundError.code);
  }
}

export class ValidationError extends WorkforceError {
  static code = "VALIDATION_ERROR";
  static suggestion = "Check the field values against the documented enums and required fields.";
  constructor(message: string) {
    super(message, ValidationError.code);
  }
}

export class VersionConflictError extends WorkforceError {
  static code = "VERSION_CONFLICT";
  static suggestion = "Re-read the record to get the latest version, then retry the update.";
  constructor(message = "The record was modified by another writer.") {
    super(message, VersionConflictError.code);
  }
}

export class InvalidLifecycleTransitionError extends WorkforceError {
  static code = "INVALID_LIFECYCLE_TRANSITION";
  static suggestion = "Only hire→(role_change|suspend|offboard), suspend→reactivate, etc. are allowed.";
  constructor(message: string) {
    super(message, InvalidLifecycleTransitionError.code);
  }
}

export class PermissionDeniedError extends WorkforceError {
  static code = "PERMISSION_DENIED";
  static suggestion = "Request a credential with the required scope and entity/org access.";
  constructor(action: string, resource?: string) {
    super(`Permission denied for ${action}${resource ? ` on ${resource}` : ""}.`, PermissionDeniedError.code);
  }
}

export class UnauthorizedError extends WorkforceError {
  static code = "UNAUTHORIZED";
  static suggestion = "Provide a valid bearer token via the Authorization header.";
  constructor(message = "Invalid or missing credential.") {
    super(message, UnauthorizedError.code);
  }
}

export interface ErrorEnvelope {
  code: string;
  message: string;
  suggestion: string;
}

/** Normalize any thrown value into the canonical {code, message, suggestion} envelope. */
export function toErrorEnvelope(error: unknown): ErrorEnvelope {
  if (error instanceof WorkforceError) {
    return {
      code: error.code,
      message: error.message,
      suggestion: (error.constructor as typeof WorkforceError).suggestion ?? "",
    };
  }
  if (error instanceof Error && "code" in error && typeof (error as { code?: unknown }).code === "string") {
    const suggestion = (error.constructor as { suggestion?: string }).suggestion ?? "";
    return { code: (error as { code: string }).code, message: error.message, suggestion };
  }
  if (error instanceof Error) {
    return { code: "INTERNAL_ERROR", message: error.message, suggestion: "Check the error message and retry." };
  }
  return { code: "UNKNOWN_ERROR", message: String(error), suggestion: "An unexpected error occurred." };
}
