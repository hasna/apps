import type { ConnectorClient } from './client';
import type { PresenceMember, PresenceParams, PresenceHistoryParams } from '../types';

export class PresenceApi {
  constructor(private readonly client: ConnectorClient) {}

  /**
   * Get current presence members for a channel
   * GET /channels/{channelId}/presence
   */
  async get(channelId: string, params?: PresenceParams): Promise<PresenceMember[]> {
    const queryParams: Record<string, string | number | boolean | undefined> = {};
    if (params?.clientId) queryParams.clientId = params.clientId;
    if (params?.connectionId) queryParams.connectionId = params.connectionId;
    if (params?.limit) queryParams.limit = params.limit;

    return this.client.get<PresenceMember[]>(
      `/channels/${encodeURIComponent(channelId)}/presence`,
      queryParams,
    );
  }

  /**
   * Get presence history for a channel
   * GET /channels/{channelId}/presence/history
   */
  async history(channelId: string, params?: PresenceHistoryParams): Promise<PresenceMember[]> {
    const queryParams: Record<string, string | number | boolean | undefined> = {};
    if (params?.start) queryParams.start = params.start;
    if (params?.end) queryParams.end = params.end;
    if (params?.limit) queryParams.limit = params.limit;
    if (params?.direction) queryParams.direction = params.direction;

    return this.client.get<PresenceMember[]>(
      `/channels/${encodeURIComponent(channelId)}/presence/history`,
      queryParams,
    );
  }
}
