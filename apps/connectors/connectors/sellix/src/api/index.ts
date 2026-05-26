// Sellix Connector — Digital products and subscription e-commerce
import { SellixClient } from './client';
import type { SellixConfig, SXProduct, SXOrder, SXCoupon, SXCategory, SXCustomer, SXFeedback } from '../types';
export { SellixClient } from './client';

export class Sellix {
  private readonly client: SellixClient;
  constructor(config: SellixConfig) { this.client = new SellixClient(config); }
  static fromEnv(): Sellix {
    const apiKey = process.env.SELLIX_API_KEY;
    if (!apiKey) throw new Error('SELLIX_API_KEY is required');
    return new Sellix({ apiKey });
  }

  async listProducts(options?: { page?: number }): Promise<SXProduct[]> { return this.client.request<SXProduct[]>('/products', { params: { page: options?.page } }); }
  async getProduct(productId: string): Promise<SXProduct> { return this.client.request<SXProduct>(`/products/${productId}`); }
  async createProduct(data: { title: string; description?: string; price: number; currency?: string; type?: string; stock?: number }): Promise<SXProduct> {
    return this.client.request<SXProduct>('/products', { method: 'POST', body: data as Record<string, unknown> });
  }
  async updateProduct(productId: string, data: { title?: string; price?: number; stock?: number }): Promise<SXProduct> {
    return this.client.request<SXProduct>(`/products/${productId}`, { method: 'PUT', body: data as Record<string, unknown> });
  }
  async deleteProduct(productId: string): Promise<void> { await this.client.request(`/products/${productId}`, { method: 'DELETE' }); }

  async listOrders(options?: { page?: number }): Promise<SXOrder[]> { return this.client.request<SXOrder[]>('/orders', { params: { page: options?.page } }); }
  async getOrder(orderId: string): Promise<SXOrder> { return this.client.request<SXOrder>(`/orders/${orderId}`); }

  async listCoupons(): Promise<SXCoupon[]> { return this.client.request<SXCoupon[]>('/coupons'); }
  async createCoupon(data: { code: string; discount: number; discount_type: 'PERCENTAGE' | 'FIXED'; max_uses?: number }): Promise<SXCoupon> {
    return this.client.request<SXCoupon>('/coupons', { method: 'POST', body: data as Record<string, unknown> });
  }

  async listCategories(): Promise<SXCategory[]> { return this.client.request<SXCategory[]>('/categories'); }
  async listCustomers(): Promise<SXCustomer[]> { return this.client.request<SXCustomer[]>('/customers'); }
  async listFeedback(): Promise<SXFeedback[]> { return this.client.request<SXFeedback[]>('/feedback'); }
  async replyToFeedback(feedbackId: string, reply: string): Promise<void> {
    await this.client.request(`/feedback/reply/${feedbackId}`, { method: 'POST', body: { reply } });
  }

  getClient(): SellixClient { return this.client; }
}
