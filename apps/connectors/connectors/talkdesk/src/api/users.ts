import type { TalkdeskClient } from './client';
import type { TalkdeskUser, TalkdeskUserList } from '../types';

/**
 * Talkdesk Users API.
 * https://docs.talkdesk.com/docs/usersapi
 */
export class UsersApi {
  constructor(private readonly client: TalkdeskClient) {}

  /** List users in the account (paginated with page/per_page). */
  async list(options?: { page?: number; perPage?: number }): Promise<TalkdeskUserList> {
    return this.client.get<TalkdeskUserList>('/users', {
      page: options?.page,
      per_page: options?.perPage,
    });
  }

  /** Get a single user by ID. */
  async get(userId: string): Promise<TalkdeskUser> {
    return this.client.get<TalkdeskUser>(`/users/${encodeURIComponent(userId)}`);
  }

  /** Get the user associated with the current access token (OpenID Connect userinfo). */
  async me(): Promise<TalkdeskUser> {
    return this.client.get<TalkdeskUser>('/users/me');
  }
}
