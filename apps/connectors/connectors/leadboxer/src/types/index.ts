export interface LeadBoxerConfig { apiKey: string; }

export interface LBLead { id: string; company: string; email: string; first_name: string; last_name: string; phone: string; website: string; score: number; source: string; country: string; city: string; first_seen: string; last_seen: string; page_views: number; sessions: number; }
export interface LBLeadList { leads: LBLead[]; total: number; page: number; per_page: number; }
export interface LBEvent { id: string; lead_id: string; type: string; url: string; referrer: string; timestamp: string; }
export interface LBSegment { id: string; name: string; description: string; leads_count: number; }

export class LeadBoxerApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'LeadBoxerApiError'; this.statusCode = statusCode; }
}
