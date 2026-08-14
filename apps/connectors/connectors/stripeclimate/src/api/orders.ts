import type { ConnectorClient } from './client';
import type {
  ClimateOrder,
  ClimateOrderCreateParams,
  ClimateOrderUpdateParams,
  ClimateOrderListOptions,
  StripeList,
} from '../types';

/**
 * Stripe Climate Orders API
 * https://docs.stripe.com/api/climate/order
 */
export class OrdersApi {
  constructor(private readonly client: ConnectorClient) {}

  /**
   * Create a Climate order object for a given Climate product.
   * Exactly one of `amount` or `metric_tons` must be provided.
   */
  async create(params: ClimateOrderCreateParams): Promise<ClimateOrder> {
    return this.client.post<ClimateOrder>('/climate/orders', params);
  }

  /**
   * Retrieve a Climate order by ID.
   */
  async get(id: string): Promise<ClimateOrder> {
    return this.client.get<ClimateOrder>(`/climate/orders/${id}`);
  }

  /**
   * List all Climate order objects.
   */
  async list(options?: ClimateOrderListOptions): Promise<StripeList<ClimateOrder>> {
    return this.client.get<StripeList<ClimateOrder>>(
      '/climate/orders',
      options as Record<string, string | number | boolean | undefined>,
    );
  }

  /**
   * Update the specified Climate order by setting the values of the
   * parameters passed (beneficiary, metadata).
   */
  async update(id: string, params: ClimateOrderUpdateParams): Promise<ClimateOrder> {
    return this.client.post<ClimateOrder>(`/climate/orders/${id}`, params);
  }

  /**
   * Cancel a Climate order. You can cancel orders that are still in an
   * `open`, `awaiting_funds`, or `confirmed` state. Reserved funds are
   * refunded, minus fees already used for delivered removal.
   */
  async cancel(id: string): Promise<ClimateOrder> {
    return this.client.post<ClimateOrder>(`/climate/orders/${id}/cancel`);
  }
}
