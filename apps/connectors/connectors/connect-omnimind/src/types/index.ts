export interface OmniMindConfig { apiKey: string; }

export interface OMProject { id: string; name: string; description: string; status: string; model: string; created_at: string; updated_at: string; }
export interface OMDataSource { id: string; project_id: string; type: 'url' | 'text' | 'file' | 'sitemap'; name: string; status: string; chunks_count: number; created_at: string; }
export interface OMQueryResult { answer: string; sources: { text: string; source: string; score: number }[]; }
export interface OMWidget { id: string; project_id: string; name: string; settings: Record<string, unknown>; }

export class OmniMindApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'OmniMindApiError'; this.statusCode = statusCode; }
}
