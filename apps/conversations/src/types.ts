export type Priority = "low" | "normal" | "high" | "urgent";

export interface Message {
  id: number;
  session_id: string;
  from_agent: string;
  to_agent: string;
  channel: string | null;
  content: string;
  priority: Priority;
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
}

export interface ChannelMember {
  channel: string;
  agent: string;
  joined_at: string;
}

export interface ChannelInfo extends Channel {
  member_count: number;
  message_count: number;
}

export interface SendMessageOptions {
  from: string;
  to: string;
  content: string;
  session_id?: string;
  channel?: string;
  priority?: Priority;
  working_dir?: string;
  repository?: string;
  branch?: string;
  metadata?: Record<string, unknown>;
}

export interface ReadMessagesOptions {
  session_id?: string;
  from?: string;
  to?: string;
  channel?: string;
  since?: string;
  limit?: number;
  unread_only?: boolean;
}
