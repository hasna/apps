// Recharge Connector — Subscription billing and recurring payments for e-commerce
import { RechargeClient } from './client';
import type { RechargeConfig, RechargeSubscription, RechargeSubscriptionList, RechargeCustomer, RechargeCustomerList, RechargeOrder, RechargeOrderList, RechargeAddress } from '../types';
export { RechargeClient } from './client';

export class Recharge {
  private readonly client: RechargeClient;
  constructor(config: RechargeConfig) { this.client = new RechargeClient(config); }
  static fromEnv(): Recharge {
    const token = process.env.RECHARGE_TOKEN;
    if (!token) throw new Error('RECHARGE_TOKEN is required');
    return new Recharge({ token });
  }

  async listSubscriptions(options?: { customer_id?: number; status?: string; page?: number }): Promise<RechargeSubscriptionList> {
    return this.client.request<RechargeSubscriptionList>('/subscriptions', { params: { customer_id: options?.customer_id, status: options?.status, page: options?.page } });
  }
  async getSubscription(subscriptionId: number): Promise<{ subscription: RechargeSubscription }> { return this.client.request(`/subscriptions/${subscriptionId}`); }
  async cancelSubscription(subscriptionId: number, reason?: string): Promise<{ subscription: RechargeSubscription }> {
    return this.client.request(`/subscriptions/${subscriptionId}/cancel`, { method: 'POST', body: { cancellation_reason: reason || 'other' } });
  }
  async activateSubscription(subscriptionId: number): Promise<{ subscription: RechargeSubscription }> {
    return this.client.request(`/subscriptions/${subscriptionId}/activate`, { method: 'POST' });
  }
  async skipCharge(subscriptionId: number, date: string): Promise<void> {
    await this.client.request(`/subscriptions/${subscriptionId}/set_next_charge_date`, { method: 'POST', body: { date } });
  }

  async listCustomers(options?: { email?: string; page?: number }): Promise<RechargeCustomerList> {
    return this.client.request<RechargeCustomerList>('/customers', { params: { email: options?.email, page: options?.page } });
  }
  async getCustomer(customerId: number): Promise<{ customer: RechargeCustomer }> { return this.client.request(`/customers/${customerId}`); }

  async listOrders(options?: { customer_id?: number; status?: string; page?: number }): Promise<RechargeOrderList> {
    return this.client.request<RechargeOrderList>('/orders', { params: { customer_id: options?.customer_id, status: options?.status, page: options?.page } });
  }
  async getOrder(orderId: number): Promise<{ order: RechargeOrder }> { return this.client.request(`/orders/${orderId}`); }

  async listAddresses(customerId: number): Promise<{ addresses: RechargeAddress[] }> {
    return this.client.request(`/customers/${customerId}/addresses`);
  }

  getClient(): RechargeClient { return this.client; }
}
