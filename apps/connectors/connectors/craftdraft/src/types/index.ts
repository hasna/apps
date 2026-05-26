export interface CraftDraftConfig { apiKey: string; }

export interface CDTemplate { id: string; name: string; description: string; category: string; variables: { name: string; type: string; required: boolean }[]; created_at: string; updated_at: string; }
export interface CDDocument { id: string; template_id: string; name: string; status: 'draft' | 'final' | 'archived'; content: string; variables: Record<string, string>; created_at: string; updated_at: string; }
export interface CDDocumentList { documents: CDDocument[]; total: number; page: number; per_page: number; }
export interface CDExport { url: string; format: 'pdf' | 'docx' | 'html'; expires_at: string; }

export class CraftDraftApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'CraftDraftApiError'; this.statusCode = statusCode; }
}
