export interface MyphonerConfig { apiKey: string; }

export interface MPLead { id: number; first_name: string; last_name: string; email: string; phone: string; company: string; status: string; agent_id: number | null; list_id: number; created_at: string; updated_at: string; custom_fields: Record<string, string>; }
export interface MPLeadList { leads: MPLead[]; total: number; page: number; per_page: number; }
export interface MPList { id: number; name: string; leads_count: number; created_at: string; }
export interface MPAgent { id: number; name: string; email: string; role: string; active: boolean; }
export interface MPCall { id: number; lead_id: number; agent_id: number; duration: number; outcome: string; notes: string; created_at: string; }

export class MyphonerApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'MyphonerApiError'; this.statusCode = statusCode; }
}
