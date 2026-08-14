import type { ConnectorClient } from './client';
import type { PriceParams, PriceResult } from '../types';

export class PriceApi {
  constructor(private readonly client: ConnectorClient) {}

  /**
   * Get the real-time price for a symbol.
   * @see https://twelvedata.com/docs#price
   */
  async get(params: PriceParams): Promise<PriceResult> {
    const queryParams: Record<string, string | number | boolean | undefined> = {
      symbol: params.symbol,
    };

    if (params.exchange !== undefined) queryParams.exchange = params.exchange;
    if (params.country !== undefined) queryParams.country = params.country;
    if (params.type !== undefined) queryParams.type = params.type;
    if (params.dp !== undefined) queryParams.dp = params.dp;
    if (params.prepost !== undefined) queryParams.prepost = params.prepost;
    if (params.mic_code !== undefined) queryParams.mic_code = params.mic_code;

    return this.client.get<PriceResult>('/price', queryParams);
  }
}
