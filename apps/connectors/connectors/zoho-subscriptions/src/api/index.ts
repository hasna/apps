// Zoho Subscriptions Connector — Billing and subscription management
import { ZohoSubscriptionsClient } from './client';
import type {
  ZohoSubscriptionsConfig,
  ZSCustomer,
  ZSSubscription,
  ZSPlan,
  ZSInvoice,
  ZSWebhook,
  ZSOrganization,
} from '../types';

export { ZohoSubscriptionsClient, DC_BASES, resolveBaseUrl } from './client';

export class ZohoSubscriptions {
  private readonly client: ZohoSubscriptionsClient;

  constructor(config: ZohoSubscriptionsConfig) {
    this.client = new ZohoSubscriptionsClient(config);
  }

  static fromEnv(): ZohoSubscriptions {
    const token = process.env.ZOHO_SUBSCRIPTIONS_TOKEN;
    const organizationId = process.env.ZOHO_SUBSCRIPTIONS_ORG_ID;
    if (!token || !organizationId) {
      throw new Error('ZOHO_SUBSCRIPTIONS_TOKEN and ZOHO_SUBSCRIPTIONS_ORG_ID are required');
    }
    return new ZohoSubscriptions({
      token,
      organizationId,
      dataCenter: process.env.ZOHO_SUBSCRIPTIONS_DATA_CENTER,
      baseUrl: process.env.ZOHO_SUBSCRIPTIONS_BASE_URL,
    });
  }

  async listCustomers(options?: {
    page?: number;
    per_page?: number;
    sort_column?: string;
    status?: 'active' | 'inactive' | 'non_subscribed' | 'portal_enabled' | 'portal_disabled';
    filter_by?: string;
  }): Promise<{ customers: ZSCustomer[] }> {
    return this.client.request('/customers', {
      params: {
        page: options?.page,
        per_page: options?.per_page,
        sort_column: options?.sort_column,
        status: options?.status,
        filter_by: options?.filter_by,
      },
    });
  }

  async getCustomer(id: string): Promise<{ customer: ZSCustomer }> {
    return this.client.request(`/customers/${encodeURIComponent(id)}`);
  }

  async createCustomer(data: Record<string, unknown>): Promise<{ customer: ZSCustomer }> {
    return this.client.request('/customers', { method: 'POST', body: data });
  }

  async updateCustomer(id: string, data: Record<string, unknown>): Promise<{ customer: ZSCustomer }> {
    return this.client.request(`/customers/${encodeURIComponent(id)}`, { method: 'PUT', body: data });
  }

