import type { MetaClient } from './client';
import type {
  CustomAudience,
  CustomAudienceCreateParams,
  CustomAudienceUpdateParams,
  CustomAudienceAddUsersParams,
  CustomAudienceListParams,
  SavedAudience,
  PaginatedResponse,
} from '../types';
import { formatAdAccountId } from '../utils/config';

const DEFAULT_CUSTOM_AUDIENCE_FIELDS = [
  'id',
  'account_id',
  'name',
  'description',
  'subtype',
  'approximate_count_lower_bound',
  'approximate_count_upper_bound',
  'customer_file_source',
  'data_source',
  'delivery_status',
  'is_value_based',
  'lookalike_spec',
  'operation_status',
  'permission_for_actions',
  'pixel_id',
  'retention_days',
  'time_created',
  'time_updated',
];

const DEFAULT_SAVED_AUDIENCE_FIELDS = [
  'id',
  'account_id',
  'name',
  'description',
  'approximate_count_lower_bound',
  'approximate_count_upper_bound',
  'run_status',
  'sentence_lines',
  'targeting',
  'time_created',
  'time_updated',
];

/**
 * Meta Audiences API
 * Create and manage custom audiences, lookalike audiences, and saved audiences
 */
export class AudiencesApi {
  constructor(private readonly client: MetaClient) {}

  // ============================================
  // Custom Audiences
  // ============================================

  /**
   * List custom audiences for an ad account
   */
  async list(adAccountId: string, params?: CustomAudienceListParams): Promise<PaginatedResponse<CustomAudience>> {
    const formattedId = formatAdAccountId(adAccountId);
    const fields = params?.fields || DEFAULT_CUSTOM_AUDIENCE_FIELDS;

    return this.client.get<PaginatedResponse<CustomAudience>>(`/${formattedId}/customaudiences`, {
      fields: fields.join(','),
      limit: params?.limit,
      after: params?.after,
      before: params?.before,
    });
  }

  /**
   * Get a single custom audience by ID
   */
  async get(audienceId: string, fields?: string[]): Promise<CustomAudience> {
    return this.client.get<CustomAudience>(`/${audienceId}`, {
      fields: (fields || DEFAULT_CUSTOM_AUDIENCE_FIELDS).join(','),
    });
  }

  /**
   * Create a new custom audience
   */
  async create(adAccountId: string, params: CustomAudienceCreateParams): Promise<{ id: string }> {
    const formattedId = formatAdAccountId(adAccountId);

    const body: Record<string, unknown> = {
      name: params.name,
      description: params.description,
      subtype: params.subtype || 'CUSTOM',
      customer_file_source: params.customer_file_source,
      prefill: params.prefill,
      pixel_id: params.pixel_id,
      retention_days: params.retention_days,
    };

    if (params.lookalike_spec) {
      body.lookalike_spec = JSON.stringify(params.lookalike_spec);
    }

    if (params.rule) {
      body.rule = params.rule;
    }

    return this.client.post<{ id: string }>(`/${formattedId}/customaudiences`, body);
  }

  /**
   * Update a custom audience
   */
  async update(audienceId: string, params: CustomAudienceUpdateParams): Promise<{ success: boolean }> {
    return this.client.post<{ success: boolean }>(`/${audienceId}`, params as Record<string, unknown>);
  }

  /**
   * Delete a custom audience
   */
  async delete(audienceId: string): Promise<{ success: boolean }> {
    return this.client.delete<{ success: boolean }>(`/${audienceId}`);
  }

  /**
   * Add users to a custom audience
   */
  async addUsers(audienceId: string, params: CustomAudienceAddUsersParams): Promise<{
    audience_id: string;
    num_received: number;
    num_invalid_entries: number;
    invalid_entry_samples?: Record<string, string[]>;
  }> {
    const body: Record<string, unknown> = {
      payload: JSON.stringify({
        schema: params.schema,
        data: params.data,
      }),
    };

    if (params.app_ids) {
      body.app_ids = JSON.stringify(params.app_ids);
    }

    if (params.is_raw !== undefined) {
      body.is_raw = params.is_raw;
    }

    return this.client.post<{
      audience_id: string;
      num_received: number;
      num_invalid_entries: number;
      invalid_entry_samples?: Record<string, string[]>;
    }>(`/${audienceId}/users`, body);
  }

  /**
   * Remove users from a custom audience
   */
  async removeUsers(audienceId: string, params: CustomAudienceAddUsersParams): Promise<{
    audience_id: string;
    num_received: number;
    num_invalid_entries: number;
  }> {
    const body: Record<string, unknown> = {
      payload: JSON.stringify({
        schema: params.schema,
        data: params.data,
      }),
    };

    return this.client.delete<{
      audience_id: string;
      num_received: number;
      num_invalid_entries: number;
    }>(`/${audienceId}/users`, body as Record<string, string | number | boolean | string[] | undefined>);
  }

  /**
   * Share a custom audience with another ad account
   */
  async share(audienceId: string, adAccountIds: string[]): Promise<{ success: boolean }> {
    return this.client.post<{ success: boolean }>(`/${audienceId}/adaccounts`, {
      adaccounts: adAccountIds.map(formatAdAccountId),
    });
  }

  // ============================================
  // Lookalike Audiences
  // ============================================

