import type { GitHubClient } from './client';
import type { User } from '../types';

/**
 * GitHub Users API
 */
export class UsersApi {
  constructor(private readonly client: GitHubClient) {}

  /**
   * Get the authenticated user
   */
  async getAuthenticated(): Promise<User> {
    return this.client.get<User>('/user');
  }

  /**
   * Get a user by username
   */
  async get(username: string): Promise<User> {
    return this.client.get<User>(`/users/${username}`);
  }

  /**
   * List followers of a user
   */
  async listFollowers(
    username: string,
    options?: { per_page?: number; page?: number }
  ): Promise<User[]> {
    return this.client.get<User[]>(`/users/${username}/followers`, options);
  }

  /**
   * List users followed by a user
   */
  async listFollowing(
    username: string,
    options?: { per_page?: number; page?: number }
  ): Promise<User[]> {
    return this.client.get<User[]>(`/users/${username}/following`, options);
  }

  /**
   * List followers of the authenticated user
   */
  async listMyFollowers(options?: { per_page?: number; page?: number }): Promise<User[]> {
    return this.client.get<User[]>('/user/followers', options);
  }

  /**
   * List users followed by the authenticated user
   */
  async listMyFollowing(options?: { per_page?: number; page?: number }): Promise<User[]> {
    return this.client.get<User[]>('/user/following', options);
  }

  /**
   * Check if the authenticated user follows a user
   */
  async isFollowing(username: string): Promise<boolean> {
    try {
      await this.client.get(`/user/following/${username}`);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if a user follows another user
   */
  async checkFollowing(username: string, targetUser: string): Promise<boolean> {
    try {
      await this.client.get(`/users/${username}/following/${targetUser}`);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Follow a user
   */
  async follow(username: string): Promise<void> {
    await this.client.put(`/user/following/${username}`, {});
  }

  /**
   * Unfollow a user
   */
  async unfollow(username: string): Promise<void> {
    await this.client.delete(`/user/following/${username}`);
  }

  /**
   * List emails for the authenticated user
   */
  async listEmails(options?: { per_page?: number; page?: number }): Promise<
    Array<{
      email: string;
      primary: boolean;
      verified: boolean;
      visibility: string | null;
    }>
  > {
    return this.client.get('/user/emails', options);
  }

  /**
   * List public emails for the authenticated user
   */
  async listPublicEmails(options?: { per_page?: number; page?: number }): Promise<
    Array<{
      email: string;
      primary: boolean;
      verified: boolean;
      visibility: string | null;
    }>
  > {
    return this.client.get('/user/public_emails', options);
  }

  /**
   * Update the authenticated user
   */
  async update(options: {
    name?: string;
    email?: string;
    blog?: string;
    twitter_username?: string;
    company?: string;
    location?: string;
    hireable?: boolean;
    bio?: string;
  }): Promise<User> {
    return this.client.patch<User>('/user', options);
  }
}