  async deleteCustomer(id: string): Promise<void> {
    await this.client.request(`/customers/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  async listSubscriptions(options?: {
    page?: number;
    per_page?: number;
    status?: string;
    customer_id?: string;
    plan_code?: string;
  }): Promise<{ subscriptions: ZSSubscription[] }> {
    return this.client.request('/subscriptions', {
      params: {
        page: options?.page,
        per_page: options?.per_page,
        status: options?.status,
        customer_id: options?.customer_id,
        plan_code: options?.plan_code,
      },
    });
  }

  async getSubscription(id: string): Promise<{ subscription: ZSSubscription }> {
    return this.client.request(`/subscriptions/${encodeURIComponent(id)}`);
  }

  async createSubscription(data: Record<string, unknown>): Promise<{ subscription: ZSSubscription }> {
    return this.client.request('/subscriptions', { method: 'POST', body: data });
  }

  async updateSubscription(id: string, data: Record<string, unknown>): Promise<{ subscription: ZSSubscription }> {
    return this.client.request(`/subscriptions/${encodeURIComponent(id)}`, { method: 'PUT', body: data });
  }

  async cancelSubscription(id: string, cancelAtEnd?: boolean): Promise<{ subscription: ZSSubscription }> {
    return this.client.request(`/subscriptions/${encodeURIComponent(id)}/cancel`, {
      method: 'POST',
      params: { cancel_at_end: cancelAtEnd },
    });
  }

  async reactivateSubscription(id: string): Promise<{ subscription: ZSSubscription }> {
    return this.client.request(`/subscriptions/${encodeURIComponent(id)}/reactivate`, { method: 'POST' });
  }

  async postponeRenewal(id: string, renewalAt: string): Promise<{ subscription: ZSSubscription }> {
    return this.client.request(`/subscriptions/${encodeURIComponent(id)}/postpone`, {
      method: 'POST',
      body: { renewal_at: renewalAt },
    });
  }

  async addOneTimeCharge(
    id: string,
    data: { amount: number; description: string; tax_id?: string },
  ): Promise<Record<string, unknown>> {
    return this.client.request(`/subscriptions/${encodeURIComponent(id)}/charge`, { method: 'POST', body: data });
  }

  async listSubscriptionInvoices(id: string): Promise<{ invoices: ZSInvoice[] }> {
    return this.client.request(`/subscriptions/${encodeURIComponent(id)}/invoices`);
  }

  async createHostedPage(data: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.client.request('/hostedpages/newsubscription', { method: 'POST', body: data });
  }

  async listPlans(options?: {
    page?: number;
    per_page?: number;
    product_id?: string;
    status?: 'active' | 'inactive';
  }): Promise<{ plans: ZSPlan[] }> {
    return this.client.request('/plans', {
      params: {
        page: options?.page,
        per_page: options?.per_page,
        product_id: options?.product_id,
        status: options?.status,
      },
    });
  }

  async getPlan(code: string): Promise<{ plan: ZSPlan }> {
    return this.client.request(`/plans/${encodeURIComponent(code)}`);
  }

  async createPlan(data: Record<string, unknown>): Promise<{ plan: ZSPlan }> {
    return this.client.request('/plans', { method: 'POST', body: data });
  }

  async listAddons(options?: { page?: number; per_page?: number; product_id?: string }): Promise<{ addons: Record<string, unknown>[] }> {
    return this.client.request('/addons', {
      params: { page: options?.page, per_page: options?.per_page, product_id: options?.product_id },
    });
  }

  async listCoupons(options?: {
    page?: number;
    per_page?: number;
    status?: 'active' | 'expired';
  }): Promise<{ coupons: Record<string, unknown>[] }> {
    return this.client.request('/coupons', {
      params: { page: options?.page, per_page: options?.per_page, status: options?.status },
    });
  }

  async createCoupon(data: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.client.request('/coupons', { method: 'POST', body: data });
  }

  async listInvoices(options?: {
    page?: number;
    per_page?: number;
    customer_id?: string;
    status?: string;
  }): Promise<{ invoices: ZSInvoice[] }> {
    return this.client.request('/invoices', {
      params: {
        page: options?.page,
        per_page: options?.per_page,
        customer_id: options?.customer_id,
        status: options?.status,
      },
    });
  }

  async getInvoice(id: string): Promise<{ invoice: ZSInvoice }> {
    return this.client.request(`/invoices/${encodeURIComponent(id)}`);
  }

  async recordInvoicePayment(
    id: string,
    data: { amount: number; payment_mode?: string; date?: string; description?: string; reference_number?: string },
  ): Promise<Record<string, unknown>> {
    return this.client.request(`/invoices/${encodeURIComponent(id)}/payments`, { method: 'POST', body: data });
  }

  async listCards(customerId: string): Promise<{ cards: Record<string, unknown>[] }> {
    return this.client.request(`/customers/${encodeURIComponent(customerId)}/cards`);
  }

  async deleteCard(customerId: string, cardId: string): Promise<void> {
    await this.client.request(
      `/customers/${encodeURIComponent(customerId)}/cards/${encodeURIComponent(cardId)}`,
      { method: 'DELETE' },
    );
  }

  async listProducts(options?: { page?: number; per_page?: number }): Promise<{ products: Record<string, unknown>[] }> {
    return this.client.request('/products', { params: { page: options?.page, per_page: options?.per_page } });
  }

  async listEvents(options?: {
    page?: number;
    per_page?: number;
    event_type?: string;
    subscription_id?: string;
  }): Promise<{ events: Record<string, unknown>[] }> {
    return this.client.request('/events', {
      params: {
        page: options?.page,
        per_page: options?.per_page,
        event_type: options?.event_type,
        subscription_id: options?.subscription_id,
      },
    });
  }

  async listWebhooks(): Promise<{ webhooks: ZSWebhook[] }> {
    return this.client.request('/webhooks');
  }

  async createWebhook(data: Record<string, unknown>): Promise<{ webhook: ZSWebhook }> {
    return this.client.request('/webhooks', { method: 'POST', body: data });
  }

  async deleteWebhook(id: string): Promise<void> {
    await this.client.request(`/webhooks/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  async getOrganization(): Promise<{ organization: ZSOrganization }> {
    return this.client.request('/organizations');
  }

  getClient(): ZohoSubscriptionsClient {
    return this.client;
  }
}

/** Alias for CLI compatibility */
export { ZohoSubscriptions as Connector };
