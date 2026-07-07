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
   * POST /v2/{storeHash}/dashboard/customers/add
   */
  async add(customer: StampedioCustomer): Promise<StampedioCustomer> {
    return this.client.request<StampedioCustomer>(this.client.storePath('/dashboard/customers/add'), {
      method: 'POST',
      body: { ...customer },
    });
  }
}
