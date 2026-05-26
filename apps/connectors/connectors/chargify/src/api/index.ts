// Chargify Connector — Subscription billing and revenue management
import { ChargifyClient } from './client';
import type { ChargifyConfig, CFSubscription, CFCustomer, CFProduct, CFInvoice } from '../types';
export { ChargifyClient } from './client';

export class Chargify {
  private readonly client: ChargifyClient;
  constructor(config: ChargifyConfig) { this.client = new ChargifyClient(config); }

  static fromEnv(): Chargify {
    const apiKey = process.env.CHARGIFY_API_KEY;
    const subdomain = process.env.CHARGIFY_SUBDOMAIN;
    if (!apiKey || !subdomain) throw new Error('CHARGIFY_API_KEY and CHARGIFY_SUBDOMAIN are required');
    return new Chargify({ apiKey, subdomain });
  }

  // Subscriptions
  async listSubscriptions(options?: { page?: number; perPage?: number; state?: string }): Promise<CFSubscription[]> {
    const r = await this.client.request<Array<{ subscription: CFSubscription }>>('/subscriptions.json', { params: { page: options?.page, per_page: options?.perPage, state: options?.state } });
    return r.map(s => s.subscription);
  }
  async getSubscription(id: number): Promise<CFSubscription> {
    const r = await this.client.request<{ subscription: CFSubscription }>(`/subscriptions/${id}.json`); return r.subscription;
  }
  async cancelSubscription(id: number, options?: { message?: string; reasonCode?: string }): Promise<CFSubscription> {
    const r = await this.client.request<{ subscription: CFSubscription }>(`/subscriptions/${id}.json`, { method: 'DELETE', body: { subscription: { cancellation_message: options?.message, cancellation_method: 'merchant' } } });
    return r.subscription;
  }
  async reactivateSubscription(id: number): Promise<CFSubscription> {
    const r = await this.client.request<{ subscription: CFSubscription }>(`/subscriptions/${id}/reactivate.json`, { method: 'PUT' }); return r.subscription;
  }

  // Customers
  async listCustomers(options?: { page?: number; perPage?: number; q?: string }): Promise<CFCustomer[]> {
    const r = await this.client.request<Array<{ customer: CFCustomer }>>('/customers.json', { params: options as Record<string, string | number | undefined> });
    return r.map(c => c.customer);
  }
  async getCustomer(id: number): Promise<CFCustomer> {
    const r = await this.client.request<{ customer: CFCustomer }>(`/customers/${id}.json`); return r.customer;
  }
  async createCustomer(data: { first_name: string; last_name: string; email: string; phone?: string; organization?: string }): Promise<CFCustomer> {
    const r = await this.client.request<{ customer: CFCustomer }>('/customers.json', { method: 'POST', body: { customer: data } }); return r.customer;
  }

  // Products
  async listProducts(productFamilyId?: number): Promise<CFProduct[]> {
    const path = productFamilyId ? `/product_families/${productFamilyId}/products.json` : '/products.json';
    const r = await this.client.request<Array<{ product: CFProduct }>>(path);
    return r.map(p => p.product);
  }

  // Invoices
  async listInvoices(options?: { subscriptionId?: number; status?: string; page?: number }): Promise<{ invoices: CFInvoice[] }> {
    return this.client.request('/invoices.json', { params: { subscription_id: options?.subscriptionId, status: options?.status, page: options?.page } });
  }

  getClient(): ChargifyClient { return this.client; }
}
