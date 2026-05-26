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

  /**
   * Create a user
   */
  async createUser(options: {
    action: 'create' | 'autoCreate' | 'custCreate' | 'ssoCreate';
    userInfo: {
      email: string;
      type: 1 | 2 | 3;
      firstName?: string;
      lastName?: string;
      displayName?: string;
      password?: string;
    };
  }): Promise<ZoomUser> {
    return this.client.request<ZoomUser>('/users', {
      method: 'POST',
      body: options,
    });
  }

  /**
   * Update a user's profile
   */
  async updateUser(
    userId: string,
    data: {
      firstName?: string;
      lastName?: string;
      type?: 1 | 2 | 3;
      timezone?: string;
      language?: string;
      dept?: string;
      jobTitle?: string;
      company?: string;
    }
  ): Promise<void> {
    await this.client.request(`/users/${userId}`, {
      method: 'PATCH',
      body: data,
    });
  }

  /**
   * Delete a user
   */
  async deleteUser(
    userId: string,
    options?: {
      action?: 'disassociate' | 'delete';
      transferEmail?: string;
      transferMeetings?: boolean;
      transferWebinars?: boolean;
      transferRecordings?: boolean;
    }
  ): Promise<void> {
    await this.client.request(`/users/${userId}`, {
      method: 'DELETE',
      params: {
        action: options?.action,
        transfer_email: options?.transferEmail,
        transfer_meetings: options?.transferMeetings,
        transfer_webinars: options?.transferWebinars,
        transfer_recordings: options?.transferRecordings,
      },
    });
  }

  /**
   * Get a user's settings
   */
  async getUserSettings(userId: string): Promise<Record<string, unknown>> {
    return this.client.request<Record<string, unknown>>(`/users/${userId}/settings`);
  }

  /**
   * Update a user's settings
   */
  async updateUserSettings(
    userId: string,
    settings: Record<string, unknown>
  ): Promise<void> {
    await this.client.request(`/users/${userId}/settings`, {
      method: 'PATCH',
      body: settings,
    });
  }

  /**
   * Get a user's presence status
   */
  async getPresenceStatus(userId: string): Promise<{ presence_status: string }> {
    return this.client.request<{ presence_status: string }>(`/users/${userId}/presence_status`);
  }
}