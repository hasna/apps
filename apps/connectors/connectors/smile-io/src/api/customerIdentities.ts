import type { SmileClient } from './client';
import type {
  CreateCustomerIdentityInput,
  CustomerIdentity,
  CustomerIdentityResponse,
} from '../types';

/**
 * Customer Identities API — links external users to Smile customers.
 * Endpoint: POST /customer_identities/create_or_update
 */
export class CustomerIdentitiesApi {
  constructor(private readonly client: SmileClient) {}

  /**
   * Create or update a customer identity. Matches on `distinct_id`:
   * a new identity (and customer) is created when none exists.
   */
  async createOrUpdate(input: CreateCustomerIdentityInput): Promise<CustomerIdentity> {
    const response = await this.client.request<CustomerIdentityResponse>(
      '/customer_identities/create_or_update',
      { method: 'POST', body: { customer_identity: input } },
    );
    return response.customer_identity;
  }
}
