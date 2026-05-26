import { NotionClient } from './client';
import type { NotionUser, PaginatedResponse } from '../types';

export class UsersApi {
  constructor(private readonly client: NotionClient) {}

  /**
   * Retrieve a user by ID
   * https://developers.notion.com/reference/get-user
   */
  async get(userId: string): Promise<NotionUser> {
    return this.client.get<NotionUser>(`/users/${userId}`);
  }

  /**
   * List all users
   * https://developers.notion.com/reference/get-users
   */
  async list(
    startCursor?: string,
    pageSize: number = 100
  ): Promise<PaginatedResponse<NotionUser>> {
    const params: Record<string, string | number | boolean | undefined> = {};
    if (startCursor) {
      params.start_cursor = startCursor;
    }
    if (pageSize) {
      params.page_size = pageSize;
    }

    return this.client.get<PaginatedResponse<NotionUser>>('/users', params);
  }

  /**
   * Retrieve the bot user (authenticated user/integration)
   * https://developers.notion.com/reference/get-self
   */
  async me(): Promise<NotionUser> {
    return this.client.get<NotionUser>('/users/me');
  }

  // ============================================
  // Helper Methods
  // ============================================

  /**
   * Get all users (handles pagination)
   */
  async listAll(): Promise<NotionUser[]> {
    const allUsers: NotionUser[] = [];
    let cursor: string | undefined;

    do {
      const response = await this.list(cursor, 100);
      allUsers.push(...response.results);
      cursor = response.has_more && response.next_cursor ? response.next_cursor : undefined;
    } while (cursor);

    return allUsers;
  }

  /**
   * Find users by name (case-insensitive partial match)
   */
  async findByName(name: string): Promise<NotionUser[]> {
    const allUsers = await this.listAll();
    const lowerName = name.toLowerCase();
    return allUsers.filter(
      user => user.name?.toLowerCase().includes(lowerName)
    );
  }

  /**
   * Find user by email (exact match, only works for person type)
   */
  async findByEmail(email: string): Promise<NotionUser | undefined> {
    const allUsers = await this.listAll();
    const lowerEmail = email.toLowerCase();
    return allUsers.find(
      user => user.type === 'person' && user.person?.email?.toLowerCase() === lowerEmail
    );
  }

  /**
   * Get all person users (not bots)
   */
  async listPeople(): Promise<NotionUser[]> {
    const allUsers = await this.listAll();
    return allUsers.filter(user => user.type === 'person');
  }

  /**
   * Get all bot users
   */
  async listBots(): Promise<NotionUser[]> {
    const allUsers = await this.listAll();
    return allUsers.filter(user => user.type === 'bot');
  }
}
