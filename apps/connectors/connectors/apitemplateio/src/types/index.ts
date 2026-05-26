export interface ApiTemplateConfig { apiKey: string; }

export interface ATTemplate { template_id: string; name: string; type: 'pdf' | 'image'; format: string; created_at: string; updated_at: string; status: string; }
export interface ATTemplateList { templates: ATTemplate[]; }
export interface ATCreateResult { download_url: string; transaction_ref: string; status: string; }
export interface ATMergeData { [key: string]: string | number | boolean | null; }
export interface ATAccountInfo { email: string; plan: string; credits_remaining: number; credits_used: number; }

export class ApiTemplateApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'ApiTemplateApiError'; this.statusCode = statusCode; }
}
