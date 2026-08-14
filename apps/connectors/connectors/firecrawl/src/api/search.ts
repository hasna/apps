import type { FirecrawlClient } from './client';
import type { SearchRequest, SearchResponse } from '../types';

/**
 * Search API - Search the web and scrape results (Beta)
 */
export class SearchApi {
  constructor(private readonly client: FirecrawlClient) {}

  /**
   * Search the web and scrape the results
   * @param query - The search query
   * @param options - Search options
   */
  async search(query: string, options?: Omit<SearchRequest, 'query'>): Promise<SearchResponse> {
    const body: SearchRequest = {
      query,
      ...options,
    };

    return this.client.post<SearchResponse>('/search', body);
  }

  /**
   * Search with language and country filters
   * @param query - The search query
   * @param lang - Language code (e.g., 'en', 'es', 'fr')
   * @param country - Country code (e.g., 'us', 'gb', 'de')
   * @param limit - Maximum number of results
   */
  async searchLocalized(
    query: string,
    lang: string,
    country: string,
    limit?: number
  ): Promise<SearchResponse> {
    return this.search(query, { lang, country, limit });
  }

  /**
   * Search with time filter
   * @param query - The search query
   * @param timeFilter - Time filter: 'day', 'week', 'month', 'year'
   * @param limit - Maximum number of results
   */
  async searchRecent(
    query: string,
    timeFilter: 'day' | 'week' | 'month' | 'year',
    limit?: number
  ): Promise<SearchResponse> {
    // Google tbs parameter for time filtering
    const tbsMap = {
      day: 'qdr:d',
      week: 'qdr:w',
      month: 'qdr:m',
      year: 'qdr:y',
    };

    return this.search(query, { tbs: tbsMap[timeFilter], limit });
  }
}
