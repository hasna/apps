// Relink URL Shortener Connector — URL shortening and link management
import { RelinkClient } from './client';
import type { RelinkConfig, RLLink, RLLinkList, RLClickStats } from '../types';
export { RelinkClient } from './client';

export class RelinkUrlShortener {
  private readonly client: RelinkClient;
  constructor(config: RelinkConfig) { this.client = new RelinkClient(config); }
  static fromEnv(): RelinkUrlShortener {
    const apiKey = process.env.RELINK_API_KEY;
    if (!apiKey) throw new Error('RELINK_API_KEY is required');
    return new RelinkUrlShortener({ apiKey });
  }

  async shortenUrl(url: string, options?: { slug?: string; title?: string; expires_at?: string }): Promise<RLLink> {
    return this.client.request<RLLink>('/links', { method: 'POST', body: { url, slug: options?.slug, title: options?.title, expires_at: options?.expires_at } as Record<string, unknown> });
  }
  async getLink(linkId: string): Promise<RLLink> { return this.client.request<RLLink>(`/links/${linkId}`); }
  async listLinks(options?: { page?: number; per_page?: number }): Promise<RLLinkList> {
    return this.client.request<RLLinkList>('/links', { params: { page: options?.page, per_page: options?.per_page } });
  }
  async updateLink(linkId: string, data: { url?: string; slug?: string; title?: string }): Promise<RLLink> {
    return this.client.request<RLLink>(`/links/${linkId}`, { method: 'PATCH', body: data as Record<string, unknown> });
  }
  async deleteLink(linkId: string): Promise<void> { await this.client.request(`/links/${linkId}`, { method: 'DELETE' }); }

  async getClickStats(linkId: string, options?: { from?: string; to?: string }): Promise<RLClickStats> {
    return this.client.request<RLClickStats>(`/links/${linkId}/stats`, { params: { from: options?.from, to: options?.to } });
  }

  getClient(): RelinkClient { return this.client; }
}
