export interface CopperConfig { apiKey: string; email: string; }

export interface CUPerson { id: number; name: string; first_name: string; last_name: string; emails: { email: string; category: string }[]; phone_numbers: { number: string; category: string }[]; company_id: number | null; title: string; status: string; date_created: number; date_modified: number; }
export interface CUCompany { id: number; name: string; email_domain: string; phone_numbers: { number: string; category: string }[]; address: { street: string; city: string; state: string; postal_code: string; country: string } | null; date_created: number; date_modified: number; }
export interface CUOpportunity { id: number; name: string; company_id: number | null; pipeline_id: number; pipeline_stage_id: number; monetary_value: number; status: string; close_date: string; win_probability: number; date_created: number; }
export interface CUTask { id: number; name: string; due_date: number; status: string; priority: string; assignee_id: number | null; related_resource: { id: number; type: string } | null; }
export interface CUPipeline { id: number; name: string; stages: { id: number; name: string; win_probability: number }[]; }

export class CopperApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'CopperApiError'; this.statusCode = statusCode; }
}
