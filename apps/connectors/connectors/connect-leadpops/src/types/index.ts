export interface LeadPopsConfig { apiKey: string; }

export interface LPLead { id: string; first_name: string; last_name: string; email: string; phone: string; source: string; status: string; loan_type: string; property_type: string; credit_score_range: string; created_at: string; custom_fields: Record<string, string>; }
export interface LPLeadList { leads: LPLead[]; total: number; page: number; per_page: number; }
export interface LPFunnel { id: string; name: string; type: string; url: string; leads_count: number; conversion_rate: number; status: string; created_at: string; }
export interface LPCampaign { id: string; name: string; status: string; funnel_id: string; leads_count: number; budget: number; spent: number; created_at: string; }

export class LeadPopsApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'LeadPopsApiError'; this.statusCode = statusCode; }
}
