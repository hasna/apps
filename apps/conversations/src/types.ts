export type Priority = "low" | "normal" | "high" | "urgent";

export interface Message {
  id: number;
  uuid: string;
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
  /**
   * Present ONLY when the stored body differs from what the author submitted.
   * Set by the store funnel on every write path, so absence means "checked and
   * clean" rather than "never checked". Never persisted — it describes this
   * write, not the row.
   */
  redaction?: SendRedactionNotice;
}

/** Safe collection projection; full bodies remain available only by exact id. */
export interface MessagePreview {
  id: number;
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

/** Re-exported from content-safety so `Message` stays self-describing. */
export type { SendRedactionNotice } from "./lib/content-safety.js";
import type { SendRedactionNotice } from "./lib/content-safety.js";

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
  id: string;
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

/*
 * There is deliberately no `content` field on ChannelNotification.
 *
 * One used to exist, populated when a caller passed `include_content`, and it
 * turned every collection read into a bulk body export: one request, N whole
 * messages, on a surface whose entire purpose is to say "something happened"
 * without saying what.
 *
 * The cost it was added to fix is real — `preview` strips `[*#`~_>-]` and caps
 * the result, so agent names, `repo#pr` references and branch names all arrive
 * with their separators gone, and an identifier is genuinely unrecoverable from
 * a notification. The remedy is `getMessageById` / `conversations show <id>`:
 * one message per request, against an id the caller already holds, rather than
 * a flag that widens a whole page.
 */

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
  uuid?: string;
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
  reply_to_uuid?: string;
  /**
   * Tenant routing is owned by the selected storage/auth context. Callers may
   * not override it on a message write; a supplied value is rejected.
   */
  tenant_id?: string;
}

export interface ProjectMessageLinkageHash {
  id: number;
  uuid: string;
  hash: string;
  preserved_hash: string;
}

export interface ProjectMessageLinkagePriorProject {
  id: number;
  uuid: string;
  project_id: string | null;
}

export interface ProjectMessageLinkagePlan {
  operation: "apply";
  dry_run: true;
  channel: string;
  project_id: string;
  revision: string;
  count: number;
  target_count: number;
  message_ids: number[];
  message_uuids: string[];
  before_hashes: ProjectMessageLinkageHash[];
  before_project_ids: ProjectMessageLinkagePriorProject[];
}

export interface ProjectMessageLinkageReceipt extends Omit<ProjectMessageLinkagePlan, "dry_run"> {
  dry_run: false;
  receipt_id: string;
  idempotency_key: string;
  request_hash: string;
  pre_revision: string;
  post_revision: string;
  target_revision: string;
  target_message_ids: number[];
  target_message_uuids: string[];
  created_at: string;
  replayed: boolean;
}

export interface ProjectMessageLinkageRollbackResult {
  operation: "rollback";
  dry_run: boolean;
  source_receipt_id: string;
  channel: string;
  project_id: string;
  expected_revision: string;
  current_revision: string;
  target_count: number;
  target_message_ids: number[];
  target_message_uuids: string[];
  restored_count: number;
  receipt_id?: string;
  idempotency_key?: string;
  request_hash?: string;
  post_revision?: string;
  created_at?: string;
  replayed?: boolean;
}

// Guarded atomic channel merge: source content moves into the destination by
// in-place row rewrite, message ids and uuids never change, and every apply or
// rollback appends an immutable receipt.
export interface ChannelMergePlan {
  operation: "merge";
  dry_run: true;
  source_channel: string;
  destination_channel: string;
  archive_source: boolean;
  revision: string;
  source_message_count: number;
  moved_message_count: number;
  message_ids: number[];
  message_uuids: string[];
  message_id_min: number | null;
  message_id_max: number | null;
}

export interface ChannelMergeGraphEdge {
  from_type: string;
  from_id: string;
  to_type: string;
  to_id: string;
  relation: string;
  weight: number;
  metadata: string | null;
}

export interface ChannelMergeAliasPrior {
  old_channel: string;
  current_channel: string;
  renamed_at: string;
}

export interface ChannelMergeReceipt extends Omit<ChannelMergePlan, "dry_run"> {
  dry_run: false;
  receipt_id: string;
  idempotency_key: string;
  request_hash: string;
  pre_revision: string;
  post_revision: string;
  source_members: string[];
  source_subscriptions: string[];
  source_task_ids: number[];
  source_graph_edges: ChannelMergeGraphEdge[];
  prior_source_archived_at: string | null;
  prior_alias_destination: ChannelMergeAliasPrior | null;
  prior_aliases_of_source: Array<{ old_channel: string; renamed_at: string }>;
  created_at: string;
  replayed: boolean;
}

export interface ChannelMergeRollbackResult {
  operation: "rollback";
  dry_run: boolean;
  source_receipt_id: string;
  source_channel: string;
  destination_channel: string;
  expected_revision: string;
  current_revision: string;
  target_count: number;
  target_message_ids: number[];
  target_message_uuids: string[];
  restored_count: number;
  receipt_id?: string;
  idempotency_key?: string;
  request_hash?: string;
  post_revision?: string;
  created_at?: string;
  replayed?: boolean;
}

// Canonical append-only Todos incident projections.
export type IncidentSeverity = "info" | "low" | "medium" | "high" | "critical";
export type IncidentStatus = "open" | "investigating" | "contained" | "monitoring" | "resolved" | "superseded";

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

export interface IncidentProjectionRouting {
  from?: string;
  to?: string;
  channel?: string;
  project_id?: string;
  session_id?: string;
}

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

export type IncidentProjectionEventV1 = IncidentProjectionRequestV1;

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

export interface ReadMentionPreviewsOptions {
  channel?: string;
  unread_only?: boolean;
  limit?: number;
  offset?: number;
  max_bytes?: number;
  preview_bytes?: number;
  timeout_ms?: number;
}

export type ExportFormat = "json" | "csv";
export interface ExportMessagesOptions {
  channel?: string;
  session_id?: string;
  from?: string;
  since?: string;
  until?: string;
  format?: ExportFormat;
  limit?: number;
  max_bytes?: number;
  preview_bytes?: number;
  timeout_ms?: number;
}

export interface MessageExportArtifact {
  artifact_id: string;
  filename: string;
  path: string | null;
  download_path: string | null;
  sha256: string;
  format: ExportFormat;
  detail: "preview";
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

/**
 * One page of search results, carrying whether the backend held anything back.
 *
 * `searchMessages` returns a bare array, so a caller cannot tell a page that
 * exhausted the population from one a backend cap cut short — and for `search`
 * those two look IDENTICAL, because a clamping server answers with fewer rows
 * than were requested, which every ordinary pagination rule reads as
 * "exhausted". Callers making an absence claim ("no instances found") must use
 * this shape instead; the array-returning form is kept for callers that only
 * want rows.
 */
export interface SearchMessagesPage {
  items: SearchResult[];
  /** True when rows exist beyond this page, INCLUDING when a backend cap applied. */
  has_more: boolean;
  /** Offset to pass as `--cursor`/`offset` for the next page, or null when exhausted. */
  next_cursor: number | null;
  /** The row count the backend actually applied — below the request when a cap clamped it. */
  effective_limit: number;
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
