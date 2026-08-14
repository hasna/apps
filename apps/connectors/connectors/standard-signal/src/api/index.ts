import type { StandardSignalConfig, RawRequestOptions } from '../types';
import { StandardSignalClient } from './client';
import { PortfoliosApi } from './portfolios';
import { StrategiesApi } from './strategies';
import { PositionsApi } from './positions';
import { TradesApi } from './trades';
import { PerformanceApi } from './performance';

/**
 * Main Standard Signal API Connector class
 */
export class StandardSignal {
  private readonly client: StandardSignalClient;

  public readonly portfolios: PortfoliosApi;
  public readonly strategies: StrategiesApi;
  public readonly positions: PositionsApi;
  public readonly trades: TradesApi;
  public readonly performance: PerformanceApi;

  constructor(config: StandardSignalConfig) {
    this.client = new StandardSignalClient(config);
    this.portfolios = new PortfoliosApi(this.client);
    this.strategies = new StrategiesApi(this.client);
    this.positions = new PositionsApi(this.client);
    this.trades = new TradesApi(this.client);
    this.performance = new PerformanceApi(this.client);
  }

  static fromEnv(): StandardSignal {
    const apiKey = process.env.STANDARD_SIGNAL_API_KEY;
    const baseUrl = process.env.STANDARD_SIGNAL_BASE_URL;

    if (!apiKey) {
      throw new Error('STANDARD_SIGNAL_API_KEY environment variable is required');
    }

    return new StandardSignal({ apiKey, baseUrl });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getBaseUrl(): string {
    return this.client.getBaseUrl();
  }

  getClient(): StandardSignalClient {
    return this.client;
  }

  async rawRequest(path: string, options: RawRequestOptions = {}): Promise<unknown> {
    const { method = 'GET', query, body, headers } = options;
    return this.client.request(path, { method, params: query, body, headers });
  }
}

export { StandardSignalClient } from './client';
export { PortfoliosApi } from './portfolios';
export { StrategiesApi } from './strategies';
export { PositionsApi } from './positions';
export { TradesApi } from './trades';
export { PerformanceApi } from './performance';
