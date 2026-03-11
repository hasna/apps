export type Priority = "low" | "normal" | "high" | "urgent";

export interface Message {
  id: number;
  session_id: string;
  from_agent: string;
  to_agent: string;
  space: string | null;
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

export interface Space {
  name: string;
  description: string | null;
  parent_id: string | null;
  project_id: string | null;
  created_by: string;
  created_at: string;
  archived_at: string | null;
}

export interface SpaceMember {
  space: string;
  agent: string;
  joined_at: string;
}

export interface SpaceInfo extends Space {
  member_count: number;
  message_count: number;
  children?: SpaceInfo[];
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
  space_count: number;
}

export interface SendMessageOptions {
  from: string;
  to: string;
  content: string;
  session_id?: string;
  space?: string;
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
  space?: string;
  since?: string;
  since_id?: number;
  limit?: number;
  unread_only?: boolean;
  order?: "asc" | "desc";
  compact?: boolean;
}

export interface SearchMessagesOptions {
  query: string;
  space?: string;
  from?: string;
  to?: string;
  limit?: number;
}

export interface AgentPresence {
  agent: string;
  status: string;
  last_seen_at: string;
  online: boolean;
  metadata: Record<string, unknown> | null;
}
