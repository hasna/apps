// Ecwid Connector — E-commerce platform for online store management
import { EcwidClient } from './client';
import type { EcwidConfig, EcwidProduct, EcwidProductList, EcwidOrder, EcwidOrderList, EcwidCategory, EcwidCustomer } from '../types';
export { EcwidClient } from './client';

export class Ecwid {
  private readonly client: EcwidClient;
  constructor(config: EcwidConfig) { this.client = new EcwidClient(config); }
  static fromEnv(): Ecwid {
    const storeId = process.env.ECWID_STORE_ID;
    const token = process.env.ECWID_TOKEN;
    if (!storeId || !token) throw new Error('ECWID_STORE_ID and ECWID_TOKEN are required');
    return new Ecwid({ storeId, token });
  }

  async listProducts(options?: { offset?: number; limit?: number; keyword?: string; category?: number; enabled?: boolean }): Promise<EcwidProductList> {
    return this.client.request<EcwidProductList>('/products', { params: { offset: options?.offset, limit: options?.limit, keyword: options?.keyword, category: options?.category, enabled: options?.enabled === true ? 'true' : options?.enabled === false ? 'false' : undefined } });
  }
  async getProduct(productId: number): Promise<EcwidProduct> { return this.client.request<EcwidProduct>(`/products/${productId}`); }
  async createProduct(data: { name: string; price: number; sku?: string; description?: string; categoryIds?: number[]; weight?: number; quantity?: number }): Promise<{ id: number }> {
    return this.client.request('/products', { method: 'POST', body: data as Record<string, unknown> });
  }
  async updateProduct(productId: number, data: { name?: string; price?: number; sku?: string; enabled?: boolean; quantity?: number }): Promise<{ updateCount: number }> {
    return this.client.request(`/products/${productId}`, { method: 'PUT', body: data as Record<string, unknown> });
  }
  async deleteProduct(productId: number): Promise<void> { await this.client.request(`/products/${productId}`, { method: 'DELETE' }); }

  async listOrders(options?: { offset?: number; limit?: number; paymentStatus?: string; fulfillmentStatus?: string }): Promise<EcwidOrderList> {
    return this.client.request<EcwidOrderList>('/orders', { params: { offset: options?.offset, limit: options?.limit, paymentStatus: options?.paymentStatus, fulfillmentStatus: options?.fulfillmentStatus } });
  }
  async getOrder(orderId: number): Promise<EcwidOrder> { return this.client.request<EcwidOrder>(`/orders/${orderId}`); }
  async updateOrder(orderId: number, data: { paymentStatus?: string; fulfillmentStatus?: string }): Promise<{ updateCount: number }> {
    return this.client.request(`/orders/${orderId}`, { method: 'PUT', body: data as Record<string, unknown> });
  }

  async listCategories(options?: { parent?: number }): Promise<{ items: EcwidCategory[] }> {
    return this.client.request('/categories', { params: { parent: options?.parent } });
  }

  async listCustomers(options?: { offset?: number; limit?: number; keyword?: string }): Promise<{ items: EcwidCustomer[] }> {
    return this.client.request('/customers', { params: { offset: options?.offset, limit: options?.limit, keyword: options?.keyword } });
  }

  getClient(): EcwidClient { return this.client; }
}
