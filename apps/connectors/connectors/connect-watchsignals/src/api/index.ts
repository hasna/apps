// WatchSignals Connector — Luxury watch market data and price tracking
import { WatchSignalsClient } from './client';
import type { WatchSignalsConfig, Watch, WatchPrice, PriceHistoryEntry, Brand, WatchSearchOptions } from '../types';
export { WatchSignalsClient } from './client';

export class WatchSignals {
  private readonly client: WatchSignalsClient;
  constructor(config: WatchSignalsConfig) { this.client = new WatchSignalsClient(config); }

  static fromEnv(): WatchSignals {
    const apiKey = process.env.WATCHSIGNALS_API_KEY;
    if (!apiKey) throw new Error('WATCHSIGNALS_API_KEY environment variable is required');
    return new WatchSignals({ apiKey });
  }

  // Watches
  async searchWatches(options?: WatchSearchOptions): Promise<{ watches: Watch[]; total: number; page: number }> {
    return this.client.request('/watches', options as Record<string, string | number | undefined>);
  }
  async getWatch(watchId: string): Promise<Watch> {
    return this.client.request<Watch>(`/watches/${watchId}`);
  }
  async getWatchByReference(brand: string, reference: string): Promise<Watch> {
    return this.client.request<Watch>('/watches/lookup', { brand, reference });
  }

  // Prices
  async getWatchPrice(watchId: string, currency?: string): Promise<WatchPrice> {
    return this.client.request<WatchPrice>(`/watches/${watchId}/price`, { currency });
  }
  async getPriceHistory(watchId: string, options?: { currency?: string; from?: string; to?: string; interval?: 'daily' | 'weekly' | 'monthly' }): Promise<PriceHistoryEntry[]> {
    const r = await this.client.request<{ history: PriceHistoryEntry[] }>(`/watches/${watchId}/price/history`, options as Record<string, string | undefined>);
    return r.history ?? [];
  }
  async getTopMovers(options?: { currency?: string; period?: '24h' | '7d' | '30d'; limit?: number }): Promise<Array<Watch & { priceChange: number; priceChangePercent: number }>> {
    const r = await this.client.request<{ watches: Array<Watch & { priceChange: number; priceChangePercent: number }> }>('/market/top-movers', options as Record<string, string | number | undefined>);
    return r.watches ?? [];
  }

  // Brands
  async listBrands(): Promise<Brand[]> {
    const r = await this.client.request<{ brands: Brand[] }>('/brands');
    return r.brands ?? [];
  }
  async getBrand(brandId: string): Promise<Brand> {
    return this.client.request<Brand>(`/brands/${brandId}`);
  }
  async getBrandWatches(brandId: string, options?: { page?: number; limit?: number }): Promise<Watch[]> {
    const r = await this.client.request<{ watches: Watch[] }>(`/brands/${brandId}/watches`, options as Record<string, number | undefined>);
    return r.watches ?? [];
  }

  getClient(): WatchSignalsClient { return this.client; }
}
