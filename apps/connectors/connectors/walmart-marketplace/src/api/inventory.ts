import type { WalmartMarketplaceClient } from './client';
import type { WalmartInventoryListResponse } from '../types';

export interface ListInventoryOptions {
  limit?: number;
  offset?: number;
  sku?: string;
  shipNode?: string;
}

export class InventoryApi {
  constructor(private readonly client: WalmartMarketplaceClient) {}

  async list(options: ListInventoryOptions = {}): Promise<WalmartInventoryListResponse> {
    const params: Record<string, string | number | boolean | undefined> = {};

    if (options.limit !== undefined) params.limit = options.limit;
    if (options.offset !== undefined) params.offset = options.offset;
    if (options.sku) params.sku = options.sku;
    if (options.shipNode) params.shipNode = options.shipNode;

    return this.client.get<WalmartInventoryListResponse>('/inventory', params);
  }

  async get(sku: string, shipNode?: string): Promise<WalmartInventoryListResponse> {
    const params: Record<string, string | number | boolean | undefined> = { sku };
    if (shipNode) params.shipNode = shipNode;
    return this.client.get<WalmartInventoryListResponse>('/inventory', params);
  }
}
