import type { TikTokClient } from './client';
import type {
  Ad,
  AdCreateParams,
  AdUpdateParams,
  AdListParams,
  PaginatedData,
  OperationStatus,
} from '../types';

/**
 * TikTok Ads API
 * Create, read, update, and delete ads
 */
export class AdsApi {
  constructor(private readonly client: TikTokClient) {}

  /**
   * List ads
   * GET /ad/get/
   */
  async list(params: AdListParams): Promise<PaginatedData<Ad>> {
    return this.client.get<PaginatedData<Ad>>('/ad/get/', {
      advertiser_id: params.advertiser_id,
      filtering: params.filtering ? JSON.stringify(params.filtering) : undefined,
      page: params.page,
      page_size: params.page_size,
      fields: params.fields,
    });
  }

  /**
   * Get a single ad by ID
   */
  async get(advertiserId: string, adId: string): Promise<Ad> {
    const response = await this.list({
      advertiser_id: advertiserId,
      filtering: { ad_ids: [adId] },
    });
    if (!response.list || response.list.length === 0) {
      throw new Error(`Ad ${adId} not found`);
    }
    return response.list[0];
  }

  /**
   * Create a new ad
   * POST /ad/create/
   */
  async create(params: AdCreateParams): Promise<{ ad_id: string }> {
    return this.client.post<{ ad_id: string }>('/ad/create/', params);
  }

  /**
   * Update an existing ad
   * POST /ad/update/
   */
  async update(params: AdUpdateParams): Promise<{ ad_id: string }> {
    return this.client.post<{ ad_id: string }>('/ad/update/', params);
  }

  /**
   * Delete ads
   * POST /ad/delete/
   */
  async delete(advertiserId: string, adIds: string[]): Promise<{ ad_ids: string[] }> {
    return this.client.post<{ ad_ids: string[] }>('/ad/delete/', {
      advertiser_id: advertiserId,
      ad_ids: adIds,
    });
  }

  /**
   * Update ad status (enable/disable)
   * POST /ad/status/update/
   */
  async updateStatus(
    advertiserId: string,
    adIds: string[],
    operationStatus: OperationStatus
  ): Promise<{ ad_ids: string[] }> {
    return this.client.post<{ ad_ids: string[] }>('/ad/status/update/', {
      advertiser_id: advertiserId,
      ad_ids: adIds,
      operation_status: operationStatus,
    });
  }

  /**
   * Enable ads
   */
  async enable(advertiserId: string, adIds: string[]): Promise<{ ad_ids: string[] }> {
    return this.updateStatus(advertiserId, adIds, 'ENABLE');
  }

  /**
   * Disable ads
   */
  async disable(advertiserId: string, adIds: string[]): Promise<{ ad_ids: string[] }> {
    return this.updateStatus(advertiserId, adIds, 'DISABLE');
  }

  /**
   * Create ACO (Automated Creative Optimization) ad
   * POST /ad/aco/create/
   */
  async createAco(params: {
    advertiser_id: string;
    adgroup_id: string;
    ad_name: string;
    creatives: Array<{
      ad_text?: string;
      video_id?: string;
      image_ids?: string[];
      call_to_action?: string;
      identity_id?: string;
      identity_type?: string;
    }>;
    call_to_action?: string;
    landing_page_url?: string;
    deeplink?: string;
    display_name?: string;
    profile_image?: string;
    identity_id?: string;
    identity_type?: string;
  }): Promise<{ ad_id: string }> {
    return this.client.post<{ ad_id: string }>('/ad/aco/create/', params);
  }

  /**
   * Get ad preview
   * GET /ad/preview/
   */
  async getPreview(advertiserId: string, adId: string): Promise<{
    preview_link: string;
    preview_type: string;
  }> {
    return this.client.get('/ad/preview/', {
      advertiser_id: advertiserId,
      ad_id: adId,
    });
  }

  /**
   * Get ad review status and rejection reasons
   * GET /ad/review_info/
   */
  async getReviewInfo(advertiserId: string, adIds: string[]): Promise<{
    list: Array<{
      ad_id: string;
      review_status: string;
      reject_reason?: string;
    }>;
  }> {
    return this.client.get('/ad/review_info/', {
      advertiser_id: advertiserId,
      ad_ids: adIds,
    });
  }
}
