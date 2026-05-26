import type { ConnectorClient } from './client';
import type {
  InvoiceItem,
  InvoiceItemCreateParams,
  InvoiceItemUpdateParams,
  InvoiceItemListOptions,
  StripeList,
  DeletedObject,
} from '../types';

/**
 * Stripe Invoice Items API
 * https://stripe.com/docs/api/invoiceitems
 */
export class InvoiceItemsApi {
  constructor(private readonly client: ConnectorClient) {}

  /**
   * Create an invoice item
   */
  async create(params: InvoiceItemCreateParams): Promise<InvoiceItem> {
    return this.client.post<InvoiceItem>('/invoiceitems', params);
  }

  /**
   * Retrieve an invoice item by ID
   */
  async get(id: string): Promise<InvoiceItem> {
    return this.client.get<InvoiceItem>(`/invoiceitems/${id}`);
  }

  /**
   * Update an invoice item
   */
  async update(id: string, params: InvoiceItemUpdateParams): Promise<InvoiceItem> {
    return this.client.post<InvoiceItem>(`/invoiceitems/${id}`, params);
  }

  /**
   * List all invoice items
   */
  async list(options?: InvoiceItemListOptions): Promise<StripeList<InvoiceItem>> {
    return this.client.get<StripeList<InvoiceItem>>('/invoiceitems', options as Record<string, string | number | boolean | undefined>);
  }

  /**
   * Delete an invoice item
   */
  async del(id: string): Promise<DeletedObject> {
    return this.client.delete<DeletedObject>(`/invoiceitems/${id}`);
  }
}
