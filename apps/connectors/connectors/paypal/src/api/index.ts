import type {
  PayPalConfig,
  Order,
  CreateOrderOptions,
  Capture,
  Refund,
  Invoice,
  InvoiceListResponse,
  CreateInvoiceOptions,
  PayoutBatch,
  CreatePayoutOptions,
  PayoutItem,
} from '../types';
import { PayPalClient } from './client';

/**
 * PayPal API Client
 * Payments, orders, and invoicing API
 */
export class PayPal {
  private readonly client: PayPalClient;

  constructor(config: PayPalConfig) {
    this.client = new PayPalClient(config);
  }

  /**
   * Create a client from environment variables
   */
  static fromEnv(): PayPal {
    const clientId = process.env.PAYPAL_CLIENT_ID;
    const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
    const baseUrl = process.env.PAYPAL_BASE_URL;

    if (!clientId) {
      throw new Error('PAYPAL_CLIENT_ID environment variable is required');
    }
    if (!clientSecret) {
      throw new Error('PAYPAL_CLIENT_SECRET environment variable is required');
    }
    return new PayPal({ clientId, clientSecret, baseUrl });
  }

  // ============================================
  // Order Methods
  // ============================================

  /**
   * Create an order
   */
  async createOrder(options: CreateOrderOptions): Promise<Order> {
    return this.client.post<Order>('/v2/checkout/orders', options);
  }

  /**
   * Get order details
   */
  async getOrder(orderId: string): Promise<Order> {
    return this.client.get<Order>(`/v2/checkout/orders/${orderId}`);
  }

  /**
   * Capture payment for an order
   */
  async captureOrder(orderId: string): Promise<Order> {
    return this.client.post<Order>(`/v2/checkout/orders/${orderId}/capture`);
  }

  /**
   * Authorize payment for an order
   */
  async authorizeOrder(orderId: string): Promise<Order> {
    return this.client.post<Order>(`/v2/checkout/orders/${orderId}/authorize`);
  }

  // ============================================
  // Payment Methods
  // ============================================

  /**
   * Get capture details
   */
  async getCapture(captureId: string): Promise<Capture> {
    return this.client.get<Capture>(`/v2/payments/captures/${captureId}`);
  }

  /**
   * Refund a captured payment
   */
  async refundCapture(captureId: string, options?: {
    amount?: { currency_code: string; value: string };
    invoice_id?: string;
    note_to_payer?: string;
  }): Promise<Refund> {
    return this.client.post<Refund>(`/v2/payments/captures/${captureId}/refund`, options || {});
  }

  /**
   * Get refund details
   */
  async getRefund(refundId: string): Promise<Refund> {
    return this.client.get<Refund>(`/v2/payments/refunds/${refundId}`);
  }

  // ============================================
  // Invoice Methods
  // ============================================

  /**
   * List invoices
   */
  async listInvoices(options?: {
    page?: number;
    page_size?: number;
    total_required?: boolean;
  }): Promise<InvoiceListResponse> {
    return this.client.get<InvoiceListResponse>('/v2/invoicing/invoices', options);
  }

  /**
   * Create a draft invoice
   */
  async createInvoice(options: CreateInvoiceOptions): Promise<Invoice> {
    return this.client.post<Invoice>('/v2/invoicing/invoices', options);
  }

  /**
   * Get invoice details
   */
  async getInvoice(invoiceId: string): Promise<Invoice> {
    return this.client.get<Invoice>(`/v2/invoicing/invoices/${invoiceId}`);
  }

  /**
   * Send an invoice
   */
  async sendInvoice(invoiceId: string, options?: {
    subject?: string;
    note?: string;
    send_to_invoicer?: boolean;
    send_to_recipient?: boolean;
    additional_recipients?: string[];
  }): Promise<void> {
    await this.client.post(`/v2/invoicing/invoices/${invoiceId}/send`, options || {});
  }

  /**
   * Cancel a sent invoice
   */
  async cancelInvoice(invoiceId: string, options?: {
    subject?: string;
    note?: string;
    send_to_invoicer?: boolean;
    send_to_recipient?: boolean;
  }): Promise<void> {
    await this.client.post(`/v2/invoicing/invoices/${invoiceId}/cancel`, options || {});
  }

  /**
   * Delete a draft invoice
   */
  async deleteInvoice(invoiceId: string): Promise<void> {
    await this.client.delete(`/v2/invoicing/invoices/${invoiceId}`);
  }

  /**
   * Generate invoice number
   */
  async generateInvoiceNumber(): Promise<{ invoice_number: string }> {
    return this.client.post<{ invoice_number: string }>('/v2/invoicing/generate-next-invoice-number');
  }

  // ============================================
  // Payout Methods
  // ============================================

  /**
   * Create a payout batch
   */
  async createPayout(options: CreatePayoutOptions): Promise<PayoutBatch> {
    return this.client.post<PayoutBatch>('/v1/payments/payouts', options);
  }

  /**
   * Get payout batch details
   */
  async getPayoutBatch(payoutBatchId: string, options?: {
    page?: number;
    page_size?: number;
    total_required?: boolean;
  }): Promise<PayoutBatch> {
    return this.client.get<PayoutBatch>(`/v1/payments/payouts/${payoutBatchId}`, options);
  }

  /**
   * Get payout item details
   */
  async getPayoutItem(payoutItemId: string): Promise<PayoutItem> {
    return this.client.get<PayoutItem>(`/v1/payments/payouts-item/${payoutItemId}`);
  }

  /**
   * Cancel unclaimed payout item
   */
  async cancelPayoutItem(payoutItemId: string): Promise<PayoutItem> {
    return this.client.post<PayoutItem>(`/v1/payments/payouts-item/${payoutItemId}/cancel`);
  }

  // ============================================
  // Utility Methods
  // ============================================

  /**
   * Get a preview of the client ID
   */
  getClientIdPreview(): string {
    return this.client.getClientIdPreview();
  }

  /**
   * Check if using sandbox environment
   */
  isSandbox(): boolean {
    return this.client.isSandbox();
  }

  /**
   * Get the underlying client for direct API access
   */
  getClient(): PayPalClient {
    return this.client;
  }
}

export { PayPalClient } from './client';