  /**
   * Create a lookalike audience from an existing custom audience
   */
  async createLookalike(adAccountId: string, params: {
    name: string;
    originAudienceId: string;
    country: string;
    ratio: number;
    startingRatio?: number;
  }): Promise<{ id: string }> {
    const formattedId = formatAdAccountId(adAccountId);

    return this.client.post<{ id: string }>(`/${formattedId}/customaudiences`, {
      name: params.name,
      subtype: 'LOOKALIKE',
      lookalike_spec: JSON.stringify({
        origin_audience_id: params.originAudienceId,
        country: params.country,
        ratio: params.ratio,
        starting_ratio: params.startingRatio,
      }),
    });
  }

  /**
   * Create a lookalike audience with multiple countries
   */
  async createMultiCountryLookalike(adAccountId: string, params: {
    name: string;
    originAudienceId: string;
    targetCountries: string[];
    ratio: number;
  }): Promise<{ id: string }> {
    const formattedId = formatAdAccountId(adAccountId);

    return this.client.post<{ id: string }>(`/${formattedId}/customaudiences`, {
      name: params.name,
      subtype: 'LOOKALIKE',
      lookalike_spec: JSON.stringify({
        origin_audience_id: params.originAudienceId,
        target_countries: params.targetCountries,
        ratio: params.ratio,
        type: 'similarity',
      }),
    });
  }

  // ============================================
  // Website Custom Audiences
  // ============================================

  /**
   * Create a website custom audience based on pixel events
   */
  async createWebsiteAudience(adAccountId: string, params: {
    name: string;
    pixelId: string;
    rule: {
      inclusions: {
        event: string;
        retention_days: number;
        filter?: { field: string; operator: string; value: string | number }[];
      }[];
      exclusions?: {
        event: string;
        retention_days: number;
      }[];
    };
    prefill?: boolean;
    description?: string;
  }): Promise<{ id: string }> {
    const formattedId = formatAdAccountId(adAccountId);

    const ruleJson = {
      inclusions: {
        operator: 'or',
        rules: params.rule.inclusions.map(inc => ({
          event_sources: [{ id: params.pixelId, type: 'pixel' }],
          retention_seconds: inc.retention_days * 24 * 60 * 60,
          filter: {
            operator: 'and',
            filters: [
              { field: 'event', operator: 'eq', value: inc.event },
              ...(inc.filter || []).map(f => ({
                field: f.field,
                operator: f.operator,
                value: f.value,
              })),
            ],
          },
        })),
      },
    };

    if (params.rule.exclusions) {
      (ruleJson as Record<string, unknown>).exclusions = {
        operator: 'or',
        rules: params.rule.exclusions.map(exc => ({
          event_sources: [{ id: params.pixelId, type: 'pixel' }],
          retention_seconds: exc.retention_days * 24 * 60 * 60,
          filter: {
            operator: 'and',
            filters: [{ field: 'event', operator: 'eq', value: exc.event }],
          },
        })),
      };
    }

    return this.client.post<{ id: string }>(`/${formattedId}/customaudiences`, {
      name: params.name,
      description: params.description,
      subtype: 'WEBSITE',
      pixel_id: params.pixelId,
      prefill: params.prefill ?? true,
      rule: JSON.stringify(ruleJson),
    });
  }

  // ============================================
  // Saved Audiences
  // ============================================

  /**
   * List saved audiences for an ad account
   */
  async listSavedAudiences(adAccountId: string, params?: { fields?: string[]; limit?: number; after?: string }): Promise<PaginatedResponse<SavedAudience>> {
    const formattedId = formatAdAccountId(adAccountId);
    const fields = params?.fields || DEFAULT_SAVED_AUDIENCE_FIELDS;

    return this.client.get<PaginatedResponse<SavedAudience>>(`/${formattedId}/saved_audiences`, {
      fields: fields.join(','),
      limit: params?.limit,
      after: params?.after,
    });
  }

  /**
   * Get a saved audience by ID
   */
  async getSavedAudience(audienceId: string, fields?: string[]): Promise<SavedAudience> {
    return this.client.get<SavedAudience>(`/${audienceId}`, {
      fields: (fields || DEFAULT_SAVED_AUDIENCE_FIELDS).join(','),
    });
  }

  /**
   * Create a saved audience
   */
  async createSavedAudience(adAccountId: string, params: {
    name: string;
    description?: string;
    targeting: Record<string, unknown>;
  }): Promise<{ id: string }> {
    const formattedId = formatAdAccountId(adAccountId);

    return this.client.post<{ id: string }>(`/${formattedId}/saved_audiences`, {
      name: params.name,
      description: params.description,
      targeting: JSON.stringify(params.targeting),
    });
  }

  /**
   * Delete a saved audience
   */
  async deleteSavedAudience(audienceId: string): Promise<{ success: boolean }> {
    return this.client.delete<{ success: boolean }>(`/${audienceId}`);
  }

  // ============================================
  // Audience Helpers
  // ============================================

  /**
   * Get audience reach estimate
   */
  async getReachEstimate(adAccountId: string, params: {
    targetingSpec: Record<string, unknown>;
    optimizationGoal?: string;
  }): Promise<{
    data: {
      estimate_ready: boolean;
      estimate_dau?: number;
      estimate_mau_lower_bound?: number;
      estimate_mau_upper_bound?: number;
    }[];
  }> {
    const formattedId = formatAdAccountId(adAccountId);

    return this.client.get<{
      data: {
        estimate_ready: boolean;
        estimate_dau?: number;
        estimate_mau_lower_bound?: number;
        estimate_mau_upper_bound?: number;
      }[];
    }>(`/${formattedId}/reachestimate`, {
      targeting_spec: JSON.stringify(params.targetingSpec),
      optimization_goal: params.optimizationGoal,
    });
  }
}
