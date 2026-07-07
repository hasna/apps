import type { ConnectorClient } from './client';
import type { TimeSeriesParams, TimeSeriesResult } from '../types';

export class TimeSeriesApi {
  constructor(private readonly client: ConnectorClient) {}

  /**
   * Get historical time series data for a symbol.
   * @see https://twelvedata.com/docs#time-series
   */
  async get(params: TimeSeriesParams): Promise<TimeSeriesResult> {
    const queryParams: Record<string, string | number | boolean | undefined> = {
      symbol: params.symbol,
      interval: params.interval,
    };

    if (params.exchange !== undefined) queryParams.exchange = params.exchange;
    if (params.country !== undefined) queryParams.country = params.country;
    if (params.type !== undefined) queryParams.type = params.type;
    if (params.outputsize !== undefined) queryParams.outputsize = params.outputsize;
    if (params.dp !== undefined) queryParams.dp = params.dp;
    if (params.start_date !== undefined) queryParams.start_date = params.start_date;
    if (params.end_date !== undefined) queryParams.end_date = params.end_date;
    if (params.prepost !== undefined) queryParams.prepost = params.prepost;
    if (params.mic_code !== undefined) queryParams.mic_code = params.mic_code;
    if (params.timezone !== undefined) queryParams.timezone = params.timezone;

    return this.client.get<TimeSeriesResult>('/time_series', queryParams);
  }
}
