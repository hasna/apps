export interface FormsOnFireConfig { apiKey: string; }

export interface FOFForm { id: string; name: string; description: string; status: string; fields: FOFField[]; created_at: string; updated_at: string; }
export interface FOFField { id: string; name: string; type: string; label: string; required: boolean; }
export interface FOFSubmission { id: string; form_id: string; data: Record<string, unknown>; status: string; submitted_by: string; submitted_at: string; location: { latitude: number; longitude: number } | null; }
export interface FOFSubmissionList { submissions: FOFSubmission[]; total: number; page: number; per_page: number; }
export interface FOFUser { id: string; name: string; email: string; role: string; }

export class FormsOnFireApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'FormsOnFireApiError'; this.statusCode = statusCode; }
}
