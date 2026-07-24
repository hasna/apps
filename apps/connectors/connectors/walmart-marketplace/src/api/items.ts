import type { WalmartMarketplaceClient } from './client';
import type { WalmartItem, WalmartItemsListResponse, WalmartItemResponse } from '../types';

export interface ListItemsOptions {
  limit?: number;
  offset?: number;
  sku?: string;
  lifecycleStatus?: string;
  publishedStatus?: string;
  nextCursor?: string;
}

export class ItemsApi {
  constructor(private readonly client: WalmartMarketplaceClient) {}

  async list(options: ListItemsOptions = {}): Promise<WalmartItemsListResponse> {
    const params: Record<string, string | number | boolean | undefined> = {};

    if (options.limit !== undefined) params.limit = options.limit;
    if (options.offset !== undefined) params.offset = options.offset;
    if (options.sku) params.sku = options.sku;
    if (options.lifecycleStatus) params.lifecycleStatus = options.lifecycleStatus;
    if (options.publishedStatus) params.publishedStatus = options.publishedStatus;
    if (options.nextCursor) params.nextCursor = options.nextCursor;

    return this.client.get<WalmartItemsListResponse>('/items', params);
  }

  async get(sku: string): Promise<WalmartItem> {
    const response = await this.client.get<WalmartItemResponse>(`/items/${encodeURIComponent(sku)}`);
    const item = response.ItemResponse?.[0];
    if (!item) {
      throw new Error(`Item not found for SKU: ${sku}`);
    }
    return item;
  }
}
