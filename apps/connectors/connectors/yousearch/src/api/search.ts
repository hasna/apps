import type { YouSearchClient } from './client';
import type { SearchGetOptions, SearchPostOptions, SearchResponse } from '../types';

function joinDomains(domains?: string | string[]): string | undefined {
  if (!domains) return undefined;
  return Array.isArray(domains) ? domains.join(',') : domains;
}

function formatLiveCrawlFormats(formats?: SearchGetOptions['livecrawl_formats']): string | undefined {
  if (!formats) return undefined;
  return Array.isArray(formats) ? formats.join(',') : formats;
}

/**
 * Search API - Web and news search via GET and POST /v1/search
 */
export class SearchApi {
  constructor(private readonly client: YouSearchClient) {}

  /**
   * Simple GET search (cacheable, best for straightforward queries)
   */
  async search(options: SearchGetOptions): Promise<SearchResponse> {
    const params: Record<string, string | number | boolean | undefined> = {
      query: options.query,
      count: options.count,
      freshness: options.freshness,
      offset: options.offset,
      country: options.country,
      language: options.language,
      safesearch: options.safesearch,
      livecrawl: options.livecrawl,
      livecrawl_formats: formatLiveCrawlFormats(options.livecrawl_formats),
      include_domains: joinDomains(options.include_domains),
      exclude_domains: joinDomains(options.exclude_domains),
      boost_domains: joinDomains(options.boost_domains),
      crawl_timeout: options.crawl_timeout,
    };

    return this.client.get<SearchResponse>('/v1/search', params);
  }

  /**
   * POST search (recommended for complex domain lists and large parameter sets)
   */
  async searchPost(options: SearchPostOptions): Promise<SearchResponse> {
    const body: Record<string, unknown> = {
      query: options.query,
    };

    if (options.count !== undefined) body.count = options.count;
    if (options.freshness !== undefined) body.freshness = options.freshness;
    if (options.offset !== undefined) body.offset = options.offset;
    if (options.country !== undefined) body.country = options.country;
    if (options.language !== undefined) body.language = options.language;
    if (options.safesearch !== undefined) body.safesearch = options.safesearch;
    if (options.livecrawl !== undefined) body.livecrawl = options.livecrawl;
    if (options.livecrawl_formats !== undefined) body.livecrawl_formats = options.livecrawl_formats;
    if (options.include_domains !== undefined) body.include_domains = options.include_domains;
    if (options.exclude_domains !== undefined) body.exclude_domains = options.exclude_domains;
    if (options.boost_domains !== undefined) body.boost_domains = options.boost_domains;
    if (options.crawl_timeout !== undefined) body.crawl_timeout = options.crawl_timeout;

    return this.client.post<SearchResponse>('/v1/search', body);
  }
}
