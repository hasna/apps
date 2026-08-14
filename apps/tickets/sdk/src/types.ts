export type TicketType = "bug" | "feature" | "question" | "incident" | "improvement" | "task";
export type TicketStatus = "open" | "in_progress" | "in_review" | "resolved" | "closed";
export type Resolution = "fixed" | "wont_fix" | "duplicate" | "invalid" | "by_design";
export type Priority = "none" | "low" | "medium" | "high" | "critical";
export type Severity = "minor" | "moderate" | "major" | "critical" | "blocker";
export type TicketSource = "web" | "api" | "mcp" | "cli" | "email" | "webhook";
export type RelationType = "blocks" | "blocked_by" | "duplicates" | "relates_to" | "caused_by";

export interface Ticket {
  id: string; short_id: string; project_id: string; workspace_id: string | null;
  title: string; description: string | null; type: TicketType; status: TicketStatus;
  resolution: Resolution | null; priority: Priority; severity: Severity | null;
  reporter_id: string | null; assignee_id: string | null; milestone_id: string | null;
  labels: string[]; custom_fields: Record<string, unknown>; source: TicketSource;
  external_id: string | null; external_url: string | null;
  is_ai_opened: boolean; ai_confidence: number | null; ai_reasoning: string | null;
  due_date: string | null; sla_minutes: number | null; sla_breached: boolean;
  duplicate_of: string | null; version: number;
  created_at: string; updated_at: string; resolved_at: string | null; closed_at: string | null;
}

export interface Project {
  id: string; workspace_id: string | null; name: string; slug: string;
  ticket_prefix: string; ticket_counter: number; description: string | null;
  icon: string | null; is_public: boolean; created_at: string; updated_at: string;
}

export interface Comment {
  id: string; ticket_id: string; author_id: string | null; content: string;
  is_internal: boolean; type: string; metadata: Record<string, unknown>;
  created_at: string; updated_at: string;
}

export interface Agent {
  id: string; name: string; type: string; email: string | null;
  permissions: string[]; created_at: string; last_seen_at: string;
}

export interface SimilarTicket {
  id: string; short_id: string; title: string; status: string; priority: string; score: number;
}

export interface ListMeta { total: number; page: number; per_page: number }

export interface ApiResponse<T> { data: T; meta?: ListMeta; error: null }
export interface ApiError { data: null; error: { code: string; message: string } }

export interface CreateTicketInput {
  project_id: string; title: string; description?: string;
  type?: TicketType; priority?: Priority; severity?: Severity;
  reporter_id?: string; assignee_id?: string; milestone_id?: string;
  labels?: string[]; source?: TicketSource; is_ai_opened?: boolean;
  ai_confidence?: number; ai_reasoning?: string; due_date?: string; sla_minutes?: number;
}

export interface UpdateTicketInput {
  title?: string; description?: string; type?: TicketType; priority?: Priority;
  severity?: Severity; assignee_id?: string | null; milestone_id?: string | null;
  labels?: string[]; due_date?: string | null; version?: number;
}

export interface ListTicketsInput {
  project_id?: string; status?: TicketStatus; priority?: Priority; type?: TicketType;
  assignee_id?: string; label?: string; sla_breached?: boolean;
  page?: number; per_page?: number; sort?: string; order?: "asc" | "desc";
}
