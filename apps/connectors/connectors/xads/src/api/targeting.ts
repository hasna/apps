import type { XAdsClient } from './client';
import type {
  TargetingCriteria,
  CreateTargetingParams,
  ListResponse,
  PaginationParams,
  TargetingType,
} from '../types';

/**
 * Targeting Criteria API
 */
export class TargetingApi {
  constructor(private client: XAdsClient) {}

  /**
   * List all targeting criteria for an account
   */
  async list(
    accountId: string,
    params?: PaginationParams & {
      targeting_criterion_ids?: string[];
      line_item_ids?: string[];
    }
  ): Promise<ListResponse<TargetingCriteria>> {
    return this.client.get<ListResponse<TargetingCriteria>>(
      `/accounts/${accountId}/targeting_criteria`,
      {
        cursor: params?.cursor,
        count: params?.count,
        with_deleted: params?.with_deleted,
        with_total_count: params?.with_total_count,
        targeting_criterion_ids: params?.targeting_criterion_ids?.join(','),
        line_item_ids: params?.line_item_ids?.join(','),
      }
    );
  }

  /**
   * Get a specific targeting criterion
   */
  async get(
    accountId: string,
    targetingCriterionId: string,
    withDeleted?: boolean
  ): Promise<{ data: TargetingCriteria }> {
    return this.client.get<{ data: TargetingCriteria }>(
      `/accounts/${accountId}/targeting_criteria/${targetingCriterionId}`,
      { with_deleted: withDeleted }
    );
  }

  /**
   * Create targeting criteria
   */
  async create(
    accountId: string,
    params: CreateTargetingParams
  ): Promise<{ data: TargetingCriteria }> {
    return this.client.post<{ data: TargetingCriteria }>(
      `/accounts/${accountId}/targeting_criteria`,
      {
        line_item_id: params.line_item_id,
        targeting_type: params.targeting_type,
        targeting_value: params.targeting_value,
        tailored_audience_expansion: params.tailored_audience_expansion,
      }
    );
  }

  /**
   * Delete targeting criteria
   */
  async delete(
    accountId: string,
    targetingCriterionId: string
  ): Promise<{ data: TargetingCriteria }> {
    return this.client.delete<{ data: TargetingCriteria }>(
      `/accounts/${accountId}/targeting_criteria/${targetingCriterionId}`
    );
  }

  /**
   * Get available targeting options for a specific type
   */
  async getOptions(
    accountId: string,
    targetingType: TargetingType,
    params?: { q?: string; count?: number }
  ): Promise<ListResponse<{ targeting_value: string; name: string }>> {
    const endpoint = this.getTargetingOptionsEndpoint(targetingType);
    return this.client.get<ListResponse<{ targeting_value: string; name: string }>>(
      `/accounts/${accountId}/${endpoint}`,
      { q: params?.q, count: params?.count }
    );
  }

  private getTargetingOptionsEndpoint(type: TargetingType): string {
    const endpoints: Record<string, string> = {
      LOCATION: 'targeting_criteria/locations',
      INTEREST: 'targeting_criteria/interests',
      PLATFORM: 'targeting_criteria/platforms',
      PLATFORM_VERSION: 'targeting_criteria/platform_versions',
      DEVICE: 'targeting_criteria/devices',
      NETWORK_OPERATOR: 'targeting_criteria/network_operators',
      LANGUAGE: 'targeting_criteria/languages',
      TV_CHANNEL: 'targeting_criteria/tv_channels',
      TV_GENRE: 'targeting_criteria/tv_genres',
      TV_SHOW: 'targeting_criteria/tv_shows',
      EVENT: 'targeting_criteria/events',
      BEHAVIOR: 'targeting_criteria/behaviors',
      CONVERSATION: 'targeting_criteria/conversations',
    };
    return endpoints[type] || `targeting_criteria/${type.toLowerCase()}s`;
  }

  /**
   * Search for locations
   */
  async searchLocations(
    accountId: string,
    query: string,
    count?: number
  ): Promise<ListResponse<{ targeting_value: string; name: string; targeting_type: string }>> {
    return this.client.get<ListResponse<{ targeting_value: string; name: string; targeting_type: string }>>(
      `/accounts/${accountId}/targeting_criteria/locations`,
      { q: query, count }
    );
  }

  /**
   * Get interests
   */
  async getInterests(
    accountId: string,
    count?: number
  ): Promise<ListResponse<{ targeting_value: string; name: string }>> {
    return this.client.get<ListResponse<{ targeting_value: string; name: string }>>(
      `/accounts/${accountId}/targeting_criteria/interests`,
      { count }
    );
  }

  /**
   * Get platforms
   */
  async getPlatforms(
    accountId: string
  ): Promise<ListResponse<{ targeting_value: string; name: string }>> {
    return this.client.get<ListResponse<{ targeting_value: string; name: string }>>(
      `/accounts/${accountId}/targeting_criteria/platforms`
    );
  }

  /**
   * Get languages
   */
  async getLanguages(
    accountId: string
  ): Promise<ListResponse<{ targeting_value: string; name: string }>> {
    return this.client.get<ListResponse<{ targeting_value: string; name: string }>>(
      `/accounts/${accountId}/targeting_criteria/languages`
    );
  }
}
