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
  /**
   * Present ONLY when the stored body differs from what the author submitted.
   * Set by the store funnel on every write path, so absence means "checked and
   * clean" rather than "never checked". Never persisted — it describes this
   * write, not the row.
   */
  redaction?: SendRedactionNotice;
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

export interface ReadMessagesOptions {
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
  latest?: number;
  offset?: number;
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
