import type { SmileClient } from './client';
import type {
  ListPointsProductsOptions,
  ListPointsProductsResponse,
  PointsProduct,
  PointsProductResponse,
  PointsPurchase,
  PointsPurchaseResponse,
  PurchasePointsProductInput,
} from '../types';

/**
 * Points Products API — the reward options customers redeem points for.
 * Endpoints: GET /points_products, GET /points_products/{id},
 *            POST /points_products/{id}/purchase
 */
export class PointsProductsApi {
  constructor(private readonly client: SmileClient) {}

  /** List points products (page-based pagination). */
  async list(options: ListPointsProductsOptions = {}): Promise<ListPointsProductsResponse> {
    return this.client.request<ListPointsProductsResponse>('/points_products', {
      params: {
        exchange_type: options.exchange_type,
        page: options.page,
        page_size: options.page_size,
      },
    });
  }

  /** Retrieve a single points product by ID. */
  async get(id: number): Promise<PointsProduct> {
    const response = await this.client.request<PointsProductResponse>(`/points_products/${id}`);
    return response.points_product;
  }

  /**
   * Redeem a points product on behalf of a customer.
   * `points_to_spend` only applies to `variable` exchange-type products.
   */
  async purchase(id: number, input: PurchasePointsProductInput): Promise<PointsPurchase> {
    const response = await this.client.request<PointsPurchaseResponse>(
      `/points_products/${id}/purchase`,
      { method: 'POST', body: { ...input } },
    );
    return response.points_purchase;
  }
}
