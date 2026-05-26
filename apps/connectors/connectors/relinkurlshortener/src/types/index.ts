export interface RelinkConfig { apiKey: string; }

export interface RLLink { id: string; url: string; short_url: string; slug: string; clicks: number; created_at: string; expires_at: string | null; title: string | null; }
export interface RLLinkList { links: RLLink[]; total: number; page: number; per_page: number; }
export interface RLClickStats { total_clicks: number; unique_clicks: number; clicks_by_date: { date: string; clicks: number }[]; clicks_by_country: { country: string; clicks: number }[]; clicks_by_referrer: { referrer: string; clicks: number }[]; }

export class RelinkApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'RelinkApiError'; this.statusCode = statusCode; }
}
