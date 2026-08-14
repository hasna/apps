import type { ConnectorClient } from './client';
import type {
  Invoice,
  InvoiceCreateParams,
  InvoiceUpdateParams,
  InvoiceFinalizeParams,
  InvoicePayParams,
  InvoiceListOptions,
  StripeList,
  StripeSearchResult,
  DeletedObject,
} from '../types';

/**
 * Stripe Invoices API
 * https://stripe.com/docs/api/invoices
 */
export class InvoicesApi {
  constructor(private readonly client: ConnectorClient) {}

  /**
   * Create an invoice
   */
  async create(params?: InvoiceCreateParams): Promise<Invoice> {
    return this.client.post<Invoice>('/invoices', params || {});
  }

  /**
   * Retrieve an invoice by ID
   */
  async get(id: string): Promise<Invoice> {
    return this.client.get<Invoice>(`/invoices/${id}`);
  }

  /**
   * Update an invoice
   */
  async update(id: string, params: InvoiceUpdateParams): Promise<Invoice> {
    return this.client.post<Invoice>(`/invoices/${id}`, params);
  }

  /**
   * List all invoices
   */
  async list(options?: InvoiceListOptions): Promise<StripeList<Invoice>> {
    return this.client.get<StripeList<Invoice>>('/invoices', options as Record<string, string | number | boolean | undefined>);
  }

  /**
   * Delete a draft invoice
   */
  async del(id: string): Promise<DeletedObject> {
    return this.client.delete<DeletedObject>(`/invoices/${id}`);
  }

  /**
   * Finalize an invoice
   */
  async finalize(id: string, params?: InvoiceFinalizeParams): Promise<Invoice> {
    return this.client.post<Invoice>(`/invoices/${id}/finalize`, params || {});
  }

  /**
   * Pay an invoice
   */
  async pay(id: string, params?: InvoicePayParams): Promise<Invoice> {
    return this.client.post<Invoice>(`/invoices/${id}/pay`, params || {});
  }

  /**
   * Send an invoice for manual payment
   */
  async send(id: string): Promise<Invoice> {
    return this.client.post<Invoice>(`/invoices/${id}/send`, {});
  }

  /**
   * Void an invoice
   */
  async void(id: string): Promise<Invoice> {
    return this.client.post<Invoice>(`/invoices/${id}/void`, {});
  }

  /**
   * Mark an invoice as uncollectible
   */
  async markUncollectible(id: string): Promise<Invoice> {
    return this.client.post<Invoice>(`/invoices/${id}/mark_uncollectible`, {});
  }

  /**
   * Search invoices
   * Query syntax: https://stripe.com/docs/search#query-fields-for-invoices
   */
  async search(query: string, options?: { limit?: number; page?: string }): Promise<StripeSearchResult<Invoice>> {
    return this.client.get<StripeSearchResult<Invoice>>('/invoices/search', {
      query,
      limit: options?.limit,
      page: options?.page,
    });
  }
}
