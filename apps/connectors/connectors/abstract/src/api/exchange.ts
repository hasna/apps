import type { ConnectorClient } from './client';
import type {
  ExchangeRateLiveParams,
  ExchangeRateConvertParams,
  ExchangeRateHistoricalParams,
  ExchangeRateLiveResult,
  ExchangeRateConvertResult,
} from '../types';

const BASE_URL = 'https://exchange-rates.abstractapi.com';

export class ExchangeApi {
  constructor(private readonly client: ConnectorClient) {}

  /**
   * Get live exchange rates for a base currency.
   */
  async live(params: ExchangeRateLiveParams): Promise<ExchangeRateLiveResult> {
    const queryParams: Record<string, string | number | boolean | undefined> = {
      base: params.base,
    };

    if (params.target) {
      queryParams.target = params.target;
    }

    return this.client.get<ExchangeRateLiveResult>('/v1/live', queryParams, BASE_URL);
  }

  /**
   * Convert between two currencies.
   */
  async convert(params: ExchangeRateConvertParams): Promise<ExchangeRateConvertResult> {
    const queryParams: Record<string, string | number | boolean | undefined> = {
      base: params.base,
      target: params.target,
    };

    if (params.base_amount !== undefined) {
      queryParams.base_amount = params.base_amount;
    }
    if (params.date) {
      queryParams.date = params.date;
    }

    return this.client.get<ExchangeRateConvertResult>('/v1/convert', queryParams, BASE_URL);
  }

  /**
   * Get historical exchange rates for a specific date.
   */
  async historical(params: ExchangeRateHistoricalParams): Promise<ExchangeRateLiveResult> {
    const queryParams: Record<string, string | number | boolean | undefined> = {
      base: params.base,
      date: params.date,
    };

    if (params.target) {
      queryParams.target = params.target;
    }

    return this.client.get<ExchangeRateLiveResult>('/v1/historical', queryParams, BASE_URL);
  }
}
