import type { ZenserpClient } from './client';
import type { SearchParams, SearchResponse } from '../types';

function normalizeSearchParams(params: SearchParams): Record<string, string | number | boolean | undefined> {
  const normalized: Record<string, string | number | boolean | undefined> = { ...params };

  const query = params.q ?? params.query;
  if (query !== undefined) {
    normalized.q = query;
  }

  const imageUrl = params.image_url ?? params.imageUrl;
  if (imageUrl !== undefined) {
    normalized.image_url = imageUrl;
  }

  delete normalized.query;
  delete normalized.imageUrl;

  return normalized;
}

export class SearchApi {
  constructor(private readonly client: ZenserpClient) {}

  async search(params: SearchParams): Promise<SearchResponse> {
    return this.client.get<SearchResponse>('/search', normalizeSearchParams(params));
  }

  async imageSearch(params: SearchParams): Promise<SearchResponse> {
    return this.search({ ...params, tbm: 'isch' });
  }

  async mapSearch(params: SearchParams): Promise<SearchResponse> {
    return this.search({ ...params, tbm: 'map' });
  }

  async reverseImageSearch(params: SearchParams): Promise<SearchResponse> {
    const imageUrl = params.image_url ?? params.imageUrl;
    if (!imageUrl) {
      throw new Error('image_url is required for reverse image search');
    }
    return this.search({ ...params, image_url: imageUrl, tbm: 'isch' });
  }

  async rawRequest(
    path: string,
    params?: Record<string, string | number | boolean | undefined>
  ): Promise<SearchResponse> {
    return this.client.get<SearchResponse>(path, params);
  }
}
