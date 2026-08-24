// Wu Bookrate Checker Connector — Book rating and review data lookup
import { WuBookrateClient } from './client';
import type { WuBookrateConfig, WBBook, WBReview, WBPriceResult } from '../types';
export { WuBookrateClient } from './client';

export class WuBookrateChecker {
  private readonly client: WuBookrateClient;
  constructor(config: WuBookrateConfig) { this.client = new WuBookrateClient(config); }
  static fromEnv(): WuBookrateChecker {
    const apiKey = process.env.WUBOOKRATE_API_KEY;
    if (!apiKey) throw new Error('WUBOOKRATE_API_KEY is required');
    return new WuBookrateChecker({ apiKey, baseUrl: process.env.WUBOOKRATE_BASE_URL });
  }

  async lookupByISBN(isbn: string): Promise<WBBook> { return this.client.request<WBBook>(`/books/${isbn}`); }
  async searchBooks(query: string, options?: { limit?: number }): Promise<{ books: WBBook[] }> {
    return this.client.request('/books/search', { q: query, limit: options?.limit });
  }
  async getReviews(isbn: string): Promise<{ reviews: WBReview[] }> { return this.client.request(`/books/${isbn}/reviews`); }
  async getPrices(isbn: string): Promise<WBPriceResult> { return this.client.request<WBPriceResult>(`/books/${isbn}/prices`); }

  getClient(): WuBookrateClient { return this.client; }
}
