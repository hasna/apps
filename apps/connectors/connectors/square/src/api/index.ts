import type {
  SquareConfig,
  LocationsListResponse,
  Location,
  CustomersListResponse,
  CustomerResponse,
  CreateCustomerRequest,
  PaymentsListResponse,
  PaymentResponse,
  CreatePaymentRequest,
  OrderResponse,
  OrdersSearchResponse,
  CreateOrderRequest,
  CatalogListResponse,
  CatalogObjectResponse,
} from '../types';
import { SquareClient } from './client';

/**
 * Square Connector
 * Payments, orders, customers, and catalog API
 */
export class Square {
  private readonly client: SquareClient;

  constructor(config: SquareConfig) {
    this.client = new SquareClient(config);
  }

  /**
   * Create a client from environment variables
   * Looks for SQUARE_ACCESS_TOKEN
   */
  static fromEnv(): Square {
    const accessToken = process.env.SQUARE_ACCESS_TOKEN;
    const baseUrl = process.env.SQUARE_BASE_URL;

    if (!accessToken) {
      throw new Error('SQUARE_ACCESS_TOKEN environment variable is required');
    }
    return new Square({ accessToken, baseUrl });
  }

  /**
   * Get a preview of the access token (for debugging)
   */
  getAccessTokenPreview(): string {
    return this.client.getAccessTokenPreview();
  }

  /**
   * Get the underlying client for direct API access
   */
  getClient(): SquareClient {
    return this.client;
  }

  // ============================================
  // Locations API
  // ============================================

  /**
   * List all locations for this seller
   */
  async listLocations(): Promise<LocationsListResponse> {
    return this.client.get<LocationsListResponse>('/v2/locations');
  }

  /**
   * Get a single location by ID
   */
  async getLocation(locationId: string): Promise<{ location?: Location }> {
    return this.client.get<{ location?: Location }>(`/v2/locations/${locationId}`);
  }

  // ============================================
  // Customers API
  // ============================================

  /**
   * List customers
   */
  async listCustomers(options?: {
    cursor?: string;
    limit?: number;
    sort_field?: 'DEFAULT' | 'CREATED_AT';
    sort_order?: 'ASC' | 'DESC';
  }): Promise<CustomersListResponse> {
    return this.client.get<CustomersListResponse>('/v2/customers', options as Record<string, string>);
  }

  /**
   * Get a customer by ID
   */
  async getCustomer(customerId: string): Promise<CustomerResponse> {
    return this.client.get<CustomerResponse>(`/v2/customers/${customerId}`);
  }

  /**
   * Create a new customer
   */
  async createCustomer(customer: CreateCustomerRequest): Promise<CustomerResponse> {
    return this.client.post<CustomerResponse>('/v2/customers', customer);
  }

  /**
   * Update a customer
   */
  async updateCustomer(customerId: string, customer: Partial<CreateCustomerRequest>): Promise<CustomerResponse> {
    return this.client.put<CustomerResponse>(`/v2/customers/${customerId}`, customer);
  }

  /**
   * Delete a customer
   */
  async deleteCustomer(customerId: string): Promise<{ errors?: unknown[] }> {
    return this.client.delete<{ errors?: unknown[] }>(`/v2/customers/${customerId}`);
  }

  /**
   * Search customers
   */
  async searchCustomers(query: {
    limit?: number;
    cursor?: string;
    query?: {
      filter?: {
        email_address?: { exact?: string };
        phone_number?: { exact?: string };
        reference_id?: { exact?: string };
      };
      sort?: {
        field?: 'DEFAULT' | 'CREATED_AT';
        order?: 'ASC' | 'DESC';
      };
    };
  }): Promise<CustomersListResponse> {
    return this.client.post<CustomersListResponse>('/v2/customers/search', query);
  }

  // ============================================
  // Payments API
  // ============================================

  /**
   * List payments
   */
  async listPayments(options?: {
    begin_time?: string;
    end_time?: string;
    sort_order?: 'ASC' | 'DESC';
    cursor?: string;
    location_id?: string;
    total?: number;
    last_4?: string;
    card_brand?: string;
    limit?: number;
  }): Promise<PaymentsListResponse> {
    return this.client.get<PaymentsListResponse>('/v2/payments', options as Record<string, string>);
  }

  /**
   * Get a payment by ID
   */
  async getPayment(paymentId: string): Promise<PaymentResponse> {
    return this.client.get<PaymentResponse>(`/v2/payments/${paymentId}`);
  }

  /**
   * Create a payment
   */
  async createPayment(payment: CreatePaymentRequest): Promise<PaymentResponse> {
    return this.client.post<PaymentResponse>('/v2/payments', payment);
  }

  /**
   * Cancel a payment
   */
  async cancelPayment(paymentId: string): Promise<PaymentResponse> {
    return this.client.post<PaymentResponse>(`/v2/payments/${paymentId}/cancel`, {});
  }

