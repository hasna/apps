export interface MissiveConfig {
  apiKey: string;
  baseUrl?: string;
}

export interface MissiveUser {
  id: string;
  email: string;
  name: string;
  avatar_url: string | null;
}

export interface MissiveConversation {
  id: string;
  subject: string;
  latest_message_subject: string | null;
  assignee_users: MissiveUser[];
  assignee_teams: Array<{ id: string; name: string }>;
  shared_label_names: string[];
  authors: MissiveUser[];
  created_at: number;
  updated_at: number;
  closed_at: number | null;
  trashed_at: number | null;
  is_read: boolean;
  org: { id: string; name: string } | null;
}

export interface MissiveMessage {
  id: string;
  subject: string;
  preview: string;
  type: 'email' | 'chat' | 'call' | 'tweet' | 'facebook' | 'sms' | 'whatsapp';
  delivered_at: number;
  created_at: number;
  updated_at: number;
  from_field: { address: string; name: string } | null;
  to_fields: Array<{ address: string; name: string }>;
  cc_fields: Array<{ address: string; name: string }>;
  bcc_fields: Array<{ address: string; name: string }>;
  body: string | null;
  conversation: { id: string };
}

export interface MissiveContact {
  id: string;
  name: string;
  emails: Array<{ address: string; label?: string }>;
  phones: Array<{ number: string; label?: string }>;
  avatar_url: string | null;
  company: string | null;
  created_at: number;
  updated_at: number;
}

export interface SendMessageOptions {
  fromField?: { address: string; name?: string };
  toFields?: Array<{ address: string; name?: string }>;
  ccFields?: Array<{ address: string; name?: string }>;
  subject?: string;
  markdown?: string;
  html?: string;
  addToSharedLabels?: string[];
  assignToUsers?: string[];
  assignToTeams?: string[];
  conversationSubject?: string;
  externalId?: string;
}

export class MissiveApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'MissiveApiError';
    this.statusCode = statusCode;
  }
}
