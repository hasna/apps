// ── Org ──────────────────────────────────────────────────────────────────────

export const ORG_ROLES = ["admin", "member", "service"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

export interface Org {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface CreateOrgInput {
  name: string;
  slug?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateOrgInput {
  name?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

// ── Agent ────────────────────────────────────────────────────────────────────

export type AgentStatus = "active" | "archived";

export interface Agent {
  id: string; // 8-char short UUID
  name: string;
  description: string | null;
  role: string | null;
  title: string | null;
  level: string | null;
  capabilities: string[];
  status: AgentStatus;
  metadata: Record<string, unknown>;
  created_at: string;
  last_seen_at: string;
  session_id: string | null;
  working_dir: string | null;
  active_org_id: string | null;
}

export interface AgentRow {
  id: string;
  name: string;
  description: string | null;
  role: string | null;
  title: string | null;
  level: string | null;
  capabilities: string | null;
  status: string;
  metadata: string | null;
  created_at: string;
  last_seen_at: string;
  session_id: string | null;
  working_dir: string | null;
  active_org_id: string | null;
}

export interface RegisterAgentInput {
  name: string;
  description?: string;
  role?: string;
  title?: string;
  level?: string;
  capabilities?: string[];
  metadata?: Record<string, unknown>;
  session_id?: string;
  working_dir?: string;
  org_id?: string;
  force?: boolean;
}

// ── Calendar ─────────────────────────────────────────────────────────────────

export const CALENDAR_VISIBILITY = ["public", "org", "private"] as const;
export type CalendarVisibility = (typeof CALENDAR_VISIBILITY)[number];

export interface Calendar {
  id: string;
  org_id: string;
  owner_id: string | null; // agent_id or null for org-owned
  slug: string;
  name: string;
  description: string | null;
  color: string | null;
  timezone: string; // IANA timezone, e.g. "America/New_York"
  visibility: CalendarVisibility;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface CreateCalendarInput {
  org_id: string;
  owner_id?: string;
  name: string;
  slug?: string;
  description?: string;
  color?: string;
  timezone?: string;
  visibility?: CalendarVisibility;
  metadata?: Record<string, unknown>;
}

export interface UpdateCalendarInput {
  name?: string;
  description?: string;
  color?: string;
  timezone?: string;
  visibility?: CalendarVisibility;
  metadata?: Record<string, unknown>;
}

// ── Event ────────────────────────────────────────────────────────────────────

export const EVENT_STATUSES = ["tentative", "confirmed", "cancelled"] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export const EVENT_BUSY_TYPES = ["busy", "free", "out_of_office"] as const;
export type EventBusyType = (typeof EVENT_BUSY_TYPES)[number];

export const EVENT_VISIBILITY = ["default", "private", "confidential"] as const;
export type EventVisibility = (typeof EVENT_VISIBILITY)[number];

export interface Event {
  id: string;
  calendar_id: string;
  org_id: string;
  title: string;
  description: string | null;
  location: string | null;
  start_at: string; // ISO 8601
  end_at: string; // ISO 8601
  all_day: boolean;
  timezone: string; // IANA timezone
  status: EventStatus;
  busy_type: EventBusyType;
  visibility: EventVisibility;
  recurrence_rule: string | null; // RRULE
  recurrence_exception_dates: string[] | null; // ISO dates to skip
  source_task_id: string | null; // link to open-todos
  created_by: string | null; // agent_id
  metadata: Record<string, unknown>; // video call URL, attachments, etc.
  created_at: string;
  updated_at: string;
}

export interface CreateEventInput {
  calendar_id: string;
  org_id: string;
  title: string;
  description?: string;
  location?: string;
  start_at: string;
  end_at: string;
  all_day?: boolean;
  timezone?: string;
  status?: EventStatus;
  busy_type?: EventBusyType;
  visibility?: EventVisibility;
  recurrence_rule?: string;
  recurrence_exception_dates?: string[];
  source_task_id?: string;
  created_by?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateEventInput {
  title?: string;
  description?: string;
  location?: string;
  start_at?: string;
  end_at?: string;
  all_day?: boolean;
  timezone?: string;
  status?: EventStatus;
  busy_type?: EventBusyType;
  visibility?: EventVisibility;
  recurrence_rule?: string | null;
  recurrence_exception_dates?: string[] | null;
  source_task_id?: string | null;
  metadata?: Record<string, unknown>;
}

// ── Event Attendee ───────────────────────────────────────────────────────────

export const ATTENDEE_STATUSES = ["needsAction", "accepted", "declined", "tentative"] as const;
export type AttendeeStatus = (typeof ATTENDEE_STATUSES)[number];

export interface EventAttendee {
  id: string;
  event_id: string;
  agent_id: string | null;
  display_name: string | null;
  email: string | null;
  status: AttendeeStatus;
  required: boolean;
  response_comment: string | null;
  responded_at: string | null;
  created_at: string;
}

export interface CreateAttendeeInput {
  event_id: string;
  agent_id?: string;
  display_name?: string;
  email?: string;
  status?: AttendeeStatus;
  required?: boolean;
}

export interface UpdateAttendeeInput {
  status?: AttendeeStatus;
  response_comment?: string | null;
  required?: boolean;
}

// ── Availability ─────────────────────────────────────────────────────────────

export interface Availability {
  id: string;
  agent_id: string;
  org_id: string;
  day_of_week: number; // 0=Sunday, 6=Saturday
  start_time: string; // HH:mm
  end_time: string; // HH:mm
  exceptions: string[] | null; // ISO dates that override (holidays, OOO)
  created_at: string;
  updated_at: string;
}

export interface CreateAvailabilityInput {
  agent_id: string;
  org_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  exceptions?: string[];
}

// ── Org Membership ───────────────────────────────────────────────────────────

export interface OrgMembership {
  id: string;
  org_id: string;
  agent_id: string;
  role: OrgRole;
  created_at: string;
}

export interface CreateOrgMembershipInput {
  org_id: string;
  agent_id: string;
  role?: OrgRole;
}

// ── Version conflict error ──────────────────────────────────────────────────

export class VersionConflictError extends Error {
  static readonly code = "VERSION_CONFLICT";
  constructor(
    public entityId: string,
    public entityType: string,
    public expectedVersion: number,
    public actualVersion: number,
  ) {
    super(`Version conflict for ${entityType} ${entityId}: expected ${expectedVersion}, got ${actualVersion}`);
    this.name = "VersionConflictError";
  }
}

export class NotFoundError extends Error {
  static readonly code = "NOT_FOUND";
  constructor(public entityType: string, public entityId: string) {
    super(`${entityType} not found: ${entityId}`);
    this.name = "NotFoundError";
  }
}

export class ConflictError extends Error {
  static readonly code = "CONFLICT";
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}
