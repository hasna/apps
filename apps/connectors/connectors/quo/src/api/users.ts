import type { QuoClient } from './client';
import type { User, UserListResponse } from '../types';

/**
 * Users API module
 * List and get user details
 */
export class UsersApi {
  constructor(private readonly client: QuoClient) {}

  /**
   * List all users in the workspace
   */
  async list(): Promise<UserListResponse> {
    return this.client.get<UserListResponse>('/users');
  }

  /**
   * Get a user by ID
   */
  async get(userId: string): Promise<{ data: User }> {
    return this.client.get<{ data: User }>(`/users/${userId}`);
  }
}
