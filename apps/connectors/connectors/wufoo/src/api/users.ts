import type { WufooClient } from './client';
import type { WufooUsersResponse } from '../types';

export class UsersApi {
  constructor(private readonly client: WufooClient) {}

  async list(): Promise<WufooUsersResponse> {
    return this.client.get<WufooUsersResponse>('/users.json');
  }
}
