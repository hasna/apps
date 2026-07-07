import type { ConnectorClient } from './client';
import type { QuoteParams, QuoteResult } from '../types';

export class QuoteApi {
  constructor(private readonly client: ConnectorClient) {}

  /**
   * Get a real-time quote for a symbol.
   * @see https://twelvedata.com/docs#quote
   */
  async get(params: QuoteParams): Promise<QuoteResult> {
    const queryParams: Record<string, string | number | boolean | undefined> = {
      symbol: params.symbol,
    };

    if (params.interval !== undefined) queryParams.interval = params.interval;
    if (params.exchange !== undefined) queryParams.exchange = params.exchange;
    if (params.country !== undefined) queryParams.country = params.country;
    if (params.type !== undefined) queryParams.type = params.type;
    if (params.dp !== undefined) queryParams.dp = params.dp;
    if (params.prepost !== undefined) queryParams.prepost = params.prepost;
    if (params.mic_code !== undefined) queryParams.mic_code = params.mic_code;
    if (params.eod !== undefined) queryParams.eod = params.eod;
    if (params.rolling_period !== undefined) queryParams.rolling_period = params.rolling_period;
    if (params.timezone !== undefined) queryParams.timezone = params.timezone;

    return this.client.get<QuoteResult>('/quote', queryParams);
  }
}
