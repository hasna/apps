// SwagUp Connector — Corporate swag and branded merchandise management
import { SwagUpClient } from './client';
import type { SwagUpConfig, SUProduct, SUOrder, SUPack, SURecipient, SUAddress } from '../types';
export { SwagUpClient } from './client';

export class SwagUp {
  private readonly client: SwagUpClient;
  constructor(config: SwagUpConfig) { this.client = new SwagUpClient(config); }
  static fromEnv(): SwagUp {
    const apiKey = process.env.SWAGUP_API_KEY;
    if (!apiKey) throw new Error('SWAGUP_API_KEY is required');
    return new SwagUp({ apiKey });
  }

  async listProducts(options?: { category?: string; page?: number }): Promise<{ results: SUProduct[] }> {
    return this.client.request('/products', { params: { category: options?.category, page: options?.page } });
  }
  async getProduct(productId: number): Promise<SUProduct> { return this.client.request<SUProduct>(`/products/${productId}`); }

  async listPacks(): Promise<{ results: SUPack[] }> { return this.client.request('/packs'); }
  async getPack(packId: number): Promise<SUPack> { return this.client.request<SUPack>(`/packs/${packId}`); }

  async createOrder(data: { pack_id?: number; items?: { product_id: number; quantity: number; size?: string; color?: string }[]; shipping_address: SUAddress }): Promise<SUOrder> {
    return this.client.request<SUOrder>('/orders', { method: 'POST', body: data as Record<string, unknown> });
  }
  async getOrder(orderId: number): Promise<SUOrder> { return this.client.request<SUOrder>(`/orders/${orderId}`); }
  async listOrders(options?: { page?: number; status?: string }): Promise<{ results: SUOrder[] }> {
    return this.client.request('/orders', { params: { page: options?.page, status: options?.status } });
  }

  async listRecipients(options?: { page?: number }): Promise<{ results: SURecipient[] }> {
    return this.client.request('/recipients', { params: { page: options?.page } });
  }
  async createRecipient(data: { name: string; email: string; address: SUAddress }): Promise<SURecipient> {
    return this.client.request<SURecipient>('/recipients', { method: 'POST', body: data as Record<string, unknown> });
  }

  getClient(): SwagUpClient { return this.client; }
}
