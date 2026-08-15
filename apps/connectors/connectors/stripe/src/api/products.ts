import type { ConnectorClient } from './client';
import type {
  Product,
  ProductCreateParams,
  ProductUpdateParams,
  ProductListOptions,
  StripeList,
  StripeSearchResult,
  DeletedObject,
} from '../types';

/**
 * Stripe Products API
 * https://stripe.com/docs/api/products
 */
export class ProductsApi {
  constructor(private readonly client: ConnectorClient) {}

  /**
   * Create a product
   */
  async create(params: ProductCreateParams): Promise<Product> {
    return this.client.post<Product>('/products', params);
  }

  /**
   * Retrieve a product by ID
   */
  async get(id: string): Promise<Product> {
    return this.client.get<Product>(`/products/${id}`);
  }

  /**
   * Update a product
   */
  async update(id: string, params: ProductUpdateParams): Promise<Product> {
    return this.client.post<Product>(`/products/${id}`, params);
  }

  /**
   * List all products
   */
  async list(options?: ProductListOptions): Promise<StripeList<Product>> {
    return this.client.get<StripeList<Product>>('/products', options as Record<string, string | number | boolean | undefined>);
  }

  /**
   * Delete a product
   */
  async del(id: string): Promise<DeletedObject> {
    return this.client.delete<DeletedObject>(`/products/${id}`);
  }

  /**
   * Search products
   * Query syntax: https://stripe.com/docs/search#query-fields-for-products
   */
  async search(query: string, options?: { limit?: number; page?: string }): Promise<StripeSearchResult<Product>> {
    return this.client.get<StripeSearchResult<Product>>('/products/search', {
      query,
      limit: options?.limit,
      page: options?.page,
    });
  }
}
