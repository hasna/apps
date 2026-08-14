export interface MissiveConfig { token: string; }

export interface MVConversation { id: string; subject: string; latest_message_subject: string; organization: { id: string; name: string } | null; assignees: { id: string; name: string; email: string }[]; labels: { id: string; name: string; color: string }[]; created_at: number; updated_at: number; }
export interface MVConversationList { conversations: MVConversation[]; }
export interface MVMessage { id: string; subject: string; body: string; from_field: { name: string; address: string }; to_fields: { name: string; address: string }[]; delivered_at: number; }
export interface MVContact { id: string; name: string; email: string; phone: string; organization: string; avatar_url: string; }
export interface MVContactList { contacts: MVContact[]; }
export interface MVLabel { id: string; name: string; color: string; parent_id: string | null; }
export interface MVOrganization { id: string; name: string; }
export interface MVUser { id: string; name: string; email: string; avatar_url: string; }

export class MissiveApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'MissiveApiError'; this.statusCode = statusCode; }
}
