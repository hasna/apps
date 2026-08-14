import type { PandaDocClient } from './client';
import type { CatalogItem, CatalogItemCreateParams, CatalogListResponse } from '../types';

export interface CatalogListOptions {
  q?: string;      // Search query
  count?: number;
  page?: number;
}

/**
 * Catalogs API - Manage PandaDoc product catalog items
 */
export class CatalogsApi {
  constructor(private readonly client: PandaDocClient) {}

  /**
   * List catalog items with optional filtering
   */
  async list(options?: CatalogListOptions): Promise<CatalogListResponse> {
    const params: Record<string, string | number | boolean | undefined> = {};

    if (options) {
      if (options.q) params.q = options.q;
      if (options.count) params.count = options.count;
      if (options.page) params.page = options.page;
    }

    return this.client.get<CatalogListResponse>('/catalog-items', params);
  }

  /**
   * Get catalog item by ID
   */
  async get(id: string): Promise<CatalogItem> {
    return this.client.get<CatalogItem>(`/catalog-items/${id}`);
  }

  /**
   * Create a new catalog item
   */
  async create(params: CatalogItemCreateParams): Promise<CatalogItem> {
    return this.client.post<CatalogItem>('/catalog-items', params);
  }

  /**
   * Update a catalog item
   */
  async update(id: string, params: Partial<CatalogItemCreateParams>): Promise<CatalogItem> {
    return this.client.patch<CatalogItem>(`/catalog-items/${id}`, params);
  }

  /**
   * Delete a catalog item
   */
  async delete(id: string): Promise<void> {
    await this.client.delete(`/catalog-items/${id}`);
  }
}
