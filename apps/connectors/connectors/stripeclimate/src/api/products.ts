import type { ConnectorClient } from './client';
import type { ClimateProduct, ClimateProductListOptions, StripeList } from '../types';

/**
 * Stripe Climate Products API
 * https://docs.stripe.com/api/climate/product
 */
export class ProductsApi {
  constructor(private readonly client: ConnectorClient) {}

  /**
   * List all available Climate product objects.
   */
  async list(options?: ClimateProductListOptions): Promise<StripeList<ClimateProduct>> {
    return this.client.get<StripeList<ClimateProduct>>(
      '/climate/products',
      options as Record<string, string | number | boolean | undefined>,
    );
  }

  /**
   * Retrieve a Climate product by ID.
   */
  async get(id: string): Promise<ClimateProduct> {
    return this.client.get<ClimateProduct>(`/climate/products/${id}`);
  }
}
