import type { ConnectorClient } from './client';
import type { User, UserInviteParams } from '../types';

export class UsersApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(): Promise<unknown> {
    return this.client.get('/users');
  }

  async invite(data: UserInviteParams): Promise<unknown> {
    return this.client.post('/users/invite', data);
  }

  async remove(id: string | number): Promise<unknown> {
    return this.client.delete(`/users/${encodeURIComponent(String(id))}`);
  }
}
