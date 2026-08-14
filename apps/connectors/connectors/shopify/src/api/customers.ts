import type { ShopifyClient } from './client';
import type { Customer, Address, CreateCustomerRequest, UpdateCustomerRequest } from '../types';

export interface ListCustomersOptions {
  limit?: number;
  sinceId?: number;
  createdAtMin?: string;
  createdAtMax?: string;
  updatedAtMin?: string;
  updatedAtMax?: string;
  ids?: string;
  fields?: string;
}

export interface SearchCustomersOptions {
  query: string;
  limit?: number;
  fields?: string;
}

/**
 * Shopify Customers API
 */
export class CustomersApi {
  constructor(private readonly client: ShopifyClient) {}

  /**
   * List customers
   */
  async list(options: ListCustomersOptions = {}): Promise<Customer[]> {
    const params: Record<string, string | number | boolean | undefined> = {
      limit: options.limit || 50,
    };

    if (options.sinceId) params.since_id = options.sinceId;
    if (options.createdAtMin) params.created_at_min = options.createdAtMin;
    if (options.createdAtMax) params.created_at_max = options.createdAtMax;
    if (options.updatedAtMin) params.updated_at_min = options.updatedAtMin;
    if (options.updatedAtMax) params.updated_at_max = options.updatedAtMax;
    if (options.ids) params.ids = options.ids;
    if (options.fields) params.fields = options.fields;

    const response = await this.client.request<{ customers: Record<string, unknown>[] }>(
      '/customers.json',
      { params }
    );

    return this.transformCustomers(response.customers);
  }

  /**
   * Search customers
   */
  async search(options: SearchCustomersOptions): Promise<Customer[]> {
    const params: Record<string, string | number | boolean | undefined> = {
      query: options.query,
      limit: options.limit || 50,
    };

    if (options.fields) params.fields = options.fields;

    const response = await this.client.request<{ customers: Record<string, unknown>[] }>(
      '/customers/search.json',
      { params }
    );

    return this.transformCustomers(response.customers);
  }

  /**
   * Get a single customer by ID
   */
  async get(id: number, fields?: string): Promise<Customer> {
    const params: Record<string, string | number | boolean | undefined> = {};
    if (fields) params.fields = fields;

    const response = await this.client.request<{ customer: Record<string, unknown> }>(
      `/customers/${id}.json`,
      { params }
    );

    return this.transformCustomer(response.customer);
  }

  /**
   * Get customer count
   */
  async count(): Promise<number> {
    const response = await this.client.request<{ count: number }>(
      '/customers/count.json'
    );

    return response.count;
  }

  /**
   * Create a new customer
   */
  async create(customer: CreateCustomerRequest): Promise<Customer> {
    const body = {
      customer: {
        email: customer.email,
        first_name: customer.firstName,
        last_name: customer.lastName,
        phone: customer.phone,
        note: customer.note,
        tags: customer.tags,
        accepts_marketing: customer.acceptsMarketing,
        addresses: customer.addresses?.map(a => ({
          address1: a.address1,
          address2: a.address2,
          city: a.city,
          company: a.company,
          country: a.country,
          country_code: a.countryCode,
          first_name: a.firstName,
          last_name: a.lastName,
          phone: a.phone,
          province: a.province,
          province_code: a.provinceCode,
          zip: a.zip,
        })),
      },
    };

    const response = await this.client.request<{ customer: Record<string, unknown> }>(
      '/customers.json',
      { method: 'POST', body }
    );

    return this.transformCustomer(response.customer);
  }

  /**
   * Update an existing customer
   */
  async update(id: number, customer: UpdateCustomerRequest): Promise<Customer> {
    const body = {
      customer: {
        id,
        email: customer.email,
        first_name: customer.firstName,
        last_name: customer.lastName,
        phone: customer.phone,
        note: customer.note,
        tags: customer.tags,
        accepts_marketing: customer.acceptsMarketing,
      },
    };

    const response = await this.client.request<{ customer: Record<string, unknown> }>(
      `/customers/${id}.json`,
      { method: 'PUT', body }
    );

    return this.transformCustomer(response.customer);
  }

  /**
   * Delete a customer
   */
  async delete(id: number): Promise<void> {
    await this.client.request<void>(`/customers/${id}.json`, { method: 'DELETE' });
  }

  /**
   * Get customer orders
   */
  async orders(id: number, status?: 'open' | 'closed' | 'cancelled' | 'any'): Promise<unknown[]> {
    const params: Record<string, string | number | boolean | undefined> = {};
    if (status) params.status = status;

    const response = await this.client.request<{ orders: unknown[] }>(
      `/customers/${id}/orders.json`,
      { params }
    );

    return response.orders;
  }

  /**
   * Transform API response to our types
   */
  private transformCustomer(customer: Record<string, unknown>): Customer {
    return {
      id: customer.id as number,
      email: customer.email as string | undefined,
      acceptsMarketing: customer.accepts_marketing as boolean,
      createdAt: customer.created_at as string,
      updatedAt: customer.updated_at as string,
      firstName: customer.first_name as string | undefined,
      lastName: customer.last_name as string | undefined,
      ordersCount: customer.orders_count as number,
      state: customer.state as string,
      totalSpent: customer.total_spent as string,
      lastOrderId: customer.last_order_id as number | undefined,
      note: customer.note as string | undefined,
      verifiedEmail: customer.verified_email as boolean,
      multipassIdentifier: customer.multipass_identifier as string | undefined,
      taxExempt: customer.tax_exempt as boolean,
      tags: customer.tags as string,
      lastOrderName: customer.last_order_name as string | undefined,
      currency: customer.currency as string,
      phone: customer.phone as string | undefined,
      addresses: (customer.addresses as Record<string, unknown>[] || []).map(a => this.transformAddress(a)),
      acceptsMarketingUpdatedAt: customer.accepts_marketing_updated_at as string | undefined,
      marketingOptInLevel: customer.marketing_opt_in_level as string | undefined,
      taxExemptions: customer.tax_exemptions as string[] || [],
      adminGraphqlApiId: customer.admin_graphql_api_id as string,
      defaultAddress: customer.default_address ? this.transformAddress(customer.default_address as Record<string, unknown>) : undefined,
    };
  }

  private transformCustomers(customers: Record<string, unknown>[]): Customer[] {
    return customers.map(c => this.transformCustomer(c));
  }

  private transformAddress(address: Record<string, unknown>): Address {
    return {
      id: address.id as number | undefined,
      customerId: address.customer_id as number | undefined,
      firstName: address.first_name as string | undefined,
      lastName: address.last_name as string | undefined,
      company: address.company as string | undefined,
      address1: address.address1 as string | undefined,
      address2: address.address2 as string | undefined,
      city: address.city as string | undefined,
      province: address.province as string | undefined,
      country: address.country as string | undefined,
      zip: address.zip as string | undefined,
      phone: address.phone as string | undefined,
      name: address.name as string | undefined,
      provinceCode: address.province_code as string | undefined,
      countryCode: address.country_code as string | undefined,
      countryName: address.country_name as string | undefined,
      default: address.default as boolean | undefined,
    };
  }
}
