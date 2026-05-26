import type { MercuryClient } from './client';
import type {
  Customer,
  CustomerListResponse,
  CustomerCreateParams,
} from '../types';

/**
 * Mercury Customers API
 * Manage invoice customers
 */
export class CustomersApi {
  constructor(private readonly client: MercuryClient) {}

  /**
   * List customers
   */
  async list(params?: { limit?: number; offset?: number; search?: string }): Promise<CustomerListResponse> {
    return this.client.get<CustomerListResponse>('/ar/customers', {
      limit: params?.limit,
      offset: params?.offset,
      search: params?.search,
    });
  }

  /**
   * Get a single customer
   */
  async get(customerId: string): Promise<Customer> {
    return this.client.get<Customer>(`/ar/customers/${customerId}`);
  }

  /**
   * Create a new customer
   */
  async create(params: CustomerCreateParams): Promise<Customer> {
    return this.client.post<Customer>('/ar/customers', params);
  }

  /**
   * Update a customer
   */
  async update(customerId: string, params: Partial<CustomerCreateParams>): Promise<Customer> {
    return this.client.patch<Customer>(`/ar/customers/${customerId}`, params);
  }

  /**
   * Delete a customer
   */
  async delete(customerId: string): Promise<void> {
    await this.client.delete(`/ar/customers/${customerId}`);
  }
}
