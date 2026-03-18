// Zoho Books Connector — Online accounting and financial management
import { ZohoBooksClient } from './client';
import type { ZohoBooksConfig, ZBInvoice, ZBContact, ZBItem, ZBExpense, ZBBankAccount } from '../types';
export { ZohoBooksClient } from './client';

export class ZohoBooks {
  private readonly client: ZohoBooksClient;
  constructor(config: ZohoBooksConfig) { this.client = new ZohoBooksClient(config); }
  static fromEnv(): ZohoBooks {
    const token = process.env.ZOHOBOOKS_TOKEN;
    const organizationId = process.env.ZOHOBOOKS_ORG_ID;
    if (!token || !organizationId) throw new Error('ZOHOBOOKS_TOKEN and ZOHOBOOKS_ORG_ID are required');
    return new ZohoBooks({ token, organizationId, baseUrl: process.env.ZOHOBOOKS_BASE_URL });
  }

  async listInvoices(options?: { page?: number; per_page?: number; status?: string }): Promise<{ invoices: ZBInvoice[] }> {
    return this.client.request('/invoices', { params: { page: options?.page, per_page: options?.per_page, status: options?.status } });
  }
  async getInvoice(invoiceId: string): Promise<{ invoice: ZBInvoice }> { return this.client.request(`/invoices/${invoiceId}`); }
  async createInvoice(data: { customer_id: string; line_items: { item_id?: string; name: string; rate: number; quantity: number }[]; date?: string; due_date?: string }): Promise<{ invoice: ZBInvoice }> {
    return this.client.request('/invoices', { method: 'POST', body: data as Record<string, unknown> });
  }
  async markInvoiceSent(invoiceId: string): Promise<void> { await this.client.request(`/invoices/${invoiceId}/status/sent`, { method: 'POST' }); }

  async listContacts(options?: { page?: number; contact_type?: string }): Promise<{ contacts: ZBContact[] }> {
    return this.client.request('/contacts', { params: { page: options?.page, contact_type: options?.contact_type } });
  }
  async getContact(contactId: string): Promise<{ contact: ZBContact }> { return this.client.request(`/contacts/${contactId}`); }
  async createContact(data: { contact_name: string; company_name?: string; email?: string; contact_type?: string }): Promise<{ contact: ZBContact }> {
    return this.client.request('/contacts', { method: 'POST', body: data as Record<string, unknown> });
  }

  async listItems(options?: { page?: number }): Promise<{ items: ZBItem[] }> { return this.client.request('/items', { params: { page: options?.page } }); }

  async listExpenses(options?: { page?: number; status?: string }): Promise<{ expenses: ZBExpense[] }> {
    return this.client.request('/expenses', { params: { page: options?.page, status: options?.status } });
  }
  async createExpense(data: { account_id: string; amount: number; date: string; description?: string; vendor_id?: string }): Promise<{ expense: ZBExpense }> {
    return this.client.request('/expenses', { method: 'POST', body: data as Record<string, unknown> });
  }

  async listBankAccounts(): Promise<{ bankaccounts: ZBBankAccount[] }> { return this.client.request('/bankaccounts'); }

  getClient(): ZohoBooksClient { return this.client; }
}
