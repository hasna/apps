import type { FigmaClient } from './client';
import type { User } from '../types';

/**
 * Figma Users API
 */
export class UsersApi {
  constructor(private readonly client: FigmaClient) {}

  /**
   * Get the current user
   */
  async getMe(): Promise<User> {
    return this.client.request<User>('/me');
  }
}
