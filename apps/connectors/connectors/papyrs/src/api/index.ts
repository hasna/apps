// Papyrs Connector — Intranet and internal wiki for teams
import { PapyrsClient } from './client';
import type { PapyrsConfig, PPPage, PPPageList, PPSpace, PPComment, PPUser } from '../types';
export { PapyrsClient } from './client';

export class Papyrs {
  private readonly client: PapyrsClient;
  constructor(config: PapyrsConfig) { this.client = new PapyrsClient(config); }
  static fromEnv(): Papyrs {
    const subdomain = process.env.PAPYRS_SUBDOMAIN;
    const apiKey = process.env.PAPYRS_API_KEY;
    if (!subdomain || !apiKey) throw new Error('PAPYRS_SUBDOMAIN and PAPYRS_API_KEY are required');
    return new Papyrs({ subdomain, apiKey });
  }

  async listPages(options?: { page?: number; per_page?: number; space_id?: number; search?: string }): Promise<PPPageList> {
    return this.client.request<PPPageList>('/pages', { params: { page: options?.page, per_page: options?.per_page, space_id: options?.space_id, q: options?.search } });
  }
  async getPage(pageId: number): Promise<PPPage> { return this.client.request<PPPage>(`/pages/${pageId}`); }
  async createPage(data: { title: string; body: string; space_id?: number; tags?: string[] }): Promise<PPPage> {
    return this.client.request<PPPage>('/pages', { method: 'POST', body: data as Record<string, unknown> });
  }
  async updatePage(pageId: number, data: { title?: string; body?: string; tags?: string[] }): Promise<PPPage> {
    return this.client.request<PPPage>(`/pages/${pageId}`, { method: 'PUT', body: data as Record<string, unknown> });
  }
  async deletePage(pageId: number): Promise<void> { await this.client.request(`/pages/${pageId}`, { method: 'DELETE' }); }

  async listSpaces(): Promise<PPSpace[]> { return this.client.request<PPSpace[]>('/spaces'); }

  async listComments(pageId: number): Promise<PPComment[]> { return this.client.request<PPComment[]>(`/pages/${pageId}/comments`); }
  async createComment(pageId: number, body: string): Promise<PPComment> {
    return this.client.request<PPComment>(`/pages/${pageId}/comments`, { method: 'POST', body: { body } });
  }

  async listUsers(): Promise<PPUser[]> { return this.client.request<PPUser[]>('/users'); }

  getClient(): PapyrsClient { return this.client; }
}
