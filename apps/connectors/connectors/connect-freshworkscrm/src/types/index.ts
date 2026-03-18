export interface FreshworksCRMConfig { domain: string; apiKey: string; }

export interface FWContact { id: number; first_name: string; last_name: string; email: string; mobile_number: string; job_title: string; company: { id: number; name: string } | null; lead_score: number; created_at: string; updated_at: string; }
export interface FWDeal { id: number; name: string; amount: number; expected_close: string; deal_stage_id: number; deal_pipeline_id: number; owner_id: number; won_reason: string | null; lost_reason: string | null; created_at: string; }
export interface FWAccount { id: number; name: string; website: string; phone: string; industry_type: string; number_of_employees: number; }
export interface FWTask { id: number; title: string; description: string; due_date: string; owner_id: number; status: number; targetable_type: string; targetable_id: number; }
export interface FWNote { id: number; description: string; targetable_type: string; targetable_id: number; created_at: string; }

export class FreshworksCRMApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'FreshworksCRMApiError'; this.statusCode = statusCode; }
}
