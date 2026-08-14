import type { ValenceConfig, RawRequestOptions } from '../types';
import { ValenceClient } from './client';
import { MarketsApi } from './markets';
import { OrdersApi } from './orders';
import { PositionsApi } from './positions';
import { BalancesApi } from './balances';
import { ArbitrageApi } from './arbitrage';

/**
 * Valence prediction markets API connector
 */
export class Valence {
  private readonly client: ValenceClient;

  public readonly markets: MarketsApi;
  public readonly orders: OrdersApi;
  public readonly positions: PositionsApi;
  public readonly balances: BalancesApi;
  public readonly arbitrage: ArbitrageApi;

  constructor(config: ValenceConfig) {
    this.client = new ValenceClient(config);
    this.markets = new MarketsApi(this.client);
    this.orders = new OrdersApi(this.client);
    this.positions = new PositionsApi(this.client);
    this.balances = new BalancesApi(this.client);
    this.arbitrage = new ArbitrageApi(this.client);
  }

  static fromEnv(): Valence {
    const apiKey = process.env.VALENCE_API_KEY;
    if (!apiKey) {
      throw new Error('VALENCE_API_KEY environment variable is required');
    }
    return new Valence({
      apiKey,
      baseUrl: process.env.VALENCE_BASE_URL,
    });
  }

  getBaseUrl(): string {
    return this.client.getBaseUrl();
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): ValenceClient {
    return this.client;
  }

  async rawRequest<T = unknown>(options: RawRequestOptions): Promise<T> {
    const { method = 'GET', path, params, body, headers } = options;
    return this.client.request<T>(path, { method, params, body, headers });
  }
}

export { ValenceClient, DEFAULT_BASE_URL, encodePathSegment } from './client';
export { MarketsApi } from './markets';
export { OrdersApi } from './orders';
export { PositionsApi } from './positions';
export { BalancesApi } from './balances';
export { ArbitrageApi } from './arbitrage';
