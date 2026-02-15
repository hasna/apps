export interface Message {
  id: number;
  session_id: string;
  from_agent: string;
  to_agent: string;
  channel: string | null;
  content: string;
  priority: string;
  working_dir: string | null;
  repository: string | null;
  branch: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  read_at: string | null;
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
  created_by: string;
  created_at: string;
  member_count: number;
  message_count: number;
}

export interface DashboardStatus {
  db_path: string;
  total_messages: number;
  total_sessions: number;
  total_channels: number;
  unread_messages: number;
}
