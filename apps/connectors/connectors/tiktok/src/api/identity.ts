import type { TikTokClient } from './client';
import type { TikTokIdentity, SparkAdPost, IdentityCreateParams, PaginatedData } from '../types';

/**
 * TikTok Identity API
 * Manage TikTok accounts/identities for Spark Ads
 */
export class IdentityApi {
  constructor(private readonly client: TikTokClient) {}

  // ============================================
  // Identity Management
  // ============================================

  /**
   * List identities
   * GET /identity/get/
   */
  async list(advertiserId: string, params?: {
    filtering?: {
      identity_ids?: string[];
      identity_type?: 'CUSTOMIZED_USER' | 'AUTH_CODE' | 'TT_USER' | 'BC_AUTH_TT';
    };
    page?: number;
    page_size?: number;
  }): Promise<PaginatedData<TikTokIdentity>> {
    return this.client.get<PaginatedData<TikTokIdentity>>('/identity/get/', {
      advertiser_id: advertiserId,
      filtering: params?.filtering ? JSON.stringify(params.filtering) : undefined,
      page: params?.page,
      page_size: params?.page_size,
    });
  }

  /**
   * Get a single identity by ID
   */
  async get(advertiserId: string, identityId: string): Promise<TikTokIdentity> {
    const response = await this.list(advertiserId, {
      filtering: { identity_ids: [identityId] },
    });
    if (!response.list || response.list.length === 0) {
      throw new Error(`Identity ${identityId} not found`);
    }
    return response.list[0];
  }

  /**
   * Create a customized identity (for non-Spark Ads)
   * POST /identity/create/
   */
  async create(params: IdentityCreateParams): Promise<{ identity_id: string }> {
    return this.client.post<{ identity_id: string }>('/identity/create/', params);
  }

  /**
   * Update identity display name or profile image
   * POST /identity/update/
   */
  async update(params: {
    advertiser_id: string;
    identity_id: string;
    display_name?: string;
    profile_image?: string;
  }): Promise<{ identity_id: string }> {
    return this.client.post<{ identity_id: string }>('/identity/update/', params);
  }

  // ============================================
  // Spark Ads Authorization
  // ============================================

  /**
   * Generate authorization code for Spark Ads
   * POST /tt_video/authorize/
   */
  async generateAuthCode(params: {
    advertiser_id: string;
    tiktok_item_ids: string[];
  }): Promise<{
    auth_codes: Array<{
      tiktok_item_id: string;
      auth_code: string;
      expire_time: string;
    }>;
  }> {
    return this.client.post('/tt_video/authorize/', params);
  }

  /**
   * Get authorization info for a TikTok post
   * GET /tt_video/info/
   */
  async getAuthInfo(advertiserId: string, authCode: string): Promise<{
    tiktok_item_id: string;
    auth_code: string;
    identity_id: string;
    identity_type: string;
    display_name: string;
    profile_image: string;
    video_info: {
      video_id: string;
      video_cover_url: string;
      duration: number;
    };
    is_valid: boolean;
    expire_time: string;
  }> {
    return this.client.get('/tt_video/info/', {
      advertiser_id: advertiserId,
      auth_code: authCode,
    });
  }

  /**
   * Revoke Spark Ads authorization
   * POST /tt_video/revoke/
   */
  async revokeAuth(advertiserId: string, authCodes: string[]): Promise<{
    revoked_auth_codes: string[];
    failed_auth_codes?: Array<{
      auth_code: string;
      error_message: string;
    }>;
  }> {
    return this.client.post('/tt_video/revoke/', {
      advertiser_id: advertiserId,
      auth_codes: authCodes,
    });
  }

  // ============================================
  // Spark Ad Posts
  // ============================================

  /**
   * List authorized Spark Ad posts
   * GET /spark_ad/get/
   */
  async listSparkAdPosts(advertiserId: string, params?: {
    filtering?: {
      item_ids?: string[];
      identity_ids?: string[];
    };
    page?: number;
    page_size?: number;
  }): Promise<PaginatedData<SparkAdPost>> {
    return this.client.get<PaginatedData<SparkAdPost>>('/spark_ad/get/', {
      advertiser_id: advertiserId,
      filtering: params?.filtering ? JSON.stringify(params.filtering) : undefined,
      page: params?.page,
      page_size: params?.page_size,
    });
  }

  /**
   * Search TikTok posts available for Spark Ads
   * GET /tt_video/search/
   */
  async searchPosts(advertiserId: string, params?: {
    username?: string;
    hashtag?: string;
    page?: number;
    page_size?: number;
  }): Promise<PaginatedData<{
    tiktok_item_id: string;
    video_cover_url: string;
    video_url: string;
    description: string;
    create_time: string;
    author: {
      username: string;
      display_name: string;
      avatar_url: string;
    };
    stats: {
      likes: number;
      comments: number;
      shares: number;
      views: number;
    };
  }>> {
    return this.client.get('/tt_video/search/', {
      advertiser_id: advertiserId,
      username: params?.username,
      hashtag: params?.hashtag,
      page: params?.page,
      page_size: params?.page_size,
    });
  }

  // ============================================
  // Business Account Authorization (BC Auth TT)
  // ============================================

  /**
   * List TikTok accounts authorized to Business Center
   * GET /bc/tiktok_account/get/
   */
  async listBcAuthorizedAccounts(bcId: string, params?: {
    page?: number;
    page_size?: number;
  }): Promise<PaginatedData<{
    identity_id: string;
    tiktok_account_id: string;
    tiktok_username: string;
    display_name: string;
    avatar_url: string;
    authorization_status: string;
    authorized_time: string;
  }>> {
    return this.client.get('/bc/tiktok_account/get/', {
      bc_id: bcId,
      page: params?.page,
      page_size: params?.page_size,
    });
  }

  /**
   * Get TikTok account posts authorized to Business Center
   * GET /bc/tiktok_account/video/get/
   */
  async listBcAuthorizedPosts(bcId: string, identityId: string, params?: {
    page?: number;
    page_size?: number;
  }): Promise<PaginatedData<{
    tiktok_item_id: string;
    video_cover_url: string;
    description: string;
    create_time: string;
    is_authorized_for_ads: boolean;
  }>> {
    return this.client.get('/bc/tiktok_account/video/get/', {
      bc_id: bcId,
      identity_id: identityId,
      page: params?.page,
      page_size: params?.page_size,
    });
  }

  /**
   * Share BC authorized TikTok account to advertiser
   * POST /bc/tiktok_account/share/
   */
  async shareBcAccountToAdvertiser(params: {
    bc_id: string;
    identity_id: string;
    advertiser_ids: string[];
  }): Promise<{
    identity_id: string;
    shared_advertiser_ids: string[];
  }> {
    return this.client.post('/bc/tiktok_account/share/', params);
  }
}
