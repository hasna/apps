// Marketplacer Connector — Online marketplace platform and management
import { MarketplacerClient } from './client';
import type { MarketplacerConfig, MPListing, MPOrder, MPOrderList, MPSeller, MPCategory } from '../types';
export { MarketplacerClient } from './client';

export class Marketplacer {
  private readonly client: MarketplacerClient;
  constructor(config: MarketplacerConfig) { this.client = new MarketplacerClient(config); }
  static fromEnv(): Marketplacer {
    const apiKey = process.env.MARKETPLACER_API_KEY;
    if (!apiKey) throw new Error('MARKETPLACER_API_KEY is required');
    return new Marketplacer({ apiKey, baseUrl: process.env.MARKETPLACER_BASE_URL });
  }

  async listListings(options?: { page?: number; per_page?: number; status?: string; seller_id?: string }): Promise<{ listings: MPListing[]; total: number }> {
    return this.client.request('/listings', { params: { page: options?.page, per_page: options?.per_page, status: options?.status, seller_id: options?.seller_id } });
  }
  async getListing(listingId: string): Promise<MPListing> { return this.client.request<MPListing>(`/listings/${listingId}`); }
  async createListing(data: { title: string; description: string; price: number; category_id: string; variants?: { sku: string; price: number; stock: number }[] }): Promise<MPListing> {
    return this.client.request<MPListing>('/listings', { method: 'POST', body: data as Record<string, unknown> });
  }
  async updateListing(listingId: string, data: { title?: string; description?: string; price?: number; status?: string }): Promise<MPListing> {
    return this.client.request<MPListing>(`/listings/${listingId}`, { method: 'PATCH', body: data as Record<string, unknown> });
  }

  async listOrders(options?: { page?: number; per_page?: number; status?: string }): Promise<MPOrderList> {
    return this.client.request<MPOrderList>('/orders', { params: { page: options?.page, per_page: options?.per_page, status: options?.status } });
  }
  async getOrder(orderId: string): Promise<MPOrder> { return this.client.request<MPOrder>(`/orders/${orderId}`); }

  async listSellers(): Promise<MPSeller[]> { return this.client.request<MPSeller[]>('/sellers'); }
  async getSeller(sellerId: string): Promise<MPSeller> { return this.client.request<MPSeller>(`/sellers/${sellerId}`); }

  async listCategories(): Promise<MPCategory[]> { return this.client.request<MPCategory[]>('/categories'); }

  getClient(): MarketplacerClient { return this.client; }
}
