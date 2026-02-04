import type { ZoomClient } from './client';
import type {
  ZoomUser,
  ZoomUserListResponse,
  ZoomMeResponse,
} from '../types';

/**
 * Zoom Users API
 */
export class UsersApi {
  private readonly client: ZoomClient;

  constructor(client: ZoomClient) {
    this.client = client;
  }

  /**
   * Get the current user's info (the user who owns the OAuth app)
   */
  async getMe(): Promise<ZoomMeResponse> {
    return this.client.request<ZoomMeResponse>('/users/me');
  }

  /**
   * Get a specific user's info
   */
  async getUser(userId: string): Promise<ZoomUser> {
    return this.client.request<ZoomUser>(`/users/${encodeURIComponent(userId)}`);
  }

  /**
   * List users in the account
   */
  async listUsers(options: {
    status?: 'active' | 'inactive' | 'pending';
    pageSize?: number;
    pageNumber?: number;
    nextPageToken?: string;
    roleId?: string;
  } = {}): Promise<ZoomUserListResponse> {
    return this.client.request<ZoomUserListResponse>('/users', {
      params: {
        status: options.status,
        page_size: options.pageSize,
        page_number: options.pageNumber,
        next_page_token: options.nextPageToken,
        role_id: options.roleId,
      },
    });
  }
}
