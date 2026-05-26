import type { SlackClient } from './client';
import type { SlackUser, UsersListResponse, AuthTestResponse } from '../types';

/**
 * Users API
 */
export class UsersApi {
  constructor(private readonly client: SlackClient) {}

  /**
   * List all users in the workspace
   */
  async list(limit = 200): Promise<SlackUser[]> {
    const allUsers: SlackUser[] = [];
    let cursor: string | undefined;

    do {
      const response = await this.client.get<UsersListResponse>('users.list', {
        limit,
        cursor,
      });

      allUsers.push(...response.members);
      cursor = response.response_metadata?.next_cursor;
    } while (cursor && allUsers.length < 10000);

    return allUsers;
  }

  /**
   * Get user info by ID
   */
  async info(userId: string): Promise<SlackUser> {
    const response = await this.client.get<{ ok: boolean; user: SlackUser }>(
      'users.info',
      { user: userId }
    );
    return response.user;
  }

  /**
   * Get current user's identity
   */
  async me(): Promise<AuthTestResponse> {
    return this.client.get<AuthTestResponse>('auth.test');
  }

  /**
   * Find a user by email
   */
  async findByEmail(email: string): Promise<SlackUser> {
    const response = await this.client.get<{ ok: boolean; user: SlackUser }>(
      'users.lookupByEmail',
      { email }
    );
    return response.user;
  }

  /**
   * Find a user by username/display name
   */
  async findByName(name: string): Promise<SlackUser | undefined> {
    const users = await this.list();
    const normalizedName = name.replace(/^@/, '').toLowerCase();

    return users.find(u =>
      u.name.toLowerCase() === normalizedName ||
      u.profile.display_name?.toLowerCase() === normalizedName ||
      u.real_name?.toLowerCase() === normalizedName
    );
  }

  /**
   * Get user's presence status
   */
  async presence(userId: string): Promise<string> {
    const response = await this.client.get<{ ok: boolean; presence: string }>(
      'users.getPresence',
      { user: userId }
    );
    return response.presence;
  }

  /**
   * Set current user's presence
   */
  async setPresence(presence: 'auto' | 'away'): Promise<void> {
    await this.client.post('users.setPresence', { presence });
  }

  /**
   * Set current user's status
   */
  async setStatus(text: string, emoji?: string, expiration?: number): Promise<void> {
    await this.client.post('users.profile.set', {
      profile: {
        status_text: text,
        status_emoji: emoji || '',
        status_expiration: expiration || 0,
      },
    });
  }

  /**
   * Clear current user's status
   */
  async clearStatus(): Promise<void> {
    await this.setStatus('', '', 0);
  }
}
