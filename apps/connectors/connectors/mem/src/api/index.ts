// Mem Connector — AI-powered note-taking and knowledge management
import { MemClient } from './client';
import type { MemConfig, MemNote, MemNoteList, MemSearchResult } from '../types';
export { MemClient } from './client';

export class Mem {
  private readonly client: MemClient;
  constructor(config: MemConfig) { this.client = new MemClient(config); }
  static fromEnv(): Mem {
    const apiKey = process.env.MEM_API_KEY;
    if (!apiKey) throw new Error('MEM_API_KEY is required');
    return new Mem({ apiKey });
  }

  async createNote(content: string, options?: { is_read?: boolean; scheduled_at?: string }): Promise<MemNote> {
    return this.client.request<MemNote>('/mems', { method: 'POST', body: { content, isRead: options?.is_read, scheduledAt: options?.scheduled_at } as Record<string, unknown> });
  }

  async appendToNote(noteId: string, content: string): Promise<MemNote> {
    return this.client.request<MemNote>(`/mems/${noteId}/append`, { method: 'POST', body: { content } });
  }

  async search(query: string): Promise<MemSearchResult> {
    return this.client.request<MemSearchResult>('/search', { method: 'POST', body: { query } });
  }

  getClient(): MemClient { return this.client; }
}
