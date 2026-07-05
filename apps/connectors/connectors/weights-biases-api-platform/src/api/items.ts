import type { CreateItemParams, ItemSummary, ItemsListResponse } from '../types';
import type { WeightsBiasesApiPlatformClient } from './client';

export interface ListItemsParams {
  order?: string;
  perPage?: number;
  [key: string]: string | number | boolean | undefined;
}

export class ItemsApi {
  constructor(private readonly client: WeightsBiasesApiPlatformClient) {}

  list(params?: ListItemsParams): Promise<ItemsListResponse> {
    return this.client.get<ItemsListResponse>('/items', params);
  }

  get(itemId: string): Promise<ItemSummary> {
    const encoded = encodeURIComponent(itemId);
    return this.client.get<ItemSummary>(`/items/${encoded}`);
  }

  create(body: CreateItemParams): Promise<ItemSummary> {
    return this.client.post<ItemSummary>('/items', body);
  }
}
