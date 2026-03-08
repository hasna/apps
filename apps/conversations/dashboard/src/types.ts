export interface Message {
  id: number;
  session_id: string;
  from_agent: string;
  to_agent: string;
  space: string | null;
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

export interface Space {
  name: string;
  description: string | null;
  parent_id: string | null;
  project_id: string | null;
  created_by: string;
  created_at: string;
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
  space_count: number;
}

export interface DashboardStatus {
  db_path: string;
  total_messages: number;
  total_sessions: number;
  total_spaces: number;
  total_projects: number;
  unread_messages: number;
}
