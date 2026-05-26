import type { SnapClient } from './client';
import type {
  AdAccount,
  AdAccountCreateParams,
  AdAccountUpdateParams,
  AdAccountResponse,
} from '../types';

/**
 * Snapchat Ad Accounts API
 * Manage advertising accounts
 */
export class AccountsApi {
  constructor(private readonly client: SnapClient) {}

  /**
   * List all ad accounts for an organization
   */
  async list(organizationId: string): Promise<AdAccount[]> {
    const response = await this.client.get<AdAccountResponse>(
      `/organizations/${organizationId}/adaccounts`
    );
    return response.adaccounts?.map(a => a.adaccount) || [];
  }

  /**
   * Get a specific ad account by ID
   */
  async get(adAccountId: string): Promise<AdAccount> {
    const response = await this.client.get<AdAccountResponse>(`/adaccounts/${adAccountId}`);
    const account = response.adaccounts?.[0]?.adaccount;
    if (!account) {
      throw new Error(`Ad account ${adAccountId} not found`);
    }
    return account;
  }

  /**
   * Create a new ad account
   */
  async create(params: AdAccountCreateParams): Promise<AdAccount> {
    const response = await this.client.post<AdAccountResponse>(
      `/organizations/${params.organization_id}/adaccounts`,
      {
        adaccounts: [params],
      }
    );
    const account = response.adaccounts?.[0]?.adaccount;
    if (!account) {
      throw new Error('Failed to create ad account');
    }
    return account;
  }

  /**
   * Update an ad account
   */
  async update(adAccountId: string, params: AdAccountUpdateParams): Promise<AdAccount> {
    const response = await this.client.put<AdAccountResponse>(
      `/adaccounts/${adAccountId}`,
      {
        adaccounts: [{ id: adAccountId, ...params }],
      }
    );
    const account = response.adaccounts?.[0]?.adaccount;
    if (!account) {
      throw new Error('Failed to update ad account');
    }
    return account;
  }

  /**
   * Get ad account members
   */
  async listMembers(adAccountId: string): Promise<unknown[]> {
    const response = await this.client.get<{ request_status: string; members: unknown[] }>(
      `/adaccounts/${adAccountId}/members`
    );
    return response.members || [];
  }
}
