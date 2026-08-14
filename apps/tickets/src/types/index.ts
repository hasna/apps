// ── Enums ────────────────────────────────────────────────────────────────────

export type TicketType = "bug" | "feature" | "question" | "incident" | "improvement" | "task";
export type TicketStatus = "open" | "in_progress" | "in_review" | "resolved" | "closed";
export type Resolution = "fixed" | "wont_fix" | "duplicate" | "invalid" | "by_design";
export type Priority = "none" | "low" | "medium" | "high" | "critical";
export type Severity = "minor" | "moderate" | "major" | "critical" | "blocker";
export type TicketSource = "web" | "api" | "mcp" | "cli" | "email" | "webhook";
export type AgentType = "human" | "ai_agent";
export type RelationType = "blocks" | "blocked_by" | "duplicates" | "relates_to" | "caused_by";
export type CommentType = "comment" | "status_change" | "assignment" | "ai_suggestion";
export type MilestoneStatus = "open" | "closed";
export type EmailProvider = "ses" | "resend" | "smtp" | "console";
export type EmailStatus = "pending" | "sent" | "failed";

export const TICKET_TYPES: TicketType[] = ["bug", "feature", "question", "incident", "improvement", "task"];
export const TICKET_STATUSES: TicketStatus[] = ["open", "in_progress", "in_review", "resolved", "closed"];
export const RESOLUTIONS: Resolution[] = ["fixed", "wont_fix", "duplicate", "invalid", "by_design"];
export const PRIORITIES: Priority[] = ["none", "low", "medium", "high", "critical"];
export const SEVERITIES: Severity[] = ["minor", "moderate", "major", "critical", "blocker"];
export const TICKET_SOURCES: TicketSource[] = ["web", "api", "mcp", "cli", "email", "webhook"];

// ── State machine valid transitions ─────────────────────────────────────────

export const VALID_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  open: ["in_progress", "resolved", "closed"],
  in_progress: ["in_review", "resolved", "closed", "open"],
  in_review: ["in_progress", "resolved", "closed"],
  resolved: ["closed", "open"],
  closed: ["open"],
};

// ── Interfaces ───────────────────────────────────────────────────────────────

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  created_at: string;
}

export interface Agent {
  id: string;
  name: string;
  type: AgentType;
  email: string | null;
  api_key_hash: string | null;
  permissions: string[];
  created_at: string;
  last_seen_at: string;
}

export interface Project {
  id: string;
  workspace_id: string | null;
  name: string;
  slug: string;
  ticket_prefix: string;
  ticket_counter: number;
  description: string | null;
  icon: string | null;
  is_public: boolean;
  created_at: string;
  updated_at: string;
}

export interface Label {
  id: string;
  project_id: string;
  name: string;
  color: string;
  description: string | null;
}

export interface Milestone {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  due_date: string | null;
  status: MilestoneStatus;
  created_at: string;
  updated_at: string;
}

export interface Ticket {
  id: string;
  short_id: string;
  project_id: string;
  workspace_id: string | null;
  title: string;
  description: string | null;
  type: TicketType;
  status: TicketStatus;
  resolution: Resolution | null;
  priority: Priority;
  severity: Severity | null;
  reporter_id: string | null;
  assignee_id: string | null;
  milestone_id: string | null;
  labels: string[];
  custom_fields: Record<string, unknown>;
  source: TicketSource;
  external_id: string | null;
  external_url: string | null;
  is_ai_opened: boolean;
  ai_confidence: number | null;
  ai_reasoning: string | null;
  due_date: string | null;
  sla_minutes: number | null;
  sla_breached: boolean;
  duplicate_of: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  closed_at: string | null;
}

