import type { ConnectorClient } from './client';
import type { User } from '../types';

export interface UserListResponse {
  users: User[];
}

export interface UserResponse {
  user: User;
}

export class UsersApi {
  constructor(private readonly client: ConnectorClient) {}

  /**
   * List agents/users in the SupportBee account.
   */
  async list(): Promise<UserListResponse> {
    return this.client.get<UserListResponse>('/users');
  }

  async get(userId: number | string): Promise<UserResponse> {
    return this.client.get<UserResponse>(`/users/${userId}`);
  }
}
