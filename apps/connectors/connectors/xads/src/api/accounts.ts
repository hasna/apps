import type { XAdsClient } from './client';
import type { AdAccount, FundingInstrument, ListResponse, PaginationParams } from '../types';

/**
 * Ad Accounts API
 */
export class AccountsApi {
  constructor(private client: XAdsClient) {}

  /**
   * List all ad accounts accessible to the authenticated user
   */
  async list(params?: PaginationParams): Promise<ListResponse<AdAccount>> {
    return this.client.get<ListResponse<AdAccount>>('/accounts', {
      cursor: params?.cursor,
      count: params?.count,
      sort_by: params?.sort_by?.join(','),
      with_deleted: params?.with_deleted,
      with_total_count: params?.with_total_count,
    });
  }

  /**
   * Get a specific ad account by ID
   */
  async get(accountId: string, withDeleted?: boolean): Promise<{ data: AdAccount }> {
    return this.client.get<{ data: AdAccount }>(`/accounts/${accountId}`, {
      with_deleted: withDeleted,
    });
  }

  /**
   * Get account features/capabilities
   */
  async getFeatures(accountId: string): Promise<{ data: string[] }> {
    return this.client.get<{ data: string[] }>(`/accounts/${accountId}/features`);
  }

  /**
   * List funding instruments for an account
   */
  async listFundingInstruments(
    accountId: string,
    params?: PaginationParams
  ): Promise<ListResponse<FundingInstrument>> {
    return this.client.get<ListResponse<FundingInstrument>>(
      `/accounts/${accountId}/funding_instruments`,
      {
        cursor: params?.cursor,
        count: params?.count,
        with_deleted: params?.with_deleted,
        with_total_count: params?.with_total_count,
      }
    );
  }

  /**
   * Get a specific funding instrument
   */
  async getFundingInstrument(
    accountId: string,
    fundingInstrumentId: string,
    withDeleted?: boolean
  ): Promise<{ data: FundingInstrument }> {
    return this.client.get<{ data: FundingInstrument }>(
      `/accounts/${accountId}/funding_instruments/${fundingInstrumentId}`,
      { with_deleted: withDeleted }
    );
  }
}
