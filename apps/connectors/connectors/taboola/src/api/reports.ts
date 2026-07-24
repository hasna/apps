import type { ConnectorClient } from './client';
import type { CampaignSummaryDimension, ReportParams, ReportResponse } from '../types';

/**
 * Reporting endpoints.
 * Docs: https://developers.taboola.com/backstage-api/reference/reporting-overview
 */
export class ReportsApi {
  constructor(private readonly client: ConnectorClient) {}

  /**
   * Campaign summary report, broken down by a dimension.
   * GET /backstage/api/1.0/{account_id}/reports/campaign-summary/dimensions/{dimension}
   */
  async campaignSummary(
    accountId: string,
    dimension: CampaignSummaryDimension,
    params: ReportParams
  ): Promise<ReportResponse> {
    const { start_date, end_date, filters } = params;
    return this.client.get<ReportResponse>(
      `/${accountId}/reports/campaign-summary/dimensions/${dimension}`,
      { start_date, end_date, ...filters }
    );
  }

  /**
   * Top campaign content report (per-item performance).
   * GET /backstage/api/1.0/{account_id}/reports/top-campaign-content/dimensions/{dimension}
   */
  async topCampaignContent(
    accountId: string,
    dimension: string,
    params: ReportParams
  ): Promise<ReportResponse> {
    const { start_date, end_date, filters } = params;
    return this.client.get<ReportResponse>(
      `/${accountId}/reports/top-campaign-content/dimensions/${dimension}`,
      { start_date, end_date, ...filters }
    );
  }
}
