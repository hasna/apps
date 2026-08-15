import type { TikTokAdsClient } from './client';
import type { PaginatedData, ReportParams } from '../types';

export class ReportsApi {
  constructor(private readonly client: TikTokAdsClient) {}

  async getIntegrated(params: ReportParams): Promise<PaginatedData<Record<string, unknown>>> {
    return this.client.get<PaginatedData<Record<string, unknown>>>('/report/integrated/get/', {
      advertiser_id: params.advertiser_id,
      report_type: params.report_type || 'BASIC',
      data_level: params.data_level,
      dimensions: JSON.stringify(params.dimensions),
      metrics: JSON.stringify(params.metrics),
      start_date: params.start_date,
      end_date: params.end_date,
      filtering: params.filtering ? JSON.stringify(params.filtering) : undefined,
      page: params.page,
      page_size: params.page_size,
    });
  }
}
