import type { StainlessClient } from './client';
import type { User } from '../types';

/**
 * User API — retrieve the currently authenticated user.
 * https://www.stainless.com/docs/api (/v0/user)
 */
export class UserApi {
  constructor(private readonly client: StainlessClient) {}

  async retrieve(): Promise<User> {
    return this.client.get<User>('/user');
  }
}
