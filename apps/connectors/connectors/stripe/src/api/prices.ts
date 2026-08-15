import type { ConnectorClient } from './client';
import type {
  Price,
  PriceCreateParams,
  PriceUpdateParams,
  PriceListOptions,
  StripeList,
  StripeSearchResult,
} from '../types';

/**
 * Stripe Prices API
 * https://stripe.com/docs/api/prices
 */
export class PricesApi {
  constructor(private readonly client: ConnectorClient) {}

  /**
   * Create a price
   */
  async create(params: PriceCreateParams): Promise<Price> {
    return this.client.post<Price>('/prices', params);
  }

  /**
   * Retrieve a price by ID
   */
  async get(id: string): Promise<Price> {
    return this.client.get<Price>(`/prices/${id}`);
  }

  /**
   * Update a price
   */
  async update(id: string, params: PriceUpdateParams): Promise<Price> {
    return this.client.post<Price>(`/prices/${id}`, params);
  }

  /**
   * List all prices
   */
  async list(options?: PriceListOptions): Promise<StripeList<Price>> {
    return this.client.get<StripeList<Price>>('/prices', options as Record<string, string | number | boolean | undefined>);
  }

  /**
   * Search prices
   * Query syntax: https://stripe.com/docs/search#query-fields-for-prices
   */
  async search(query: string, options?: { limit?: number; page?: string }): Promise<StripeSearchResult<Price>> {
    return this.client.get<StripeSearchResult<Price>>('/prices/search', {
      query,
      limit: options?.limit,
      page: options?.page,
    });
  }
}
