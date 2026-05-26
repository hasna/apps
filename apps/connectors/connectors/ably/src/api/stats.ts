import type { ConnectorClient } from './client';
import type { Stats, StatsParams } from '../types';

export class StatsApi {
  constructor(private readonly client: ConnectorClient) {}

  /**
   * Get application statistics
   * GET /stats
   */
  async get(params?: StatsParams): Promise<Stats[]> {
    const queryParams: Record<string, string | number | boolean | undefined> = {};
    if (params?.start) queryParams.start = params.start;
    if (params?.end) queryParams.end = params.end;
    if (params?.limit) queryParams.limit = params.limit;
    if (params?.direction) queryParams.direction = params.direction;
    if (params?.unit) queryParams.unit = params.unit;

    return this.client.get<Stats[]>('/stats', queryParams);
  }

  /**
   * Get server time
   * GET /time
   */
  async time(): Promise<number[]> {
    return this.client.get<number[]>('/time');
  }
}
