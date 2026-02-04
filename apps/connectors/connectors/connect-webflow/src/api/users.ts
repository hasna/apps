import type { WebflowClient } from './client';
import type { User, InviteUserInput } from '../types';

export interface ListUsersOptions {
  offset?: number;
  limit?: number;
  sort?: 'CreatedOn' | 'Email' | 'Status' | 'LastLogin' | 'UpdatedOn';
}

/**
 * Webflow Users API (Site Memberships)
 */
export class UsersApi {
  constructor(private readonly client: WebflowClient) {}

  /**
   * List all users for a site
   */
  async list(siteId: string, options: ListUsersOptions = {}): Promise<{ users: User[]; count: number; limit: number; offset: number; total: number }> {
    const params: Record<string, string | number | boolean | undefined> = {
      offset: options.offset || 0,
      limit: options.limit || 100,
    };

    if (options.sort) params.sort = options.sort;

    return this.client.request<{ users: User[]; count: number; limit: number; offset: number; total: number }>(
      `/sites/${siteId}/users`,
      { params }
    );
  }

  /**
   * Get a single user by ID
   */
  async get(siteId: string, userId: string): Promise<User> {
    return this.client.request<User>(`/sites/${siteId}/users/${userId}`);
  }

  /**
   * Invite a user to a site
   */
  async invite(siteId: string, user: InviteUserInput): Promise<User> {
    return this.client.request<User>(
      `/sites/${siteId}/users/invite`,
      { method: 'POST', body: user }
    );
  }

  /**
   * Update a user
   */
  async update(siteId: string, userId: string, updates: {
    data?: { name?: string; acceptPrivacy?: boolean; acceptCommunications?: boolean };
    accessGroups?: string[];
  }): Promise<User> {
    return this.client.request<User>(
      `/sites/${siteId}/users/${userId}`,
      { method: 'PATCH', body: updates }
    );
  }

  /**
   * Delete a user from a site
   */
  async delete(siteId: string, userId: string): Promise<void> {
    await this.client.request<void>(
      `/sites/${siteId}/users/${userId}`,
      { method: 'DELETE' }
    );
  }

  /**
   * List access groups for a site
   */
  async listAccessGroups(siteId: string): Promise<{ accessGroups: Array<{ id: string; name: string; shortId: string; slug: string; createdOn: string }> }> {
    return this.client.request<{ accessGroups: Array<{ id: string; name: string; shortId: string; slug: string; createdOn: string }> }>(
      `/sites/${siteId}/accessgroups`
    );
  }
}
