export interface FormdeskConfig { apiKey: string; subdomain: string; }

export interface FDForm { id: string; name: string; title: string; status: string; created_at: string; fields: FDField[]; }
export interface FDField { id: string; name: string; type: string; label: string; required: boolean; }
export interface FDSubmission { id: string; form_id: string; data: Record<string, string>; created_at: string; ip_address: string; }
export interface FDSubmissionList { submissions: FDSubmission[]; total: number; page: number; per_page: number; }

export class FormdeskApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'FormdeskApiError'; this.statusCode = statusCode; }
}
