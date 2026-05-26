export interface PapyrsConfig { subdomain: string; apiKey: string; }

export interface PPPage { id: number; title: string; body: string; url: string; space_id: number; author: { id: number; name: string }; created_at: string; updated_at: string; tags: string[]; }
export interface PPPageList { pages: PPPage[]; total: number; page: number; per_page: number; }
export interface PPSpace { id: number; name: string; description: string; pages_count: number; }
export interface PPComment { id: number; page_id: number; body: string; author: { id: number; name: string }; created_at: string; }
export interface PPUser { id: number; name: string; email: string; role: string; }

export class PapyrsApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'PapyrsApiError'; this.statusCode = statusCode; }
}
