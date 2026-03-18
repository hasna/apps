// Wikipedia Connector — Free encyclopedia (no API key required)
import { WikipediaClient } from './client';
import type { WikipediaConfig, WikiArticleSummary, WikiSearchResult, WikiRandomArticle } from '../types';
export { WikipediaClient } from './client';

export class Wikipedia {
  private readonly client: WikipediaClient;
  constructor(config: WikipediaConfig = {}) { this.client = new WikipediaClient(config); }

  static fromEnv(): Wikipedia {
    return new Wikipedia({ language: process.env.WIKIPEDIA_LANGUAGE || 'en' });
  }

  /** Get article summary by title */
  async getSummary(title: string): Promise<WikiArticleSummary> {
    const encoded = encodeURIComponent(title.replace(/ /g, '_'));
    return this.client.request<WikiArticleSummary>(`/api/rest_v1/page/summary/${encoded}`);
  }

  /** Search Wikipedia articles */
  async search(query: string, options?: { limit?: number; offset?: number }): Promise<WikiSearchResult[]> {
    const r = await this.client.request<{ query: { search: WikiSearchResult[] } }>('/w/api.php', {
      action: 'query', list: 'search', srsearch: query, srlimit: options?.limit || 10,
      sroffset: options?.offset, format: 'json', utf8: 1,
    });
    return r.query?.search ?? [];
  }

  /** Get a random article */
  async getRandom(): Promise<WikiRandomArticle> {
    const r = await this.client.request<{ items: WikiRandomArticle[] }>('/api/rest_v1/page/random/summary');
    return (r as unknown as WikiArticleSummary & { pageid: number; key: string; excerpt: string; description: string });
  }

  /** Get full article content as plain text */
  async getContent(title: string): Promise<string> {
    const encoded = encodeURIComponent(title.replace(/ /g, '_'));
    const r = await this.client.request<{ query: { pages: Record<string, { extract: string }> } }>('/w/api.php', {
      action: 'query', prop: 'extracts', exintro: 0, explaintext: 1,
      titles: title, format: 'json', utf8: 1,
    });
    const pages = r.query?.pages ?? {};
    const page = Object.values(pages)[0];
    return page?.extract ?? '';
  }

  /** Check if an article exists */
  async exists(title: string): Promise<boolean> {
    try { await this.getSummary(title); return true; } catch { return false; }
  }

  /** Get article in a different language */
  inLanguage(lang: string): Wikipedia {
    return new Wikipedia({ language: lang });
  }

  getClient(): WikipediaClient { return this.client; }
}
