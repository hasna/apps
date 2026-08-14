import type { VeoClient } from './client';
import type { VeoGroup } from '../types';

export class GroupsApi {
  constructor(private readonly client: VeoClient) {}

  async list(params?: Record<string, string | number | boolean | undefined>): Promise<unknown> {
    return this.client.get<unknown>('/groups', params);
  }

  async get(groupId: string, params?: Record<string, string | number | boolean | undefined>): Promise<VeoGroup> {
    return this.client.get<VeoGroup>(`/groups/${encodeURIComponent(groupId)}`, params);
  }
}
