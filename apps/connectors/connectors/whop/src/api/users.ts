import type { WhopClient } from './client';
import type { User } from '../types';

export class UsersApi {
  constructor(private readonly client: WhopClient) {}

  me(): Promise<User> {
    return this.client.get('/users/me');
  }

  get(idOrUsername: string): Promise<User> {
    return this.client.get(`/users/${encodeURIComponent(idOrUsername)}`);
  }
}
