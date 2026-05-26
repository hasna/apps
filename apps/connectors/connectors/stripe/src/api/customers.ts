import type { ConnectorClient } from './client';
import type {
  Customer,
  CustomerCreateParams,
  CustomerUpdateParams,
  CustomerListOptions,
  StripeList,
  StripeSearchResult,
  DeletedObject,
} from '../types';

/**
 * Stripe Customers API
 * https://stripe.com/docs/api/customers
 */
export class CustomersApi {
  constructor(private readonly client: ConnectorClient) {}

  /**
   * Create a customer
   */
  async create(params?: CustomerCreateParams): Promise<Customer> {
    return this.client.post<Customer>('/customers', params || {});
  }

  /**
   * Retrieve a customer by ID
   */
  async get(id: string): Promise<Customer> {
    return this.client.get<Customer>(`/customers/${id}`);
  }

  /**
   * Update a customer
   */
  async update(id: string, params: CustomerUpdateParams): Promise<Customer> {
    return this.client.post<Customer>(`/customers/${id}`, params);
  }

  /**
   * List all customers
   */
  async list(options?: CustomerListOptions): Promise<StripeList<Customer>> {
    return this.client.get<StripeList<Customer>>('/customers', options as Record<string, string | number | boolean | undefined>);
  }

  /**
   * Delete a customer
   */
  async del(id: string): Promise<DeletedObject> {
    return this.client.delete<DeletedObject>(`/customers/${id}`);
  }

  /**
   * Search customers
   * Query syntax: https://stripe.com/docs/search#query-fields-for-customers
   */
  async search(query: string, options?: { limit?: number; page?: string }): Promise<StripeSearchResult<Customer>> {
    return this.client.get<StripeSearchResult<Customer>>('/customers/search', {
      query,
      limit: options?.limit,
      page: options?.page,
    });
  }
}
