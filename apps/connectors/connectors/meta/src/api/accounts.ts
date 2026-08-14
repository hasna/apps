import type { MetaClient } from './client';
import type {
  AdAccount,
  AdAccountListParams,
  AdAccountUpdateParams,
  PaginatedResponse,
} from '../types';
import { formatAdAccountId } from '../utils/config';

const DEFAULT_FIELDS = [
  'id',
  'account_id',
  'account_status',
  'age',
  'amount_spent',
  'balance',
  'business',
  'business_name',
  'currency',
  'disable_reason',
  'name',
  'spend_cap',
  'timezone_id',
  'timezone_name',
  'timezone_offset_hours_utc',
  'created_time',
];

/**
 * Meta Ad Accounts API
 * Manage ad accounts in Meta Business Manager
 */
export class AccountsApi {
  constructor(private readonly client: MetaClient) {}

  /**
   * List ad accounts for the current user or business
   */
  async list(params?: AdAccountListParams): Promise<PaginatedResponse<AdAccount>> {
    const fields = params?.fields || DEFAULT_FIELDS;
    return this.client.get<PaginatedResponse<AdAccount>>('/me/adaccounts', {
      fields: fields.join(','),
      limit: params?.limit,
      after: params?.after,
      before: params?.before,
    });
  }

  /**
   * List ad accounts for a business
   */
  async listForBusiness(businessId: string, params?: AdAccountListParams): Promise<PaginatedResponse<AdAccount>> {
    const fields = params?.fields || DEFAULT_FIELDS;
    return this.client.get<PaginatedResponse<AdAccount>>(`/${businessId}/owned_ad_accounts`, {
      fields: fields.join(','),
      limit: params?.limit,
      after: params?.after,
      before: params?.before,
    });
  }

  /**
   * Get a single ad account by ID
   */
  async get(adAccountId: string, fields?: string[]): Promise<AdAccount> {
    const formattedId = formatAdAccountId(adAccountId);
    return this.client.get<AdAccount>(`/${formattedId}`, {
      fields: (fields || DEFAULT_FIELDS).join(','),
    });
  }

  /**
   * Update an ad account
   */
  async update(adAccountId: string, params: AdAccountUpdateParams): Promise<{ success: boolean }> {
    const formattedId = formatAdAccountId(adAccountId);
    return this.client.post<{ success: boolean }>(`/${formattedId}`, params as Record<string, unknown>);
  }

  /**
   * Get ad account activities
   */
  async getActivities(adAccountId: string, params?: { limit?: number; after?: string }): Promise<PaginatedResponse<unknown>> {
    const formattedId = formatAdAccountId(adAccountId);
    return this.client.get<PaginatedResponse<unknown>>(`/${formattedId}/activities`, {
      limit: params?.limit,
      after: params?.after,
    });
  }

  /**
   * Get ad account users with their roles
   */
  async getUsers(adAccountId: string): Promise<PaginatedResponse<{ id: string; name?: string; role?: string }>> {
    const formattedId = formatAdAccountId(adAccountId);
    return this.client.get<PaginatedResponse<{ id: string; name?: string; role?: string }>>(`/${formattedId}/users`, {
      fields: 'id,name,role',
    });
  }

  /**
   * Get minimum daily budget info
   */
  async getMinDailyBudget(adAccountId: string): Promise<AdAccount> {
    const formattedId = formatAdAccountId(adAccountId);
    return this.client.get<AdAccount>(`/${formattedId}`, {
      fields: 'min_daily_budget,min_campaign_group_spend_cap,currency',
    });
  }

  /**
   * Get spending limit info
   */
  async getSpendingLimits(adAccountId: string): Promise<AdAccount> {
    const formattedId = formatAdAccountId(adAccountId);
    return this.client.get<AdAccount>(`/${formattedId}`, {
      fields: 'spend_cap,amount_spent,balance,currency',
    });
  }
}
