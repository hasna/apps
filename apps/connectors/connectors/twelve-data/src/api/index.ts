import type { ConnectorConfig } from '../types';
import { ConnectorClient } from './client';
import { PriceApi } from './price';
import { QuoteApi } from './quote';
import { TimeSeriesApi } from './time-series';
import { ExchangeRateApi } from './exchange-rate';
import { SymbolsApi } from './symbols';

/**
 * Twelve Data API Connector
 * Provides access to real-time and historical market data for stocks, forex, and crypto.
 */
export class Connector {
  private readonly client: ConnectorClient;

  public readonly price: PriceApi;
  public readonly quote: QuoteApi;
  public readonly timeSeries: TimeSeriesApi;
  public readonly exchangeRate: ExchangeRateApi;
  public readonly symbols: SymbolsApi;

  constructor(config: ConnectorConfig) {
    this.client = new ConnectorClient(config);
    this.price = new PriceApi(this.client);
    this.quote = new QuoteApi(this.client);
    this.timeSeries = new TimeSeriesApi(this.client);
    this.exchangeRate = new ExchangeRateApi(this.client);
    this.symbols = new SymbolsApi(this.client);
  }

  /**
   * Create a client from environment variables.
   * Looks for TWELVE_DATA_API_KEY and optional TWELVE_DATA_BASE_URL.
   */
  static fromEnv(): Connector {
    const apiKey = process.env.TWELVE_DATA_API_KEY;

    if (!apiKey) {
      throw new Error('TWELVE_DATA_API_KEY environment variable is required');
    }

    return new Connector({
      apiKey,
      baseUrl: process.env.TWELVE_DATA_BASE_URL,
    });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): ConnectorClient {
    return this.client;
  }

  /**
   * Make a raw GET request to any Twelve Data API path.
   */
  async raw(
    path: string,
    params?: Record<string, string | number | boolean | undefined>
  ): Promise<unknown> {
    return this.client.get(path, params);
  }
}

export { ConnectorClient } from './client';
export { PriceApi } from './price';
export { QuoteApi } from './quote';
export { TimeSeriesApi } from './time-series';
export { ExchangeRateApi } from './exchange-rate';
export { SymbolsApi } from './symbols';
