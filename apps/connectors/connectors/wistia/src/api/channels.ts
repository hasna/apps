import type { WistiaClient } from './client';
import type { WistiaChannel, PaginationParams, CreateChannelParams } from '../types';

export class ChannelsApi {
  constructor(private readonly client: WistiaClient) {}

  async list(options: Pick<PaginationParams, 'page' | 'perPage'> = {}): Promise<WistiaChannel[]> {
    return this.client.get<WistiaChannel[]>('/v1/channels.json', {
      page: options.page,
      per_page: options.perPage,
    });
  }

  async get(hashedId: string): Promise<WistiaChannel> {
    return this.client.get<WistiaChannel>(`/v1/channels/${encodeURIComponent(hashedId)}.json`);
  }

  async create(params: CreateChannelParams): Promise<WistiaChannel> {
    return this.client.post<WistiaChannel>('/v1/channels.json', {
      name: params.name,
      description: params.description,
      layout: params.layout,
    });
  }

  async update(hashedId: string, data: Record<string, unknown>): Promise<WistiaChannel> {
    return this.client.put<WistiaChannel>(
      `/v1/channels/${encodeURIComponent(hashedId)}.json`,
      data,
    );
  }

  async delete(hashedId: string): Promise<void> {
    await this.client.delete(`/v1/channels/${encodeURIComponent(hashedId)}.json`);
  }
}
