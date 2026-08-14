import type { SmileClient } from './client';
import type {
  Customer,
  CustomerResponse,
  ListCustomersOptions,
  ListCustomersResponse,
} from '../types';

/**
 * Customers API — the loyalty program members.
 * Endpoints: GET /customers, GET /customers/{id}
 */
export class CustomersApi {
  constructor(private readonly client: SmileClient) {}

  /** List customers with optional filters and cursor pagination. */
  async list(options: ListCustomersOptions = {}): Promise<ListCustomersResponse> {
    return this.client.request<ListCustomersResponse>('/customers', {
      params: {
        email: options.email,
        state: options.state,
        updated_at_min: options.updated_at_min,
        limit: options.limit,
        cursor: options.cursor,
        include: options.include,
      },
    });
  }

  /** Retrieve a single customer by Smile customer ID. */
  async get(id: number, include?: string): Promise<Customer> {
    const response = await this.client.request<CustomerResponse>(`/customers/${id}`, {
      params: { include },
    });
    return response.customer;
  }
}
