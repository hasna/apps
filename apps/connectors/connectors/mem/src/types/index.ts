export interface MemConfig { apiKey: string; }

export interface MemNote { id: string; title: string; content: string; created_at: string; updated_at: string; is_pinned: boolean; is_archived: boolean; }
export interface MemNoteList { notes: MemNote[]; has_more: boolean; }
export interface MemSearchResult { results: { id: string; title: string; content_preview: string; score: number }[]; }

export class MemApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'MemApiError'; this.statusCode = statusCode; }
}
