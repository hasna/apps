export interface ReplyConfig { apiKey: string; }

export interface ReplyCampaign { id: number; name: string; status: string; steps_count: number; people_count: number; created_at: string; }
export interface ReplyContact { id: number; email: string; first_name: string; last_name: string; company: string; title: string; phone: string; city: string; country: string; linkedin_url: string; status: string; campaign_id: number | null; created_at: string; }
export interface ReplyContactList { contacts: ReplyContact[]; total: number; page: number; }
export interface ReplySequenceStep { id: number; type: string; position: number; delay_days: number; subject: string; body: string; }
export interface ReplyEmailAccount { id: number; email: string; name: string; status: string; daily_limit: number; sent_today: number; }
export interface ReplyStats { sent: number; delivered: number; opened: number; clicked: number; replied: number; bounced: number; }

export class ReplyApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'ReplyApiError'; this.statusCode = statusCode; }
}
