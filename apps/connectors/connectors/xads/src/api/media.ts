import type { XAdsClient } from './client';
import type {
  MediaCreative,
  CreateMediaCreativeParams,
  ListResponse,
  PaginationParams,
} from '../types';

/**
 * Media Creatives API
 */
export class MediaApi {
  constructor(private client: XAdsClient) {}

  /**
   * List all media creatives for an account
   */
  async list(
    accountId: string,
    params?: PaginationParams & {
      media_creative_ids?: string[];
      line_item_ids?: string[];
    }
  ): Promise<ListResponse<MediaCreative>> {
    return this.client.get<ListResponse<MediaCreative>>(
      `/accounts/${accountId}/media_creatives`,
      {
        cursor: params?.cursor,
        count: params?.count,
        with_deleted: params?.with_deleted,
        with_total_count: params?.with_total_count,
        media_creative_ids: params?.media_creative_ids?.join(','),
        line_item_ids: params?.line_item_ids?.join(','),
      }
    );
  }

  /**
   * Get a specific media creative
   */
  async get(
    accountId: string,
    mediaCreativeId: string,
    withDeleted?: boolean
  ): Promise<{ data: MediaCreative }> {
    return this.client.get<{ data: MediaCreative }>(
      `/accounts/${accountId}/media_creatives/${mediaCreativeId}`,
      { with_deleted: withDeleted }
    );
  }

  /**
   * Create a media creative
   */
  async create(
    accountId: string,
    params: CreateMediaCreativeParams
  ): Promise<{ data: MediaCreative }> {
    return this.client.post<{ data: MediaCreative }>(
      `/accounts/${accountId}/media_creatives`,
      {
        line_item_id: params.line_item_id,
        media_key: params.media_key,
        landing_url: params.landing_url,
      }
    );
  }

  /**
   * Delete a media creative
   */
  async delete(accountId: string, mediaCreativeId: string): Promise<{ data: MediaCreative }> {
    return this.client.delete<{ data: MediaCreative }>(
      `/accounts/${accountId}/media_creatives/${mediaCreativeId}`
    );
  }

  /**
   * Get media library (uploaded media)
   */
  async getLibrary(
    accountId: string,
    params?: PaginationParams & {
      media_type?: 'IMAGE' | 'VIDEO' | 'GIF';
    }
  ): Promise<ListResponse<{ media_key: string; media_type: string; media_url: string }>> {
    return this.client.get<ListResponse<{ media_key: string; media_type: string; media_url: string }>>(
      `/accounts/${accountId}/media_library`,
      {
        cursor: params?.cursor,
        count: params?.count,
        media_type: params?.media_type,
      }
    );
  }
}
