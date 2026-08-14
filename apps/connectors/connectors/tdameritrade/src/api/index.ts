// TD Ameritrade Connector — Brokerage, trading, and market data
import { TDAClient } from './client';
import type { TDAConfig, TDAQuote, TDAAccount, TDAOrder, TDAPriceHistory, TDASearchResult } from '../types';
export { TDAClient } from './client';

export class TDAmeritrade {
  private readonly client: TDAClient;
  constructor(config: TDAConfig) { this.client = new TDAClient(config); }
  static fromEnv(): TDAmeritrade {
    const apiKey = process.env.TDA_API_KEY;
    if (!apiKey) throw new Error('TDA_API_KEY is required');
    return new TDAmeritrade({ apiKey, accessToken: process.env.TDA_ACCESS_TOKEN });
  }

  async getQuote(symbol: string): Promise<Record<string, TDAQuote>> { return this.client.request(`/marketdata/${symbol}/quotes`); }
  async getQuotes(symbols: string[]): Promise<Record<string, TDAQuote>> {
    return this.client.request('/marketdata/quotes', { params: { symbol: symbols.join(',') } });
  }

  async getPriceHistory(symbol: string, options?: { periodType?: string; period?: number; frequencyType?: string; frequency?: number }): Promise<TDAPriceHistory> {
    return this.client.request<TDAPriceHistory>(`/marketdata/${symbol}/pricehistory`, { params: { periodType: options?.periodType, period: options?.period, frequencyType: options?.frequencyType, frequency: options?.frequency } });
  }

  async searchInstruments(query: string, projection?: string): Promise<TDASearchResult> {
    return this.client.request<TDASearchResult>('/instruments', { params: { symbol: query, projection: projection || 'symbol-search' } });
  }

  async getAccount(accountId: string): Promise<TDAAccount> { return this.client.request<TDAAccount>(`/accounts/${accountId}`, { params: { fields: 'positions' } }); }
  async listAccounts(): Promise<TDAAccount[]> { return this.client.request<TDAAccount[]>('/accounts', { params: { fields: 'positions' } }); }

  async listOrders(accountId: string, options?: { maxResults?: number; status?: string }): Promise<TDAOrder[]> {
    return this.client.request<TDAOrder[]>(`/accounts/${accountId}/orders`, { params: { maxResults: options?.maxResults, status: options?.status } });
  }
  async placeOrder(accountId: string, order: Record<string, unknown>): Promise<void> {
    await this.client.request(`/accounts/${accountId}/orders`, { method: 'POST', body: order });
  }
  async cancelOrder(accountId: string, orderId: number): Promise<void> {
    await this.client.request(`/accounts/${accountId}/orders/${orderId}`, { method: 'DELETE' });
  }

  getClient(): TDAClient { return this.client; }
}
