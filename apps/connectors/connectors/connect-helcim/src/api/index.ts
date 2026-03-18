// Helcim Connector — Payment processing and merchant services
import { HelcimClient } from './client';
import type { HelcimConfig, HelcimTransaction, HelcimCustomer, HelcimInvoice } from '../types';
export { HelcimClient } from './client';

export class Helcim {
  private readonly client: HelcimClient;
  constructor(config: HelcimConfig) { this.client = new HelcimClient(config); }
  static fromEnv(): Helcim {
    const apiToken = process.env.HELCIM_API_TOKEN;
    if (!apiToken) throw new Error('HELCIM_API_TOKEN environment variable is required');
    return new Helcim({ apiToken });
  }

  // Transactions
  async listTransactions(options?: { customerId?: number; invoiceNumber?: string; dateFrom?: string; dateTo?: string; page?: number; pageSize?: number }): Promise<HelcimTransaction[]> {
    const r = await this.client.request<{ transactions: HelcimTransaction[] }>('/payment/transactions', { params: options as Record<string, string | number | undefined> });
    return r.transactions ?? [];
  }
  async getTransaction(id: number): Promise<HelcimTransaction> { return this.client.request<HelcimTransaction>(`/payment/transactions/${id}`); }

  // Customers
  async listCustomers(options?: { search?: string; page?: number; pageSize?: number }): Promise<HelcimCustomer[]> {
    const r = await this.client.request<{ customers: HelcimCustomer[] }>('/customers', { params: options as Record<string, string | number | undefined> });
    return r.customers ?? [];
  }
  async getCustomer(id: number): Promise<HelcimCustomer> { return this.client.request<HelcimCustomer>(`/customers/${id}`); }
  async createCustomer(data: { contactName: string; businessName?: string; email?: string; phone?: string }): Promise<HelcimCustomer> {
    return this.client.request<HelcimCustomer>('/customers', { method: 'POST', body: data as Record<string, unknown> });
  }
  async updateCustomer(id: number, data: Partial<Parameters<Helcim['createCustomer']>[0]>): Promise<HelcimCustomer> {
    return this.client.request<HelcimCustomer>(`/customers/${id}`, { method: 'PUT', body: data as Record<string, unknown> });
  }

  // Invoices
  async listInvoices(options?: { customerId?: number; status?: string; page?: number; pageSize?: number }): Promise<HelcimInvoice[]> {
    const r = await this.client.request<{ invoices: HelcimInvoice[] }>('/invoices', { params: options as Record<string, string | number | undefined> });
    return r.invoices ?? [];
  }
  async getInvoice(id: number): Promise<HelcimInvoice> { return this.client.request<HelcimInvoice>(`/invoices/${id}`); }
  async createInvoice(data: { customerId?: number; currency?: string; notes?: string; lineItems?: Array<{ description: string; quantity: number; price: number }> }): Promise<HelcimInvoice> {
    return this.client.request<HelcimInvoice>('/invoices', { method: 'POST', body: data as Record<string, unknown> });
  }

  getClient(): HelcimClient { return this.client; }
}
