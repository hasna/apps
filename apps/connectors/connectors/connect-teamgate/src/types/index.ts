export interface TeamgateConfig { authToken: string; appKey: string; }

export interface TGLead { id: number; name: string; email: string; phone: string; company: string; status: string; source: string; owner: { id: number; name: string }; created: string; updated: string; }
export interface TGDeal { id: number; name: string; value: number; currency: string; stage: { id: number; name: string }; pipeline: { id: number; name: string }; status: string; owner: { id: number; name: string }; company_id: number | null; close_date: string | null; created: string; }
export interface TGCompany { id: number; name: string; email: string; phone: string; website: string; industry: string; address: string; created: string; }
export interface TGPerson { id: number; name: string; email: string; phone: string; company_id: number | null; title: string; created: string; }
export interface TGPipeline { id: number; name: string; stages: { id: number; name: string; order: number }[]; }
export interface TGListResult<T> { data: T[]; total: number; offset: number; limit: number; }

export class TeamgateApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'TeamgateApiError'; this.statusCode = statusCode; }
}
