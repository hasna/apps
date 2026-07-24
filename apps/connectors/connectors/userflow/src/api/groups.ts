import type { UserflowClient } from './client';
import type { CursorListParams } from '../types';
import { encodeResourceId } from './helpers';

export class GroupsApi {
  constructor(private readonly client: UserflowClient) {}

  async upsertGroup(options: {
    id: string;
    attributes?: Record<string, unknown>;
    replace_attributes?: boolean;
  }): Promise<unknown> {
    return this.client.post('/v2/groups', options);
  }

  async listGroups(params: CursorListParams = {}): Promise<unknown> {
    return this.client.get('/v2/groups', params);
  }

  async getGroup(id: string): Promise<unknown> {
    return this.client.get(`/v2/groups/${encodeResourceId(id)}`);
  }

  async deleteGroup(id: string): Promise<unknown> {
    return this.client.delete(`/v2/groups/${encodeResourceId(id)}`);
  }
}
