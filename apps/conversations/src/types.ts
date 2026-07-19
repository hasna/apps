export type Priority = "low" | "normal" | "high" | "urgent";

export interface Message {
  id: number;
  session_id: string;
  from_agent: string;
  to_agent: string;
  channel: string | null;
  project_id: string | null;
  content: string;
  priority: Priority;
  working_dir: string | null;
  repository: string | null;
  branch: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  read_at: string | null;
  edited_at: string | null;
  pinned_at: string | null;
  blocking: boolean;
  attachments: Attachment[] | null;
  reply_to: number | null;
  reply_count?: number;
  truncated?: boolean;
}

/**
 * Safe collection-read projection. It intentionally has no `content` or raw
 * metadata field; full bodies are available only from the exact-message path.
 */
export interface MessagePreview {
  id: number;
  /** Present on mention collection reads; distinct from the message id. */
  mention_id?: number;
  uuid?: string;
  session_id: string;
  from_agent: string;
  to_agent: string;
  channel: string | null;
  project_id: string | null;
  priority: Priority;
  working_dir: string | null;
  repository: string | null;
  branch: string | null;
  created_at: string;
  edited_at: string | null;
  pinned_at: string | null;
  unread: boolean;
  blocking: boolean;
  reply_to: number | null;
  reply_count?: number;
  attachment_count: number;
  has_attachments: boolean;
  has_metadata: boolean;
  preview: string;
  preview_bytes: number;
  content_bytes: number;
  truncated: boolean;
  redacted: boolean;
  relevance_score?: number;
}

export interface MessagePreviewPage {
  messages: MessagePreview[];
  count: number;
  limit: number;
  cursor: number;
  next_cursor: number | null;
  has_more: boolean;
  skipped_count: number;
  byte_length: number;
  max_bytes: number;
  timeout_ms: number;
  compact: true;
  detail_path: "messages/{id}";
  query?: string;
}

export interface Reaction {
  id: number;
  message_id: number;
  agent: string;
  emoji: string;
  created_at: string;
}

export interface Attachment {
  name: string;
  path: string;
  size: number;
  mime_type: string;
}

export interface Session {
  session_id: string;
  participants: string[];
  last_message_at: string;
  message_count: number;
  unread_count: number;
}

export interface Channel {
  name: string;
  description: string | null;
  topic: string | null;
  project_id: string | null;
  created_by: string;
  created_at: string;
  archived_at: string | null;
  metadata: Record<string, unknown> | null;
  tags: string[];
}

export interface ChannelMember {
  channel: string;
  agent: string;
  joined_at: string;
}

export interface ChannelNotificationSubscription {
  channel: string;
  agent: string;
  created_at: string;
  preview_chars: number;
  since_message_id: number;
}

export interface ChannelNotification {
  message_id: number;
  channel: string;
  from_agent: string;
  created_at: string;
  priority: Priority;
  preview: string;
  unread: boolean;
  has_attachments: boolean;
}

/** Bounded, cursored notification page shared by local and cloud transports. */
export interface ChannelNotificationPage {
  notifications: ChannelNotification[];
  count: number;
  limit: number;
  cursor: number;
  next_cursor: number | null;
  has_more: boolean;
  skipped_count: number;
  byte_length: number;
  max_bytes: number;
  timeout_ms: number;
  marked_read: number;
  compact: true;
  detail_path: "messages/{id}";
}

export interface ChannelInfo extends Channel {
  member_count: number;
  message_count: number;
}

export interface Project {
  id: string;
  name: string;
  description: string | null;
  path: string | null;
  created_by: string;
  created_at: string;
  metadata: Record<string, unknown> | null;
  tags: string[];
  status: "active" | "archived";
  repository: string | null;
  settings: Record<string, unknown> | null;
}

export interface ProjectInfo extends Project {
  channel_count: number;
}

export interface SendMessageOptions {
  from: string;
  to: string;
  content: string;
  session_id?: string;
  channel?: string;
  project_id?: string;
  priority?: Priority;
  working_dir?: string;
  repository?: string;
  branch?: string;
  metadata?: Record<string, unknown>;
  blocking?: boolean;
  attachments?: { name: string; source_path: string }[];
  reply_to?: number;
}

