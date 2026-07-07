import type { ZohoCliqClient } from './client';
import type { ZohoCliqUser, ZohoCliqUserStatus } from '../types';

export class UsersApi {
  constructor(private readonly client: ZohoCliqClient) {}

  async me(): Promise<ZohoCliqUser> {
    return this.client.get<ZohoCliqUser>('/users/me');
  }

  async get(id: string): Promise<ZohoCliqUser> {
    return this.client.get<ZohoCliqUser>(`/users/${encodeURIComponent(id)}`);
  }

  async list(options?: {
    limit?: number;
    offset?: number;
    status?: ZohoCliqUserStatus;
  }): Promise<unknown> {
    return this.client.get('/users', {
      limit: options?.limit,
      offset: options?.offset,
      status: options?.status,
    });
  }

  async setStatus(code: ZohoCliqUserStatus, message?: string): Promise<unknown> {
    return this.client.post('/users/me/status', { code, message });
  }
}
