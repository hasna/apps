import type { YouComClient } from './client';
import type { SearchGetParams, SearchPostBody, SearchResponse } from '../types';

export class SearchApi {
  constructor(private readonly client: YouComClient) {}

  async get(params: SearchGetParams): Promise<SearchResponse> {
    const queryParams: Record<string, string | number | boolean | undefined> = {
      query: params.query,
    };

    if (params.count !== undefined) queryParams.count = params.count;
    if (params.freshness !== undefined) queryParams.freshness = params.freshness;
    if (params.offset !== undefined) queryParams.offset = params.offset;
    if (params.country !== undefined) queryParams.country = params.country;
    if (params.language !== undefined) queryParams.language = params.language;
    if (params.safesearch !== undefined) queryParams.safesearch = params.safesearch;
    if (params.livecrawl !== undefined) queryParams.livecrawl = params.livecrawl;
    if (params.crawl_timeout !== undefined) queryParams.crawl_timeout = params.crawl_timeout;
    if (params.include_domains !== undefined) queryParams.include_domains = params.include_domains;
    if (params.exclude_domains !== undefined) queryParams.exclude_domains = params.exclude_domains;
    if (params.boost_domains !== undefined) queryParams.boost_domains = params.boost_domains;

    if (params.livecrawl_formats !== undefined) {
      const formats = Array.isArray(params.livecrawl_formats)
        ? params.livecrawl_formats.join(',')
        : params.livecrawl_formats;
      queryParams.livecrawl_formats = formats;
    }

    return this.client.get<SearchResponse>(
      '/v1/search',
      queryParams,
      this.client.getSearchBaseUrl(),
    );
  }

  async post(body: SearchPostBody): Promise<SearchResponse> {
    return this.client.post<SearchResponse>(
      '/v1/search',
      { ...body },
      this.client.getSearchBaseUrl(),
    );
  }
}
