export interface OffAlertsConfig { apiKey: string; }

export interface OAAlert { id: string; product_url: string; target_price: number; current_price: number; currency: string; product_name: string; status: 'active' | 'triggered' | 'expired'; email: string; created_at: string; triggered_at: string | null; }
export interface OAAlertList { alerts: OAAlert[]; total: number; page: number; per_page: number; }
export interface OAPriceHistory { product_url: string; prices: { price: number; date: string; currency: string }[]; }
export interface OAProduct { url: string; name: string; current_price: number; currency: string; availability: boolean; image_url: string | null; last_checked: string; }

export class OffAlertsApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'OffAlertsApiError'; this.statusCode = statusCode; }
}
