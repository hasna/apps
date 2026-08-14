// YOURLS Connector — Self-hosted URL shortener and link management
import { YOURLSClient } from './client';
import type { YOURLSConfig, YOURLSLink, YOURLSStats, YOURLSShortenResult } from '../types';
export { YOURLSClient } from './client';

export class YOURLS {
  private readonly client: YOURLSClient;
  constructor(config: YOURLSConfig) { this.client = new YOURLSClient(config); }
  static fromEnv(): YOURLS {
    const apiUrl = process.env.YOURLS_API_URL;
    const signatureToken = process.env.YOURLS_SIGNATURE;
    if (!apiUrl || !signatureToken) throw new Error('YOURLS_API_URL and YOURLS_SIGNATURE are required');
    return new YOURLS({ apiUrl, signatureToken });
  }

  /** Shorten a URL */
  async shorten(url: string, options?: { keyword?: string; title?: string }): Promise<YOURLSShortenResult> {
    return this.client.request<YOURLSShortenResult>('shorturl', { url, keyword: options?.keyword, title: options?.title });
  }

  /** Expand a short URL to its original */
  async expand(shorturl: string): Promise<{ keyword: string; shorturl: string; url: string; title: string; clicks: number }> {
    return this.client.request('expand', { shorturl });
  }

  /** Get stats for a specific short URL */
  async getUrlStats(shorturl: string): Promise<{ link: YOURLSLink; statusCode: number; message: string }> {
    return this.client.request('url-stats', { shorturl });
  }

  /** Get global stats */
  async getStats(filter?: 'top' | 'bottom' | 'rand' | 'last', limit?: number): Promise<{ stats: YOURLSStats; links: Record<string, YOURLSLink> }> {
    return this.client.request('stats', { filter: filter || 'top', limit: limit || 10 });
  }

  /** Get database stats (total links + clicks) */
  async getDbStats(): Promise<YOURLSStats> {
    const r = await this.client.request<{ db_stats: YOURLSStats }>('db-stats');
    return r.db_stats;
  }

  getClient(): YOURLSClient { return this.client; }
}
