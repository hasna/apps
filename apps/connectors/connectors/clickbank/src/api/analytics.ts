import { ClickBankClient } from './client';
import type {
  Role,
  SubscriptionTrend,
  SubscriptionDetails,
  AnalyticsStats,
  AnalyticsStatus,
  SubscriptionTrendsParams,
  SubscriptionDetailsParams,
  AnalyticsStatsParams,
  SubscriptionDetailFilter,
  SubscriptionDetailFilterParams,
  AnalyticsSummaryParams,
} from '../types';

interface SubscriptionTrendsResponse {
  subscriptionTrend?: SubscriptionTrend[];
}

interface SubscriptionDetailsResponse {
  subscriptionDetails?: SubscriptionDetails[];
  _hasMore?: boolean;
}

interface AnalyticsStatsResponse {
  analyticsData?: AnalyticsStats[];
}

export class AnalyticsApi {
  constructor(private readonly client: ClickBankClient) {}

  /**
   * Get API status and last update time
   */
  async getStatus(): Promise<AnalyticsStatus> {
    return this.client.get<AnalyticsStatus>('/analytics/status');
  }

  /**
   * Get subscription trends for a date range
   * Note: Only available for vendor role
   */
  async getSubscriptionTrends(params: SubscriptionTrendsParams): Promise<SubscriptionTrend[]> {
    const { role, ...queryParams } = params;
    const response = await this.client.get<SubscriptionTrendsResponse>(
      `/analytics/${role.toLowerCase()}/subscription/trends`,
      queryParams as Record<string, string | number | boolean | undefined>
    );
    return response.subscriptionTrend || [];
  }

  /**
   * Get subscription details
   * Note: Only available for vendor role
   */
  async getSubscriptionDetails(
    params: SubscriptionDetailsParams
  ): Promise<{ details: SubscriptionDetails[]; hasMore: boolean }> {
    const { role, page, ...queryParams } = params;
    const headers = page ? { page: String(page) } : undefined;

    const response = await this.client.request<SubscriptionDetailsResponse>(
      `/analytics/${role.toLowerCase()}/subscription/details`,
      {
        method: 'GET',
        params: queryParams as Record<string, string | number | boolean | undefined>,
        headers,
      }
    );

    return {
      details: response.subscriptionDetails || [],
      hasMore: !!response._hasMore,
    };
  }

  /**
   * Get subscription status summary
   * Note: Only available for vendor role
   */
  async getSubscriptionStatus(
    role: Role,
    account?: string
  ): Promise<Record<string, number>> {
    return this.client.get<Record<string, number>>(
      `/analytics/${role.toLowerCase()}/subscription/status`,
      account ? { account } : undefined
    );
  }

  /**
   * Get summary statistics by dimension
   */
  async getStats(params: AnalyticsStatsParams): Promise<AnalyticsStats[]> {
    const { role, dimension, ...queryParams } = params;
    const response = await this.client.get<AnalyticsStatsResponse>(
      `/analytics/${role.toLowerCase()}/${dimension.toLowerCase()}`,
      queryParams as Record<string, string | number | boolean | undefined>
    );
    return response.analyticsData || [];
  }

  /**
   * Get vendor stats by product SKU
   */
  async getVendorProductStats(
    account?: string,
    startDate?: string,
    endDate?: string
  ): Promise<AnalyticsStats[]> {
    return this.getStats({
      role: 'VENDOR',
      dimension: 'PRODUCT_SKU',
      account,
      startDate,
      endDate,
    });
  }

  /**
   * Get affiliate stats by vendor product SKU
   */
  async getAffiliateVendorStats(
    account?: string,
    startDate?: string,
    endDate?: string
  ): Promise<AnalyticsStats[]> {
    return this.getStats({
      role: 'AFFILIATE',
      dimension: 'VENDOR_PRODUCT_SKU',
      account,
      startDate,
      endDate,
    });
  }

  /**
   * Get stats by country
   */
  async getCountryStats(
    role: Role,
    account?: string,
    startDate?: string,
    endDate?: string
  ): Promise<AnalyticsStats[]> {
    return this.getStats({
      role,
      dimension: 'COUNTRY',
      account,
      startDate,
      endDate,
    });
  }

  /**
   * Get all subscription details (handles pagination)
   * Note: Only available for vendor role
   */
  async getAllSubscriptionDetails(
    account?: string,
    status?: string
  ): Promise<SubscriptionDetails[]> {
    const result: SubscriptionDetails[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const response = await this.getSubscriptionDetails({
        role: 'VENDOR',
        account,
        status,
        page,
      });

      result.push(...response.details);
      hasMore = response.hasMore;
      page++;
    }

    return result;
  }

  /**
   * Get subscription details with a specific filter
   * Available filters: canceldate, cancelsixty, cancelthirty, compsixty, compthirty, nextpmtdate, startdate, status
   */
  async getSubscriptionDetailsByFilter(
    filter: SubscriptionDetailFilter,
    params: SubscriptionDetailFilterParams
  ): Promise<{ details: SubscriptionDetails[]; hasMore: boolean }> {
    const { role, page, ...queryParams } = params;
    const headers = page ? { page: String(page) } : undefined;

    const response = await this.client.request<SubscriptionDetailsResponse>(
      `/analytics/${role.toLowerCase()}/subscription/details/${filter}`,
      {
        method: 'GET',
        params: queryParams as Record<string, string | number | boolean | undefined>,
        headers,
      }
    );

    return {
      details: response.subscriptionDetails || [],
      hasMore: !!response._hasMore,
    };
  }

