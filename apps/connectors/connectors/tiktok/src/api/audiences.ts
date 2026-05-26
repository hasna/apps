import type { TikTokClient } from './client';
import type {
  Audience,
  AudienceCreateParams,
  AudienceUpdateParams,
  AudienceListParams,
  LookalikeSpec,
  PaginatedData,
} from '../types';

/**
 * TikTok Audiences API
 * Create and manage custom audiences and lookalike audiences
 */
export class AudiencesApi {
  constructor(private readonly client: TikTokClient) {}

  /**
   * List audiences
   * GET /dmp/custom_audience/get/
   */
  async list(params: AudienceListParams): Promise<PaginatedData<Audience>> {
    return this.client.get<PaginatedData<Audience>>('/dmp/custom_audience/get/', {
      advertiser_id: params.advertiser_id,
      custom_audience_ids: params.filtering?.audience_ids,
      page: params.page,
      page_size: params.page_size,
    });
  }

  /**
   * Get a single audience by ID
   */
  async get(advertiserId: string, audienceId: string): Promise<Audience> {
    const response = await this.list({
      advertiser_id: advertiserId,
      filtering: { audience_ids: [audienceId] },
    });
    if (!response.list || response.list.length === 0) {
      throw new Error(`Audience ${audienceId} not found`);
    }
    return response.list[0];
  }

  /**
   * Create a custom audience from customer file
   * POST /dmp/custom_audience/file/upload/
   */
  async createFromFile(params: {
    advertiser_id: string;
    audience_name: string;
    file_paths: string[];
    calculate_type?: 'DMP_CUSTOMER_FILE_TYPE_PHONE' | 'DMP_CUSTOMER_FILE_TYPE_EMAIL' | 'DMP_CUSTOMER_FILE_TYPE_IDFA' | 'DMP_CUSTOMER_FILE_TYPE_GAID';
    retention_in_days?: number;
  }): Promise<{ custom_audience_id: string }> {
    return this.client.post<{ custom_audience_id: string }>('/dmp/custom_audience/file/upload/', {
      advertiser_id: params.advertiser_id,
      custom_audience_name: params.audience_name,
      file_paths: params.file_paths,
      calculate_type: params.calculate_type,
      retention_in_days: params.retention_in_days,
    });
  }

  /**
   * Create a custom audience from rules (engagement, website traffic, etc.)
   * POST /dmp/custom_audience/rule/create/
   */
  async createFromRules(params: {
    advertiser_id: string;
    audience_name: string;
    custom_audience_type: string;
    retention_in_days?: number;
    rule?: {
      inclusions?: Array<{
        operator: string;
        rules: Array<{
          event_source: string;
          event_type: string;
          retention_days: number;
          filter_set?: {
            filters: Array<{
              field: string;
              operator: string;
              value: string;
            }>;
            operator: string;
          };
        }>;
      }>;
      exclusions?: Array<{
        operator: string;
        rules: Array<{
          event_source: string;
          event_type: string;
          retention_days: number;
        }>;
      }>;
    };
    identity_type?: string;
    identity_authorized_bc_id?: string;
  }): Promise<{ custom_audience_id: string }> {
    return this.client.post<{ custom_audience_id: string }>('/dmp/custom_audience/rule/create/', {
      advertiser_id: params.advertiser_id,
      custom_audience_name: params.audience_name,
      custom_audience_type: params.custom_audience_type,
      retention_in_days: params.retention_in_days,
      rule: params.rule,
      identity_type: params.identity_type,
      identity_authorized_bc_id: params.identity_authorized_bc_id,
    });
  }

  /**
   * Create a lookalike audience
   * POST /dmp/custom_audience/lookalike/create/
   */
  async createLookalike(params: {
    advertiser_id: string;
    audience_name: string;
    source_audience_id: string;
    lookalike_spec: LookalikeSpec;
  }): Promise<{ custom_audience_id: string }> {
    return this.client.post<{ custom_audience_id: string }>('/dmp/custom_audience/lookalike/create/', {
      advertiser_id: params.advertiser_id,
      custom_audience_name: params.audience_name,
      source_custom_audience_id: params.source_audience_id,
      lookalike_spec: params.lookalike_spec,
    });
  }

  /**
   * Update a custom audience
   * POST /dmp/custom_audience/update/
   */
  async update(params: AudienceUpdateParams): Promise<{ custom_audience_id: string }> {
    return this.client.post<{ custom_audience_id: string }>('/dmp/custom_audience/update/', {
      advertiser_id: params.advertiser_id,
      custom_audience_id: params.audience_id,
      custom_audience_name: params.audience_name,
      action: params.action,
      file_paths: params.file_paths,
    });
  }

  /**
   * Delete audiences
   * POST /dmp/custom_audience/delete/
   */
  async delete(advertiserId: string, audienceIds: string[]): Promise<{ custom_audience_ids: string[] }> {
    return this.client.post<{ custom_audience_ids: string[] }>('/dmp/custom_audience/delete/', {
      advertiser_id: advertiserId,
      custom_audience_ids: audienceIds,
    });
  }

  /**
   * Share audience to Business Center
   * POST /dmp/custom_audience/share/
   */
  async share(params: {
    advertiser_id: string;
    audience_id: string;
    target_bc_ids: string[];
  }): Promise<{ custom_audience_id: string }> {
    return this.client.post<{ custom_audience_id: string }>('/dmp/custom_audience/share/', {
      advertiser_id: params.advertiser_id,
      custom_audience_id: params.audience_id,
      contextual_tag_ids: params.target_bc_ids,
    });
  }

  /**
   * Get audience size estimation
   * GET /dmp/custom_audience/coverage/
   */
  async getCoverage(advertiserId: string, audienceIds: string[]): Promise<{
    list: Array<{
      custom_audience_id: string;
      coverage: number;
    }>;
  }> {
    return this.client.get('/dmp/custom_audience/coverage/', {
      advertiser_id: advertiserId,
      custom_audience_ids: audienceIds,
    });
  }

  // ============================================
  // Saved Audiences
  // ============================================

  /**
   * List saved audiences
   * GET /dmp/saved_audience/get/
   */
  async listSavedAudiences(
    advertiserId: string,
    params?: {
      filtering?: {
        saved_audience_ids?: string[];
      };
      page?: number;
      page_size?: number;
    }
  ): Promise<PaginatedData<{
    saved_audience_id: string;
    saved_audience_name: string;
    targeting: Record<string, unknown>;
    create_time: string;
    modify_time: string;
  }>> {
    return this.client.get('/dmp/saved_audience/get/', {
      advertiser_id: advertiserId,
      filtering: params?.filtering ? JSON.stringify(params.filtering) : undefined,
      page: params?.page,
      page_size: params?.page_size,
    });
  }

  /**
   * Create a saved audience
   * POST /dmp/saved_audience/create/
   */
  async createSavedAudience(params: {
    advertiser_id: string;
    saved_audience_name: string;
    targeting: Record<string, unknown>;
  }): Promise<{ saved_audience_id: string }> {
    return this.client.post<{ saved_audience_id: string }>('/dmp/saved_audience/create/', params);
  }

  /**
   * Delete saved audiences
   * POST /dmp/saved_audience/delete/
   */
  async deleteSavedAudiences(
    advertiserId: string,
    savedAudienceIds: string[]
  ): Promise<{ saved_audience_ids: string[] }> {
    return this.client.post<{ saved_audience_ids: string[] }>('/dmp/saved_audience/delete/', {
      advertiser_id: advertiserId,
      saved_audience_ids: savedAudienceIds,
    });
  }
}
