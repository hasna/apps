import type { ConnectorClient } from './client';
import type { ReportParams, ReportResult, ReportsParams, ReportsResult, ClearAddressParams, ClearAddressResult } from '../types';

export class ReportApi {
  constructor(private readonly client: ConnectorClient) {}

  /**
   * Report an IP address for abusive behavior.
   * Categories are comma-separated IDs (e.g., "18,22" for brute force + SSH).
   */
  async report(params: ReportParams): Promise<ReportResult> {
    const body: Record<string, unknown> = {
      ip: params.ip,
      categories: params.categories,
    };

    if (params.comment) {
      body.comment = params.comment;
    }
    if (params.timestamp) {
      body.timestamp = params.timestamp;
    }

    const response = await this.client.post<{ data: ReportResult }>('/report', body);
    return response.data;
  }

  /**
   * Get paginated reports for a specific IP address.
   */
  async reports(params: ReportsParams): Promise<ReportsResult> {
    const queryParams: Record<string, string | number | boolean | undefined> = {
      ipAddress: params.ipAddress,
    };

    if (params.maxAgeInDays !== undefined) {
      queryParams.maxAgeInDays = params.maxAgeInDays;
    }
    if (params.page !== undefined) {
      queryParams.page = params.page;
    }
    if (params.perPage !== undefined) {
      queryParams.perPage = params.perPage;
    }

    const response = await this.client.get<{ data: ReportsResult }>('/reports', queryParams);
    return response.data;
  }

  /**
   * Clear your own reports for a specific IP address.
   */
  async clearAddress(params: ClearAddressParams): Promise<ClearAddressResult> {
    const response = await this.client.delete<{ data: ClearAddressResult }>('/clear-address', {
      ipAddress: params.ipAddress,
    });
    return response.data;
  }
}
