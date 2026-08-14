export interface WatchSignalsConfig { apiKey: string; }

export interface WSWatch { id: string; brand: string; model: string; reference: string; name: string; retail_price: number; market_price: number; currency: string; year: number; movement: string; case_size: string; case_material: string; dial_color: string; image_url: string; }
export interface WSWatchList { data: WSWatch[]; total: number; page: number; per_page: number; }
export interface WSBrand { id: string; name: string; slug: string; watch_count: number; country: string; }
export interface WSPriceHistory { reference: string; prices: { date: string; price: number; currency: string; source: string }[]; }
export interface WSMarketIndex { date: string; index_value: number; change_pct: number; }

export class WatchSignalsApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'WatchSignalsApiError'; this.statusCode = statusCode; }
}
