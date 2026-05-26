// Raven Tools Connector — SEO and marketing reporting with rank tracking
import { RavenToolsClient } from './client';
import type { RavenToolsConfig, RTDomain, RTRanking, RTCompetitor, RTKeyword } from '../types';
export { RavenToolsClient } from './client';

export class RavenTools {
  private readonly client: RavenToolsClient;
  constructor(config: RavenToolsConfig) { this.client = new RavenToolsClient(config); }
  static fromEnv(): RavenTools {
    const apiKey = process.env.RAVENTOOLS_API_KEY;
    if (!apiKey) throw new Error('RAVENTOOLS_API_KEY is required');
    return new RavenTools({ apiKey });
  }

  async listDomains(): Promise<RTDomain[]> { return this.client.request<RTDomain[]>('domains'); }
  async addDomain(domain: string): Promise<{ status: string }> { return this.client.request('add_domain', { domain }); }
  async removeDomain(domain: string): Promise<{ status: string }> { return this.client.request('remove_domain', { domain }); }

  async getRankings(domain: string, options?: { start_date?: string; end_date?: string; engine?: string }): Promise<RTRanking[]> {
    return this.client.request<RTRanking[]>('rank', { domain, start_date: options?.start_date, end_date: options?.end_date, engine: options?.engine });
  }
  async getRankAll(domain: string): Promise<RTRanking[]> { return this.client.request<RTRanking[]>('rank_all', { domain }); }

  async getKeywords(domain: string): Promise<string[]> { return this.client.request<string[]>('keywords', { domain }); }
  async addKeyword(domain: string, keyword: string): Promise<{ status: string }> { return this.client.request('add_keyword', { domain, keyword }); }
  async removeKeyword(domain: string, keyword: string): Promise<{ status: string }> { return this.client.request('remove_keyword', { domain, keyword }); }

  async getCompetitors(domain: string): Promise<RTCompetitor[]> { return this.client.request<RTCompetitor[]>('competitors', { domain }); }

  getClient(): RavenToolsClient { return this.client; }
}
