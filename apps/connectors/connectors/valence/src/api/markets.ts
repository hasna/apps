import type { ValenceClient } from './client';
import { encodePathSegment } from './client';
import type { ListParams, MatchTickersRequest } from '../types';

export class MarketsApi {
  constructor(private readonly client: ValenceClient) {}

  async listMarkets(params?: ListParams): Promise<unknown> {
    return this.client.request('/markets', { params });
  }

  async getMarket(marketId: string): Promise<unknown> {
    return this.client.request(`/markets/${encodePathSegment(marketId)}`);
  }

  async matchTickers(body: MatchTickersRequest): Promise<unknown> {
    return this.client.request('/markets/match-tickers', { method: 'POST', body });
  }
}
