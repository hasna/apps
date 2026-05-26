import type { MercuryClient } from './client';
import type {
  Invoice,
  InvoiceListResponse,
  InvoiceCreateParams,
  InvoiceListParams,
  InvoiceStatus,
} from '../types';

/**
 * Mercury Invoices API
 * Create and manage invoices
 */
export class InvoicesApi {
  constructor(private readonly client: MercuryClient) {}

  /**
   * List invoices
   */
  async list(params?: InvoiceListParams): Promise<InvoiceListResponse> {
    return this.client.get<InvoiceListResponse>('/ar/invoices', {
      limit: params?.limit,
      offset: params?.offset,
      status: params?.status,
      customerId: params?.customerId,
    });
  }

  /**
   * Get a single invoice
   */
  async get(invoiceId: string): Promise<Invoice> {
    return this.client.get<Invoice>(`/ar/invoices/${invoiceId}`);
  }

  /**
   * Create a new invoice
   */
  async create(params: InvoiceCreateParams): Promise<Invoice> {
    return this.client.post<Invoice>('/ar/invoices', params);
  }

  /**
   * Update an invoice
   */
  async update(invoiceId: string, params: Partial<InvoiceCreateParams>): Promise<Invoice> {
    return this.client.patch<Invoice>(`/ar/invoices/${invoiceId}`, params);
  }

  /**
   * Send an invoice to the customer
   */
  async send(invoiceId: string): Promise<Invoice> {
    return this.client.post<Invoice>(`/ar/invoices/${invoiceId}/send`);
  }

  /**
   * Mark an invoice as paid
   */
  async markPaid(invoiceId: string, paidAt?: string): Promise<Invoice> {
    return this.client.post<Invoice>(`/ar/invoices/${invoiceId}/mark-paid`, {
      paidAt: paidAt || new Date().toISOString(),
    });
  }

  /**
   * Cancel an invoice
   */
  async cancel(invoiceId: string): Promise<Invoice> {
    return this.client.post<Invoice>(`/ar/invoices/${invoiceId}/cancel`);
  }

  /**
   * Void an invoice
   */
  async void(invoiceId: string): Promise<Invoice> {
    return this.client.post<Invoice>(`/ar/invoices/${invoiceId}/void`);
  }

  /**
   * Delete a draft invoice
   */
  async delete(invoiceId: string): Promise<void> {
    await this.client.delete(`/ar/invoices/${invoiceId}`);
  }

  /**
   * Get invoice PDF download URL
   */
  async getDownloadUrl(invoiceId: string): Promise<{ url: string }> {
    return this.client.get<{ url: string }>(`/ar/invoices/${invoiceId}/download`);
  }

  /**
   * List attachments for an invoice
   */
  async listAttachments(invoiceId: string): Promise<{ attachments: Array<{ id: string; fileName: string; fileType: string; downloadUrl: string }> }> {
    return this.client.get<{ attachments: Array<{ id: string; fileName: string; fileType: string; downloadUrl: string }> }>(
      `/ar/invoices/${invoiceId}/attachments`
    );
  }
}
