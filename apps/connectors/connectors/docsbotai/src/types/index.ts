export interface DocsBotConfig { apiKey: string; teamId?: string; baseUrl?: string; }

export interface DBBot { id: string; name: string; description: string; status: 'active' | 'training' | 'inactive'; source_count: number; created_at: string; }
export interface DBSource { id: string; bot_id: string; type: 'url' | 'sitemap' | 'document' | 'csv' | 'text'; name: string; status: string; pages: number; created_at: string; }
export interface DBAnswer { answer: string; sources: Array<{ title: string; url: string; content: string }>; }
export interface DBConversation { id: string; bot_id: string; messages: Array<{ role: 'user' | 'assistant'; content: string; created_at: string }>; created_at: string; }

export class DocsBotApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'DocsBotApiError'; this.statusCode = statusCode; }
}
