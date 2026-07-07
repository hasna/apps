import type { StampedioClient } from './client';
import type { StampedioCustomer } from '../types';

/**
 * Customers API — sync storefront customers into Stamped.io so review-request
 * and loyalty flows can target them.
 */
export class CustomersApi {
  constructor(private readonly client: StampedioClient) {}

  /**
   * Add (or upsert) a customer.
   * POST /v3/merchant/shops/{shopId}/customers
   */
  async add(customer: StampedioCustomer): Promise<StampedioCustomer> {
    return this.client.request<StampedioCustomer>(this.client.merchantPath('/customers'), {
      method: 'POST',
      body: { ...customer },
    });
  }
}