export interface Comment {
  id: string;
  ticket_id: string;
  author_id: string | null;
  content: string;
  is_internal: boolean;
  type: CommentType;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface TicketRelation {
  id: string;
  ticket_id: string;
  related_ticket_id: string;
  relation_type: RelationType;
  created_by: string | null;
  created_at: string;
}

export interface Activity {
  id: string;
  ticket_id: string;
  agent_id: string | null;
  action: string;
  from_value: string | null;
  to_value: string | null;
  is_ai_action: boolean;
  ai_confidence: number | null;
  ai_reasoning: string | null;
  created_at: string;
}

export interface Webhook {
  id: string;
  workspace_id: string | null;
  project_id: string | null;
  url: string;
  secret: string;
  events: string[];
  is_active: boolean;
  last_triggered_at: string | null;
  failure_count: number;
  created_at: string;
}

export interface ApiKey {
  id: string;
  agent_id: string;
  key_hash: string;
  name: string;
  scopes: string[];
  last_used_at: string | null;
  created_at: string;
}

export interface Domain {
  id: string;
  workspace_id: string | null;
  project_id: string | null;
  domain: string;
  verified: boolean;
  verified_at: string | null;
  tls_cert: string | null;
  tls_key: string | null;
  created_at: string;
}

export interface EmailConfig {
  id: string;
  workspace_id: string | null;
  provider: EmailProvider;
  config_json: Record<string, unknown>;
  from_email: string | null;
  created_at: string;
  updated_at: string;
}

export interface EmailQueueItem {
  id: string;
  provider: string;
  to_addresses: string[];
  from_address: string;
  subject: string;
  html: string | null;
  text: string | null;
  headers: Record<string, string>;
  status: EmailStatus;
  attempts: number;
  last_error: string | null;
  send_at: string | null;
  sent_at: string | null;
  created_at: string;
}

// ── API response types ───────────────────────────────────────────────────────

export interface ListMeta {
  total: number;
  page: number;
  per_page: number;
  cursor?: string;
}

export interface ApiResponse<T> {
  data: T;
  meta?: ListMeta;
  error: null;
}

export interface ApiError {
  data: null;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

// ── Filter types ─────────────────────────────────────────────────────────────

export interface TicketFilters {
  project_id?: string;
  workspace_id?: string;
  status?: TicketStatus | TicketStatus[];
  priority?: Priority | Priority[];
  type?: TicketType | TicketType[];
  assignee_id?: string;
  reporter_id?: string;
  milestone_id?: string;
  label?: string;
  is_ai_opened?: boolean;
  sla_breached?: boolean;
  source?: TicketSource;
  created_after?: string;
  created_before?: string;
  updated_after?: string;
  search?: string;
  page?: number;
  per_page?: number;
  sort?: "created_at" | "updated_at" | "priority" | "status";
  order?: "asc" | "desc";
}

// ── Webhook event types ──────────────────────────────────────────────────────

export type WebhookEvent =
  | "ticket.created"
  | "ticket.updated"
  | "ticket.closed"
  | "ticket.reopened"
  | "ticket.assigned"
  | "ticket.priority_changed"
  | "ticket.status_changed"
  | "comment.created"
  | "comment.updated"
  | "milestone.closed";

export interface WebhookPayload {
  event: WebhookEvent;
  timestamp: string;
  webhook_id: string;
  project_id: string;
  data: unknown;
  actor: { id: string; name: string; type: AgentType } | null;
}

// ── Error classes ────────────────────────────────────────────────────────────

export class NotFoundError extends Error {
  readonly code = "NOT_FOUND";
  constructor(resource: string, id: string) {
    super(`${resource} not found: ${id}`);
    this.name = "NotFoundError";
  }
}

export class ValidationError extends Error {
  readonly code = "VALIDATION_ERROR";
  constructor(message: string, public readonly details?: unknown) {
    super(message);
    this.name = "ValidationError";
  }
}

export class VersionConflictError extends Error {
  readonly code = "VERSION_CONFLICT";
  constructor(id: string, expected: number, actual: number) {
    super(`Version conflict for ticket ${id}: expected ${expected}, got ${actual}`);
    this.name = "VersionConflictError";
  }
}

export class InvalidTransitionError extends Error {
  readonly code = "INVALID_TRANSITION";
  constructor(from: TicketStatus, to: TicketStatus) {
    super(`Invalid status transition: ${from} → ${to}`);
    this.name = "InvalidTransitionError";
  }
}

export class AuthError extends Error {
  readonly code = "UNAUTHORIZED";
  constructor(message = "Unauthorized") {
    super(message);
    this.name = "AuthError";
  }
}