  /**
   * Get subscriptions canceled within a date range
   */
  async getCanceledByDateRange(
    account: string,
    startDate: string,
    endDate: string,
    page?: number
  ): Promise<{ details: SubscriptionDetails[]; hasMore: boolean }> {
    return this.getSubscriptionDetailsByFilter('canceldate', {
      role: 'VENDOR',
      account,
      startDate,
      endDate,
      page,
    });
  }

  /**
   * Get subscriptions canceled in the last 60 days
   */
  async getCanceledLast60Days(
    account: string,
    page?: number
  ): Promise<{ details: SubscriptionDetails[]; hasMore: boolean }> {
    return this.getSubscriptionDetailsByFilter('cancelsixty', {
      role: 'VENDOR',
      account,
      page,
    });
  }

  /**
   * Get subscriptions canceled in the last 30 days
   */
  async getCanceledLast30Days(
    account: string,
    page?: number
  ): Promise<{ details: SubscriptionDetails[]; hasMore: boolean }> {
    return this.getSubscriptionDetailsByFilter('cancelthirty', {
      role: 'VENDOR',
      account,
      page,
    });
  }

  /**
   * Get subscriptions completing within 60 days
   */
  async getCompletingIn60Days(
    account: string,
    page?: number
  ): Promise<{ details: SubscriptionDetails[]; hasMore: boolean }> {
    return this.getSubscriptionDetailsByFilter('compsixty', {
      role: 'VENDOR',
      account,
      page,
    });
  }

  /**
   * Get subscriptions completing within 30 days
   */
  async getCompletingIn30Days(
    account: string,
    page?: number
  ): Promise<{ details: SubscriptionDetails[]; hasMore: boolean }> {
    return this.getSubscriptionDetailsByFilter('compthirty', {
      role: 'VENDOR',
      account,
      page,
    });
  }

  /**
   * Get subscriptions with next payment date in a date range
   */
  async getByNextPaymentDate(
    account: string,
    startDate: string,
    endDate: string,
    page?: number
  ): Promise<{ details: SubscriptionDetails[]; hasMore: boolean }> {
    return this.getSubscriptionDetailsByFilter('nextpmtdate', {
      role: 'VENDOR',
      account,
      startDate,
      endDate,
      page,
    });
  }

  /**
   * Get subscriptions with start date in a date range
   */
  async getByStartDate(
    account: string,
    startDate: string,
    endDate: string,
    page?: number
  ): Promise<{ details: SubscriptionDetails[]; hasMore: boolean }> {
    return this.getSubscriptionDetailsByFilter('startdate', {
      role: 'VENDOR',
      account,
      startDate,
      endDate,
      page,
    });
  }

  /**
   * Get subscriptions by status
   * Status can be: ACTIVE, COMPLETED, CANCELED, RETRY_PAYMENT, REQUEST_NEW_CARD
   */
  async getBySubscriptionStatus(
    account: string,
    status: 'ACTIVE' | 'COMPLETED' | 'CANCELED' | 'RETRY_PAYMENT' | 'REQUEST_NEW_CARD',
    page?: number
  ): Promise<{ details: SubscriptionDetails[]; hasMore: boolean }> {
    return this.getSubscriptionDetailsByFilter('status', {
      role: 'VENDOR',
      account,
      status,
      page,
    });
  }

  /**
   * Get summary statistics by dimension
   */
  async getStatsSummary(params: AnalyticsSummaryParams): Promise<AnalyticsStats[]> {
    const { role, dimension, ...queryParams } = params;
    const response = await this.client.get<AnalyticsStatsResponse>(
      `/analytics/${role.toLowerCase()}/${dimension.toLowerCase()}/summary`,
      queryParams as Record<string, string | number | boolean | undefined>
    );
    return response.analyticsData || [];
  }

  /**
   * Get vendor summary stats by product SKU
   */
  async getVendorProductSummary(
    account?: string,
    startDate?: string,
    endDate?: string
  ): Promise<AnalyticsStats[]> {
    return this.getStatsSummary({
      role: 'VENDOR',
      dimension: 'PRODUCT_SKU',
      account,
      startDate,
      endDate,
    });
  }

  /**
   * Get all analytics schemas
   */
  async getSchemas(): Promise<{
    analyticsResult: string;
    analyticsStatus: string;
    subscriptionDetail: string;
    subscriptionTrends: string;
    subscriptionDetailRow: string;
  }> {
    const [analyticsResult, analyticsStatus, subscriptionDetail, subscriptionTrends, subscriptionDetailRow] =
      await Promise.all([
        this.client.get<string>('/analytics/schema/AnalyticsResult', undefined, 'xml'),
        this.client.get<string>('/analytics/schema/AnalyticsStatus', undefined, 'xml'),
        this.client.get<string>('/analytics/schema/SubscriptionDetailResult', undefined, 'xml'),
        this.client.get<string>('/analytics/schema/SubscriptionTrendsData', undefined, 'xml'),
        this.client.get<string>('/analytics/schema/SubscriptionDetailResultRow', undefined, 'xml'),
      ]);

    return {
      analyticsResult,
      analyticsStatus,
      subscriptionDetail,
      subscriptionTrends,
      subscriptionDetailRow,
    };
  }
}
