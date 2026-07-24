import type { VeoClient } from './client';
import type { VeoUser } from '../types';

export class UsersApi {
  constructor(private readonly client: VeoClient) {}

  async list(params?: Record<string, string | number | boolean | undefined>): Promise<unknown> {
    return this.client.get<unknown>('/users', params);
  }

  async get(userId: string, params?: Record<string, string | number | boolean | undefined>): Promise<VeoUser> {
    return this.client.get<VeoUser>(`/users/${encodeURIComponent(userId)}`, params);
  }
}
