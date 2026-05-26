export interface FormcarryConfig { apiKey: string; baseUrl?: string; }
export interface FCForm { id: string; name: string; email: string; archiving: boolean; submissionCount: number; createdAt: string; }
export interface FCSubmission { _id: string; form: string; createdAt: string; data: Record<string, unknown>; archived: boolean; spam: boolean; }
export class FormcarryApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'FormcarryApiError'; this.statusCode = statusCode; }
}
