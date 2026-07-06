import type { ConnectorClient } from './client';
import type { SymbolsParams, SymbolsResult } from '../types';

export class SymbolsApi {
  constructor(private readonly client: ConnectorClient) {}

  /**
   * List available stock symbols.
   * @see https://twelvedata.com/docs#stocks-list
   */
  async list(params: SymbolsParams = {}): Promise<SymbolsResult> {
    const queryParams: Record<string, string | number | boolean | undefined> = {};

    if (params.symbol !== undefined) queryParams.symbol = params.symbol;
    if (params.figi !== undefined) queryParams.figi = params.figi;
    if (params.isin !== undefined) queryParams.isin = params.isin;
    if (params.cusip !== undefined) queryParams.cusip = params.cusip;
    if (params.exchange !== undefined) queryParams.exchange = params.exchange;
    if (params.mic_code !== undefined) queryParams.mic_code = params.mic_code;
    if (params.country !== undefined) queryParams.country = params.country;
    if (params.type !== undefined) queryParams.type = params.type;
    if (params.format !== undefined) queryParams.format = params.format;
    if (params.show_plan !== undefined) queryParams.show_plan = params.show_plan;
    if (params.include_delisted !== undefined) queryParams.include_delisted = params.include_delisted;

    return this.client.get<SymbolsResult>('/stocks', queryParams);
  }
}
