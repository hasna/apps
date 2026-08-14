import type { WatiClient } from './client';
import type { GetBroadcastDetailsParams, PaginationParams, WatiApiResponse } from '../types';

export class BroadcastsApi {
  constructor(private readonly client: WatiClient) {}

  async getBroadcasts(params: PaginationParams = {}): Promise<WatiApiResponse> {
    return this.client.get<WatiApiResponse>('/api/v1/getBroadcasts', {
      pageSize: params.pageSize,
      pageNumber: params.pageNumber,
    });
  }

  async getBroadcastDetails(params: GetBroadcastDetailsParams): Promise<WatiApiResponse> {
    const { broadcastName, pageSize, pageNumber } = params;
    return this.client.get<WatiApiResponse>('/api/v1/getBroadcastDetails', {
      broadcastName,
      pageSize,
      pageNumber,
    });
  }
}
