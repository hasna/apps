// Raven Tools Connector
// SEO rank tracking, keyword monitoring, and marketing reporting

import { RavenToolsClient } from './client';
import type {
  RavenToolsConfig, Site, Keyword, RankingEntry, Competitor, Profile,
} from '../types';

export { RavenToolsClient } from './client';

export class RavenTools {
  private readonly client: RavenToolsClient;

  constructor(config: RavenToolsConfig) {
    this.client = new RavenToolsClient(config);
  }

  static fromEnv(): RavenTools {
    const token = process.env.RAVENTOOLS_TOKEN || process.env.RAVEN_TOOLS_API_KEY;
    if (!token) throw new Error('RAVENTOOLS_TOKEN environment variable is required');
    return new RavenTools({ token });
  }

  // Profile
  async getProfile(): Promise<Profile> {
    return this.client.request<Profile>('/profile');
  }

  // Sites (domains being tracked)
  async listSites(): Promise<Site[]> {
    const result = await this.client.request<{ sites: Site[] }>('/sites');
    return result.sites ?? [];
  }

  async getSite(siteHash: string): Promise<Site> {
    return this.client.request<Site>('/site', { site_hash: siteHash });
  }

  // Keywords
  async listKeywords(siteHash: string, options?: {
    startDate?: string;
    endDate?: string;
    engine?: string;
    tag?: string;
  }): Promise<Keyword[]> {
    const result = await this.client.request<{ keywords: Keyword[] }>('/keywords', {
      site_hash: siteHash,
      start_date: options?.startDate,
      end_date: options?.endDate,
      engine: options?.engine,
      tag: options?.tag,
    });
    return result.keywords ?? [];
  }

  async addKeyword(siteHash: string, keyword: string, engines?: string[], tags?: string[]): Promise<{ success: boolean }> {
    const params: Record<string, string> = { site_hash: siteHash, keyword };
    if (engines?.length) params['engines[]'] = engines.join(',');
    if (tags?.length) params['tags[]'] = tags.join(',');
    return this.client.request('/keyword/add', params);
  }

  async removeKeyword(siteHash: string, keyword: string): Promise<{ success: boolean }> {
    return this.client.request('/keyword/remove', { site_hash: siteHash, keyword });
  }

  // Rankings
  async getRankings(siteHash: string, options?: {
    startDate?: string;
    endDate?: string;
    engine?: string;
    keyword?: string;
  }): Promise<RankingEntry[]> {
    const result = await this.client.request<{ rankings: RankingEntry[] }>('/rankings', {
      site_hash: siteHash,
      start_date: options?.startDate,
      end_date: options?.endDate,
      engine: options?.engine,
      keyword: options?.keyword,
    });
    return result.rankings ?? [];
  }

  // Competitors
  async listCompetitors(siteHash: string): Promise<Competitor[]> {
    const result = await this.client.request<{ competitors: Competitor[] }>('/competitors', {
      site_hash: siteHash,
    });
    return result.competitors ?? [];
  }

  async addCompetitor(siteHash: string, domain: string, label?: string): Promise<{ success: boolean }> {
    return this.client.request('/competitor/add', { site_hash: siteHash, domain, label });
  }

  getClient(): RavenToolsClient { return this.client; }
}
