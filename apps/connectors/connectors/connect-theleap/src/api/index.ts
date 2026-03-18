// The Leap Connector — Digital product creation and selling for creators
import { TheLeapClient } from './client';
import type { TheLeapConfig, TLProduct, TLOrder, TLCustomer } from '../types';
export { TheLeapClient } from './client';

export class TheLeap {
  private readonly client: TheLeapClient;
  constructor(config: TheLeapConfig) { this.client = new TheLeapClient(config); }
  static fromEnv(): TheLeap {
    const apiKey = process.env.THELEAP_API_KEY;
    if (!apiKey) throw new Error('THELEAP_API_KEY is required');
    return new TheLeap({ apiKey });
  }

  async listProducts(options?: { page?: number; status?: string }): Promise<TLProduct[]> {
    return this.client.request<TLProduct[]>('/products', { params: { page: options?.page, status: options?.status } });
  }
  async getProduct(productId: string): Promise<TLProduct> { return this.client.request<TLProduct>(`/products/${productId}`); }

  async listOrders(options?: { page?: number; product_id?: string }): Promise<TLOrder[]> {
    return this.client.request<TLOrder[]>('/orders', { params: { page: options?.page, product_id: options?.product_id } });
  }
  async getOrder(orderId: string): Promise<TLOrder> { return this.client.request<TLOrder>(`/orders/${orderId}`); }

  async listCustomers(options?: { page?: number }): Promise<TLCustomer[]> {
    return this.client.request<TLCustomer[]>('/customers', { params: { page: options?.page } });
  }
  async getCustomer(customerId: string): Promise<TLCustomer> { return this.client.request<TLCustomer>(`/customers/${customerId}`); }

  getClient(): TheLeapClient { return this.client; }
}
