// Invoiced Connector — Accounts receivable and invoicing
import { InvoicedClient } from './client';
import type { InvoicedConfig, InvoicedCustomer, InvoicedInvoice, InvoicedPayment } from '../types';
export { InvoicedClient } from './client';
export class Invoiced {
  private readonly client: InvoicedClient;
  constructor(config: InvoicedConfig) { this.client = new InvoicedClient(config); }
  static fromEnv(): Invoiced {
    const apiKey = process.env.INVOICED_API_KEY;
    if (!apiKey) throw new Error('INVOICED_API_KEY environment variable is required');
    return new Invoiced({ apiKey, sandbox: process.env.INVOICED_SANDBOX === 'true' });
  }
  async listCustomers(options?: { page?: number; perPage?: number }): Promise<InvoicedCustomer[]> { return this.client.request<InvoicedCustomer[]>('/customers', { params: { page: options?.page, per_page: options?.perPage } }); }
  async getCustomer(customerId: number): Promise<InvoicedCustomer> { return this.client.request<InvoicedCustomer>(`/customers/${customerId}`); }
  async createCustomer(data: { name: string; email?: string; number?: string; phone?: string }): Promise<InvoicedCustomer> { return this.client.request<InvoicedCustomer>('/customers', { method: 'POST', body: data as Record<string, unknown> }); }
  async listInvoices(options?: { page?: number; perPage?: number; status?: string; customer?: number }): Promise<InvoicedInvoice[]> { return this.client.request<InvoicedInvoice[]>('/invoices', { params: options as Record<string, string | number | undefined> }); }
  async getInvoice(invoiceId: number): Promise<InvoicedInvoice> { return this.client.request<InvoicedInvoice>(`/invoices/${invoiceId}`); }
  async createInvoice(data: { customer: number; date?: number; due_date?: number; draft?: boolean; lines?: Array<{ name: string; unit_cost: number; quantity?: number }> }): Promise<InvoicedInvoice> { return this.client.request<InvoicedInvoice>('/invoices', { method: 'POST', body: data as Record<string, unknown> }); }
  async sendInvoice(invoiceId: number): Promise<void> { await this.client.request(`/invoices/${invoiceId}/emails`, { method: 'POST', body: {} }); }
  async voidInvoice(invoiceId: number): Promise<InvoicedInvoice> { return this.client.request<InvoicedInvoice>(`/invoices/${invoiceId}`, { method: 'DELETE' }); }
  async listPayments(options?: { page?: number; perPage?: number; customer?: number }): Promise<InvoicedPayment[]> { return this.client.request<InvoicedPayment[]>('/payments', { params: options as Record<string, number | undefined> }); }
  async createPayment(data: { customer: number; amount: number; method?: string; date?: number; applied_to?: Array<{ type: string; invoice: number; amount: number }> }): Promise<InvoicedPayment> { return this.client.request<InvoicedPayment>('/payments', { method: 'POST', body: data as Record<string, unknown> }); }
  getClient(): InvoicedClient { return this.client; }
}