// ── Canonical Todos incident projections ────────────────────────────────────

export type IncidentSeverity = "info" | "low" | "medium" | "high" | "critical";
export type IncidentStatus = "open" | "investigating" | "contained" | "monitoring" | "resolved" | "superseded";

/** Frozen Todos v1 incident snapshot. Message text is never canonical state. */
export interface IncidentSnapshotV1 {
  id: string;
  title: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  owner: string;
  affected_scopes: string[];
  blocked_scopes: string[];
  containment: string | null;
  next_action: string | null;
  deadline: string | null;
  closure_evidence: string[];
  supersedes_id: string | null;
  superseded_by_id: string | null;
  resolved_at: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface IncidentProjectionDisplay {
  from: string;
  to: string;
  content: string;
  channel?: string;
  project_id?: string;
  session_id?: string;
  priority?: Priority;
  working_dir?: string;
  repository?: string;
  branch?: string;
}

/** Trusted Conversations-side rendering/routing configuration. */
export interface IncidentProjectionRouting {
  from?: string;
  to?: string;
  channel?: string;
  project_id?: string;
  session_id?: string;
}

/**
 * Projector input. authority_id is supplied by Todos and must equal the stable
 * Conversations deployment binding; tenant_id is never accepted from the wire.
 */
export interface IncidentProjectionRequestV1 {
  schema_version: 1;
  source: "todos";
  authority_id: string;
  incident_id: string;
  transition_id: string;
  incident_version: number;
  occurred_at: string;
  event_id: string;
  projection_key: string;
  incident: IncidentSnapshotV1;
}

export interface IncidentProjectorContext {
  tenant_id: string;
  authority_id: string;
  routing?: IncidentProjectionRouting;
}

export interface IncidentProjectionRecord {
  id: number;
  event_id: string;
  projection_key: string;
  message_id: number;
  schema_version: 1;
  source: "todos";
  tenant_id: string;
  authority_id: string;
  incident_id: string;
  transition_id: string;
  incident_version: number;
  occurred_at: string;
  status: IncidentStatus;
  severity: IncidentSeverity;
  blocking: boolean;
  supersedes_transition_id: string | null;
  supersedes_incident_id: string | null;
  superseded_by_incident_id: string | null;
  canonical_payload: string;
  payload_hash: string;
  created_at: string;
  message: Message;
  replayed: boolean;
}

export interface ReadMessagesOptions {
  id?: number;
  session_id?: string;
  from?: string;
  to?: string;
  channel?: string;
  project_id?: string;
  since?: string;
  since_id?: number;
  limit?: number;
  unread_only?: boolean;
  order?: "asc" | "desc";
  compact?: boolean;
  max_content_length?: number;
  threads_only?: boolean;
  include_reply_counts?: boolean;
  mentions_only?: string;
  reply_to?: number;
  pinned_only?: boolean;
  latest?: number;
  offset?: number;
}

export interface ReadMessagePreviewsOptions extends ReadMessagesOptions {
  max_bytes?: number;
  preview_bytes?: number;
  timeout_ms?: number;
}

export type ExportDetail = "preview" | "full";
export type ExportFormat = "json" | "csv";

/**
 * Full exports are deliberately separate from ordinary preview exports. The
 * acknowledgement is explicit and is bound to the authenticated principal by
 * the HTTP surface (or to the local invoking identity by the CLI).
 */
export interface FullExportAuthorization {
  principal: string;
  reason: string;
  acknowledged: true;
}

export interface ExportMessagesOptions {
  channel?: string;
  session_id?: string;
  from?: string;
  since?: string;
  until?: string;
  format?: ExportFormat;
  detail?: ExportDetail;
  limit?: number;
  max_bytes?: number;
  preview_bytes?: number;
  timeout_ms?: number;
  authorization?: FullExportAuthorization;
}

/** Export results are file artifacts; message bodies are never returned inline. */
export interface MessageExportArtifact {
  artifact_id: string;
  filename: string;
  /** Absolute local path for LocalStore artifacts; never exposed by the HTTP API. */
  path: string | null;
  /** Authenticated HTTP retrieval path for remote artifacts. */
  download_path: string | null;
  sha256: string;
  format: ExportFormat;
  detail: ExportDetail;
  count: number;
  has_more: boolean;
  skipped_count: number;
  byte_length: number;
  max_bytes: number;
  timeout_ms: number;
  created_at: string;
}

export interface SearchMessagesOptions {
  query: string;
  channel?: string;
  from?: string;
  to?: string;
  since?: string;
  until?: string;
  limit?: number;
  sort?: "relevance" | "recent";
  snippet_length?: number;
  offset?: number;
}

export interface SearchMessagePreviewsOptions extends SearchMessagesOptions {
  max_bytes?: number;
  preview_bytes?: number;
  timeout_ms?: number;
}

export interface SearchResult extends Message {
  snippet: string | null;
  relevance_score: number;
}

export interface AgentPresence {
  id: string;
  agent: string;
  session_id: string | null;
  role: string;
  project_id: string | null;
  status: string;
  last_seen_at: string;
  created_at: string;
  online: boolean;
  metadata: Record<string, unknown> | null;
}

export interface AgentConflictError {
  conflict: true;
  error: "agent_conflict";
  message: string;
  existing_id: string;
  existing_name: string;
  existing_session_id: string | null;
  last_seen_at: string;
  session_hint: string | null;
  working_dir: string | null;
}

export interface RegisterAgentResult {
  agent: AgentPresence;
  created: boolean;
  took_over: boolean;
}

// ── Tasks ─────────────────────────────────────────────────────────────────────

export type TaskStatus = "pending" | "in_progress" | "completed" | "cancelled" | "blocked";
export type TaskPriority = "low" | "medium" | "high" | "critical";

export interface Task {
  id: number;
  uuid: string;
  subject: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assignee: string | null;
  reporter: string;
  project_id: string | null;
  channel: string | null;
  parent_id: number | null;
  depends_on: string[] | null;
  tags: string[] | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  due_at: string | null;
}

export interface TaskInfo extends Task {
  subtask_count: number;
  comment_count: number;
  dependency_count: number;
  blocker_info: { task_id: number; subject: string; status: TaskStatus }[];
}

export interface CreateTaskOptions {
  subject: string;
  description?: string;
  reporter: string;
  assignee?: string;
  priority?: TaskPriority;
  project_id?: string;
  channel?: string;
  parent_id?: number;
  depends_on?: number[];
  tags?: string[];
  metadata?: Record<string, unknown>;
  due_at?: string;
}

export interface ListTasksOptions {
  status?: TaskStatus;
  assignee?: string;
  reporter?: string;
  project_id?: string;
  channel?: string;
  parent_id?: number | null;
  priority?: TaskPriority;
  tag?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  limit?: number;
  offset?: number;
  include_archived?: boolean;
}

export interface SearchTasksOptions {
  query: string;
  status?: TaskStatus;
  assignee?: string;
  project_id?: string;
  channel?: string;
  priority?: TaskPriority;
  limit?: number;
  offset?: number;
  sort?: "relevance" | "recent";
  include_archived?: boolean;
}

export interface SearchResultTask extends TaskInfo {
  snippet: string | null;
  relevance_score: number;
}

// ── Task Comments ─────────────────────────────────────────────────────────────

export interface TaskComment {
  id: number;
  task_id: number;
  agent: string;
  content: string;
  created_at: string;
}

// ── Task Activity ─────────────────────────────────────────────────────────────

export interface TaskActivity {
  id: number;
  task_id: number;
  agent: string;
  action: string;
  detail: string | null;
  created_at: string;
}

export type TaskTransition =
  | { action: "created" }
  | { action: "started" }
  | { action: "completed"; evidence?: string }
  | { action: "cancelled"; reason?: string }
  | { action: "blocked"; reason?: string }
  | { action: "unblocked" }
  | { action: "reopened" }
  | { action: "assigned"; assignee: string }
  | { action: "priority_changed"; from: TaskPriority; to: TaskPriority }
  | { action: "comment"; content: string };
