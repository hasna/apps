import type { ConnectorClient } from './client';
import type { Tag, TagCreateParams, ListParams } from '../types';

export class TagsApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(params?: ListParams): Promise<unknown> {
    const queryParams: Record<string, string | number | boolean | undefined> = {};
    if (params?.limit) queryParams.limit = params.limit;
    if (params?.offset) queryParams.offset = params.offset;
    if (params?.filters) {
      for (const [key, value] of Object.entries(params.filters)) {
        queryParams[key] = value;
      }
    }
    return this.client.get<unknown>('/tags', queryParams);
  }

  async get(tagId: string): Promise<{ tag: Tag }> {
    return this.client.get<{ tag: Tag }>(`/tags/${tagId}`);
  }

  async create(params: TagCreateParams): Promise<{ tag: Tag }> {
    return this.client.post<{ tag: Tag }>('/tags', { tag: params });
  }

  async update(tagId: string, params: Partial<TagCreateParams>): Promise<{ tag: Tag }> {
    return this.client.put<{ tag: Tag }>(`/tags/${tagId}`, { tag: params });
  }

  async delete(tagId: string): Promise<void> {
    await this.client.delete(`/tags/${tagId}`);
  }
}
