import type { ConnectorClient } from './client';
import type { ExchangeRateParams, ExchangeRateResult } from '../types';

export class ExchangeRateApi {
  constructor(private readonly client: ConnectorClient) {}

  /**
   * Get the exchange rate between two currencies.
   * @see https://twelvedata.com/docs#exchange-rate
   */
  async get(params: ExchangeRateParams): Promise<ExchangeRateResult> {
    const queryParams: Record<string, string | number | boolean | undefined> = {
      symbol: params.symbol,
    };

    if (params.dp !== undefined) queryParams.dp = params.dp;

    return this.client.get<ExchangeRateResult>('/exchange_rate', queryParams);
  }
}
