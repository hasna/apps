// WatchSignals Connector — Luxury watch market data and price tracking
import { WatchSignalsClient } from './client';
import type { WatchSignalsConfig, WSWatch, WSWatchList, WSBrand, WSPriceHistory, WSMarketIndex } from '../types';
export { WatchSignalsClient } from './client';

export class WatchSignals {
  private readonly client: WatchSignalsClient;
  constructor(config: WatchSignalsConfig) { this.client = new WatchSignalsClient(config); }
  static fromEnv(): WatchSignals {
    const apiKey = process.env.WATCHSIGNALS_API_KEY;
    if (!apiKey) throw new Error('WATCHSIGNALS_API_KEY is required');
    return new WatchSignals({ apiKey });
  }

  async searchWatches(options?: { brand?: string; query?: string; page?: number; per_page?: number }): Promise<WSWatchList> {
    return this.client.request<WSWatchList>('/watches', { brand: options?.brand, q: options?.query, page: options?.page, per_page: options?.per_page });
  }
  async getWatch(watchId: string): Promise<WSWatch> { return this.client.request<WSWatch>(`/watches/${watchId}`); }
  async getWatchByReference(reference: string): Promise<WSWatch> { return this.client.request<WSWatch>(`/watches/reference/${reference}`); }

  async listBrands(): Promise<WSBrand[]> { return this.client.request<WSBrand[]>('/brands'); }
  async getBrand(brandId: string): Promise<WSBrand> { return this.client.request<WSBrand>(`/brands/${brandId}`); }

  async getPriceHistory(reference: string, options?: { period?: string }): Promise<WSPriceHistory> {
    return this.client.request<WSPriceHistory>(`/watches/reference/${reference}/prices`, { period: options?.period });
  }

  async getMarketIndex(options?: { brand?: string; period?: string }): Promise<WSMarketIndex[]> {
    return this.client.request<WSMarketIndex[]>('/market/index', { brand: options?.brand, period: options?.period });
  }

  getClient(): WatchSignalsClient { return this.client; }
}
