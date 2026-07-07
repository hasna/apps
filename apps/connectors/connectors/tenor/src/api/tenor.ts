import type { ConnectorClient } from './client';
import type {
  SearchParams,
  CategoriesParams,
  TermsParams,
  TenorSearchResponse,
  CategoriesResponse,
  TermsResponse,
} from '../types';

/**
 * Tenor v2 API module.
 *
 * Wraps the public, read-only endpoints of Google's Tenor API:
 * https://developers.google.com/tenor/guides/endpoints
 */
export class TenorApi {
  constructor(private readonly client: ConnectorClient) {}

  private searchQuery(params?: SearchParams): Record<string, string | number | boolean | undefined> {
    return {
      limit: params?.limit,
      pos: params?.pos,
      locale: params?.locale,
      country: params?.country,
      contentfilter: params?.contentFilter,
      media_filter: params?.mediaFilter,
      ar_range: params?.arRange,
      random: params?.random,
    };
  }

  /**
   * Search for GIFs and stickers matching a query.
   */
  async search(query: string, params?: SearchParams): Promise<TenorSearchResponse> {
    return this.client.get<TenorSearchResponse>('/search', {
      q: query,
      ...this.searchQuery(params),
    });
  }

  /**
   * Get a curated feed of featured GIFs (no search term).
   */
  async featured(params?: SearchParams): Promise<TenorSearchResponse> {
    return this.client.get<TenorSearchResponse>('/featured', this.searchQuery(params));
  }

  /**
   * List GIF categories (featured or trending).
   */
  async categories(params?: CategoriesParams): Promise<CategoriesResponse> {
    return this.client.get<CategoriesResponse>('/categories', {
      type: params?.type,
      locale: params?.locale,
      country: params?.country,
      contentfilter: params?.contentFilter,
    });
  }

  /**
   * Get autocomplete suggestions for a partial search term.
   */
  async autocomplete(query: string, params?: TermsParams): Promise<TermsResponse> {
    return this.client.get<TermsResponse>('/autocomplete', {
      q: query,
      limit: params?.limit,
      locale: params?.locale,
      country: params?.country,
    });
  }

  /**
   * Get the current list of trending search terms.
   */
  async trendingTerms(params?: TermsParams): Promise<TermsResponse> {
    return this.client.get<TermsResponse>('/trending_terms', {
      limit: params?.limit,
      locale: params?.locale,
      country: params?.country,
    });
  }
}
