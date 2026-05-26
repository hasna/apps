import type { XAdsClient } from './client';
import type {
  TailoredAudience,
  CreateTailoredAudienceParams,
  ListResponse,
  PaginationParams,
} from '../types';

/**
 * Tailored Audiences (Custom Audiences) API
 */
export class AudiencesApi {
  constructor(private client: XAdsClient) {}

  /**
   * List all tailored audiences for an account
   */
  async list(
    accountId: string,
    params?: PaginationParams & {
      tailored_audience_ids?: string[];
    }
  ): Promise<ListResponse<TailoredAudience>> {
    return this.client.get<ListResponse<TailoredAudience>>(
      `/accounts/${accountId}/tailored_audiences`,
      {
        cursor: params?.cursor,
        count: params?.count,
        with_deleted: params?.with_deleted,
        with_total_count: params?.with_total_count,
        tailored_audience_ids: params?.tailored_audience_ids?.join(','),
      }
    );
  }

  /**
   * Get a specific tailored audience
   */
  async get(
    accountId: string,
    audienceId: string,
    withDeleted?: boolean
  ): Promise<{ data: TailoredAudience }> {
    return this.client.get<{ data: TailoredAudience }>(
      `/accounts/${accountId}/tailored_audiences/${audienceId}`,
      { with_deleted: withDeleted }
    );
  }

  /**
   * Create a new tailored audience
   */
  async create(
    accountId: string,
    params: CreateTailoredAudienceParams
  ): Promise<{ data: TailoredAudience }> {
    return this.client.post<{ data: TailoredAudience }>(
      `/accounts/${accountId}/tailored_audiences`,
      {
        name: params.name,
        list_type: params.list_type,
      }
    );
  }

  /**
   * Delete a tailored audience
   */
  async delete(accountId: string, audienceId: string): Promise<{ data: TailoredAudience }> {
    return this.client.delete<{ data: TailoredAudience }>(
      `/accounts/${accountId}/tailored_audiences/${audienceId}`
    );
  }

  /**
   * Get users for a tailored audience (for lookup)
   */
  async getUsers(
    accountId: string,
    audienceId: string
  ): Promise<{ data: { users_count: number } }> {
    return this.client.get<{ data: { users_count: number } }>(
      `/accounts/${accountId}/tailored_audiences/${audienceId}/users`
    );
  }

  /**
   * Add users to a tailored audience
   * Note: Users should be hashed before sending
   */
  async addUsers(
    accountId: string,
    audienceId: string,
    users: string[],
    listType: 'EMAIL' | 'DEVICE_ID' | 'TWITTER_ID' | 'HANDLE' | 'PHONE_NUMBER'
  ): Promise<{ data: { success_count: number; total_count: number } }> {
    return this.client.post<{ data: { success_count: number; total_count: number } }>(
      `/accounts/${accountId}/tailored_audiences/${audienceId}/users`,
      {
        operation_type: 'Update',
        users,
        list_type: listType,
      }
    );
  }

  /**
   * Remove users from a tailored audience
   */
  async removeUsers(
    accountId: string,
    audienceId: string,
    users: string[],
    listType: 'EMAIL' | 'DEVICE_ID' | 'TWITTER_ID' | 'HANDLE' | 'PHONE_NUMBER'
  ): Promise<{ data: { success_count: number; total_count: number } }> {
    return this.client.post<{ data: { success_count: number; total_count: number } }>(
      `/accounts/${accountId}/tailored_audiences/${audienceId}/users`,
      {
        operation_type: 'Delete',
        users,
        list_type: listType,
      }
    );
  }

  /**
   * Create a lookalike audience from an existing audience
   */
  async createLookalike(
    accountId: string,
    sourceAudienceId: string,
    name: string
  ): Promise<{ data: TailoredAudience }> {
    return this.client.post<{ data: TailoredAudience }>(
      `/accounts/${accountId}/tailored_audiences`,
      {
        name,
        tailored_audience_type: 'LOOKALIKE',
        source_audience_id: sourceAudienceId,
      }
    );
  }
}