  /**
   * Complete a payment
   */
  async completePayment(paymentId: string, versionToken?: string): Promise<PaymentResponse> {
    return this.client.post<PaymentResponse>(`/v2/payments/${paymentId}/complete`, {
      version_token: versionToken,
    });
  }

  // ============================================
  // Orders API
  // ============================================

  /**
   * Create an order
   */
  async createOrder(order: CreateOrderRequest): Promise<OrderResponse> {
    return this.client.post<OrderResponse>('/v2/orders', order);
  }

  /**
   * Get an order by ID
   */
  async getOrder(orderId: string): Promise<OrderResponse> {
    return this.client.get<OrderResponse>(`/v2/orders/${orderId}`);
  }

  /**
   * Update an order
   */
  async updateOrder(orderId: string, order: {
    order?: Partial<CreateOrderRequest['order']>;
    fields_to_clear?: string[];
    idempotency_key?: string;
  }): Promise<OrderResponse> {
    return this.client.put<OrderResponse>(`/v2/orders/${orderId}`, order);
  }

  /**
   * Search orders
   */
  async searchOrders(query: {
    location_ids?: string[];
    cursor?: string;
    query?: {
      filter?: {
        state_filter?: { states?: string[] };
        date_time_filter?: {
          created_at?: { start_at?: string; end_at?: string };
          updated_at?: { start_at?: string; end_at?: string };
          closed_at?: { start_at?: string; end_at?: string };
        };
        fulfillment_filter?: { fulfillment_types?: string[]; fulfillment_states?: string[] };
        source_filter?: { source_names?: string[] };
        customer_filter?: { customer_ids?: string[] };
      };
      sort?: {
        sort_field?: 'CREATED_AT' | 'UPDATED_AT' | 'CLOSED_AT';
        sort_order?: 'ASC' | 'DESC';
      };
    };
    limit?: number;
    return_entries?: boolean;
  }): Promise<OrdersSearchResponse> {
    return this.client.post<OrdersSearchResponse>('/v2/orders/search', query);
  }

  /**
   * Pay for an order
   */
  async payOrder(orderId: string, payment: {
    idempotency_key: string;
    order_version?: number;
    payment_ids?: string[];
  }): Promise<OrderResponse> {
    return this.client.post<OrderResponse>(`/v2/orders/${orderId}/pay`, payment);
  }

  // ============================================
  // Catalog API
  // ============================================

  /**
   * List catalog items
   */
  async listCatalog(options?: {
    cursor?: string;
    types?: string;
    catalog_version?: number;
  }): Promise<CatalogListResponse> {
    return this.client.get<CatalogListResponse>('/v2/catalog/list', options as Record<string, string>);
  }

  /**
   * Get a catalog object by ID
   */
  async getCatalogObject(objectId: string, options?: {
    include_related_objects?: boolean;
    catalog_version?: number;
  }): Promise<CatalogObjectResponse> {
    return this.client.get<CatalogObjectResponse>(`/v2/catalog/object/${objectId}`, options as Record<string, string>);
  }

  /**
   * Batch get catalog objects
   */
  async batchGetCatalogObjects(request: {
    object_ids: string[];
    include_related_objects?: boolean;
    catalog_version?: number;
  }): Promise<CatalogListResponse> {
    return this.client.post<CatalogListResponse>('/v2/catalog/batch-retrieve', request);
  }

  /**
   * Search catalog
   */
  async searchCatalog(query: {
    cursor?: string;
    object_types?: string[];
    include_deleted_objects?: boolean;
    include_related_objects?: boolean;
    begin_time?: string;
    query?: {
      exact_query?: { attribute_name: string; attribute_value: string };
      prefix_query?: { attribute_name: string; attribute_prefix: string };
      range_query?: { attribute_name: string; attribute_min_value?: number; attribute_max_value?: number };
      sorted_attribute_query?: { attribute_name: string; initial_attribute_value?: string; sort_order?: 'ASC' | 'DESC' };
      text_query?: { keywords: string[] };
      items_for_tax_query?: { tax_ids: string[] };
      items_for_modifier_list_query?: { modifier_list_ids: string[] };
      items_for_item_options_query?: { item_option_ids: string[] };
    };
    limit?: number;
  }): Promise<CatalogListResponse> {
    return this.client.post<CatalogListResponse>('/v2/catalog/search', query);
  }

  /**
   * Upsert catalog object
   */
  async upsertCatalogObject(request: {
    idempotency_key: string;
    object: {
      type: string;
      id: string;
      [key: string]: unknown;
    };
  }): Promise<CatalogObjectResponse> {
    return this.client.post<CatalogObjectResponse>('/v2/catalog/object', request);
  }

  /**
   * Delete catalog object
   */
  async deleteCatalogObject(objectId: string): Promise<{ deleted_object_ids?: string[]; deleted_at?: string }> {
    return this.client.delete<{ deleted_object_ids?: string[]; deleted_at?: string }>(`/v2/catalog/object/${objectId}`);
  }
}

export { SquareClient } from './client';
