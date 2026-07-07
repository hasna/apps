import type { SquarespaceClient } from './client';
import type { StorePage } from '../types';

export interface StorePagesListResponse {
  storePages: StorePage[];
  pagination?: { nextPageCursor?: string; hasNextPage?: boolean };
}

export class StorePagesApi {
  constructor(private readonly client: SquarespaceClient) {}

  async list(cursor?: string): Promise<StorePagesListResponse> {
    return this.client.request<StorePagesListResponse>('/commerce/store_pages', {
      params: { cursor },
    });
  }

}
