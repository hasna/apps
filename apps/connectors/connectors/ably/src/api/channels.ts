import type { ConnectorClient } from './client';
import type { ChannelDetails, ListChannelsParams } from '../types';

export class ChannelsApi {
  constructor(private readonly client: ConnectorClient) {}

  /**
   * List active channels
   * GET /channels
   */
  async list(params?: ListChannelsParams): Promise<ChannelDetails[]> {
    const queryParams: Record<string, string | number | boolean | undefined> = {};
    if (params?.limit) queryParams.limit = params.limit;
    if (params?.prefix) queryParams.prefix = params.prefix;
    if (params?.by) queryParams.by = params.by;

    const result = await this.client.get<ChannelDetails[] | unknown>('/channels', queryParams);

    if (Array.isArray(result)) {
      return result;
    }

    return [];
  }

  /**
   * Get channel details
   * GET /channels/{channelId}
   */
  async get(channelId: string): Promise<ChannelDetails> {
    return this.client.get<ChannelDetails>(`/channels/${encodeURIComponent(channelId)}`);
  }
}
