import type { UserflowClient } from './client';
import type { CursorListParams } from '../types';
import { encodeResourceId } from './helpers';

export class UsersApi {
  constructor(private readonly client: UserflowClient) {}

  async upsertUser(options: {
    id: string;
    attributes?: Record<string, unknown>;
    group_id?: string;
    group_attributes?: Record<string, unknown>;
    replace_attributes?: boolean;
    signed?: string;
  }): Promise<unknown> {
    return this.client.post('/v2/users', options);
  }

  async listUsers(params: CursorListParams & { q?: string } = {}): Promise<unknown> {
    return this.client.get('/v2/users', params);
  }

  async getUser(id: string): Promise<unknown> {
    return this.client.get(`/v2/users/${encodeResourceId(id)}`);
  }

  async deleteUser(id: string): Promise<unknown> {
    return this.client.delete(`/v2/users/${encodeResourceId(id)}`);
  }

  async addUserToGroup(options: {
    user_id: string;
    group_id: string;
    attributes?: Record<string, unknown>;
  }): Promise<unknown> {
    const { user_id, group_id, attributes } = options;
    return this.client.post(`/v2/users/${encodeResourceId(user_id)}/group`, {
      group_id,
      attributes,
    });
  }
}
