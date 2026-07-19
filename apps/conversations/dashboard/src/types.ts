export interface Message {
  id: number;
  session_id: string;
  from_agent: string;
  to_agent: string;
  channel: string | null;
  preview: string;
  priority: string;
  working_dir: string | null;
  repository: string | null;
  branch: string | null;
  has_metadata: boolean;
  created_at: string;
  unread: boolean;
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
  status: "active" | "archived";
  repository: string | null;
  channel_count: number;
}

export interface DashboardStatus {
  db_path: string;
  total_messages: number;
  total_sessions: number;
  total_channels: number;
  total_projects: number;
  unread_messages: number;
}
