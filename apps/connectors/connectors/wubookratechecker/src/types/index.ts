export interface WuBookrateConfig { apiKey: string; baseUrl?: string; }

export interface WBBook { isbn: string; title: string; author: string; publisher: string; published_date: string; average_rating: number; ratings_count: number; image_url: string; }
export interface WBReview { source: string; rating: number; review_count: number; url: string; }
export interface WBPriceResult { isbn: string; prices: { store: string; price: number; currency: string; url: string; availability: string }[]; }

export class WuBookrateApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'WuBookrateApiError'; this.statusCode = statusCode; }
}
