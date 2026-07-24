import type { ApiEnvelope, MarketCategory, MarketVenue } from '../types';
import type { TotalisClient } from './client';

export interface ListMarketsParams {
  category?: MarketCategory;
  venue?: MarketVenue;
  subcategory?: string;
  frequency?: 'daily' | 'weekly' | 'monthly' | 'hourly';
  date_filter?: '1h' | '1h-1d' | '1d-7d' | 'today' | 'this_week' | 'this_month' | 'all';
  search?: string;
  cursor?: string;
  limit?: number;
  markets_per_event?: number;
}

export interface ListMarketsFlatParams {
  category?: MarketCategory;
  venue?: MarketVenue;
  subcategory?: string;
  series_ticker?: string;
  cursor?: string;
  limit?: number;
}

export class MarketsApi {
  constructor(private readonly client: TotalisClient) {}

  list(params?: ListMarketsParams): Promise<ApiEnvelope<unknown>> {
    return this.client.get<ApiEnvelope<unknown>>(
      '/markets',
      params as Record<string, string | number | boolean | undefined> | undefined,
      false,
    );
  }

  listFlat(params?: ListMarketsFlatParams): Promise<ApiEnvelope<unknown>> {
    return this.client.get<ApiEnvelope<unknown>>(
      '/v1/markets/list',
      params as Record<string, string | number | boolean | undefined> | undefined,
    );
  }

  get(ticker: string, venue?: MarketVenue): Promise<ApiEnvelope<unknown>> {
    return this.client.get<ApiEnvelope<unknown>>(
      `/markets/${encodeURIComponent(ticker)}`,
      venue ? { venue } : undefined,
      false,
    );
  }
}
