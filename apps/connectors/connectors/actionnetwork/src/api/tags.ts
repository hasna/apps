import type { ConnectorClient } from './client';
import type { Tag, TagCreateParams, TaggingCreateParams, ListParams } from '../types';

export class TagsApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(params?: ListParams): Promise<unknown> {
    const queryParams: Record<string, string | number | boolean | undefined> = {};
    if (params?.page) queryParams.page = params.page;
    if (params?.per_page) queryParams.per_page = params.per_page;
    return this.client.get<unknown>('/tags', queryParams);
  }

  async get(tagId: string): Promise<Tag> {
    return this.client.get<Tag>(`/tags/${tagId}`);
  }

  async create(params: TagCreateParams): Promise<Tag> {
    return this.client.post<Tag>('/tags', params);
  }

  async listTaggings(tagId: string, params?: ListParams): Promise<unknown> {
    const queryParams: Record<string, string | number | boolean | undefined> = {};
    if (params?.page) queryParams.page = params.page;
    if (params?.per_page) queryParams.per_page = params.per_page;
    return this.client.get<unknown>(`/tags/${tagId}/taggings`, queryParams);
  }

  async createTagging(tagId: string, params: TaggingCreateParams): Promise<unknown> {
    return this.client.post<unknown>(`/tags/${tagId}/taggings`, params);
  }

  async deleteTagging(tagId: string, taggingId: string): Promise<void> {
    await this.client.delete(`/tags/${tagId}/taggings/${taggingId}`);
  }
}
