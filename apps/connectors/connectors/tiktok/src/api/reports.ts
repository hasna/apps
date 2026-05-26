import type { TikTokClient } from './client';
import type { ReportParams, ReportData, DataLevel, ReportDimension, ReportMetric, PaginatedData } from '../types';

/**
 * TikTok Reports API
 * Access integrated reports and performance metrics
 */
export class ReportsApi {
  constructor(private readonly client: TikTokClient) {}

  /**
   * Get integrated report
   * GET /report/integrated/get/
   */
  async getIntegrated(params: ReportParams): Promise<PaginatedData<ReportData>> {
    return this.client.get<PaginatedData<ReportData>>('/report/integrated/get/', {
      advertiser_id: params.advertiser_id,
      report_type: params.report_type || 'BASIC',
      data_level: params.data_level,
      dimensions: JSON.stringify(params.dimensions),
      metrics: JSON.stringify(params.metrics),
      start_date: params.start_date,
      end_date: params.end_date,
      lifetime: params.lifetime,
      filtering: params.filtering ? JSON.stringify(params.filtering) : undefined,
      page: params.page,
      page_size: params.page_size,
      order_field: params.order_field,
      order_type: params.order_type,
    });
  }

  /**
   * Get campaign level report
   */
  async getCampaignReport(params: {
    advertiser_id: string;
    campaign_ids?: string[];
    metrics: ReportMetric[];
    start_date: string;
    end_date: string;
    dimensions?: ReportDimension[];
    page?: number;
    page_size?: number;
  }): Promise<PaginatedData<ReportData>> {
    return this.getIntegrated({
      advertiser_id: params.advertiser_id,
      data_level: 'AUCTION_CAMPAIGN',
      metrics: params.metrics,
      dimensions: params.dimensions || ['campaign_id'],
      start_date: params.start_date,
      end_date: params.end_date,
      filtering: params.campaign_ids ? { campaign_ids: params.campaign_ids } : undefined,
      page: params.page,
      page_size: params.page_size,
    });
  }

  /**
   * Get ad group level report
   */
  async getAdGroupReport(params: {
    advertiser_id: string;
    adgroup_ids?: string[];
    campaign_ids?: string[];
    metrics: ReportMetric[];
    start_date: string;
    end_date: string;
    dimensions?: ReportDimension[];
    page?: number;
    page_size?: number;
  }): Promise<PaginatedData<ReportData>> {
    return this.getIntegrated({
      advertiser_id: params.advertiser_id,
      data_level: 'AUCTION_ADGROUP',
      metrics: params.metrics,
      dimensions: params.dimensions || ['adgroup_id'],
      start_date: params.start_date,
      end_date: params.end_date,
      filtering: {
        adgroup_ids: params.adgroup_ids,
        campaign_ids: params.campaign_ids,
      },
      page: params.page,
      page_size: params.page_size,
    });
  }

  /**
   * Get ad level report
   */
  async getAdReport(params: {
    advertiser_id: string;
    ad_ids?: string[];
    adgroup_ids?: string[];
    campaign_ids?: string[];
    metrics: ReportMetric[];
    start_date: string;
    end_date: string;
    dimensions?: ReportDimension[];
    page?: number;
    page_size?: number;
  }): Promise<PaginatedData<ReportData>> {
    return this.getIntegrated({
      advertiser_id: params.advertiser_id,
      data_level: 'AUCTION_AD',
      metrics: params.metrics,
      dimensions: params.dimensions || ['ad_id'],
      start_date: params.start_date,
      end_date: params.end_date,
      filtering: {
        ad_ids: params.ad_ids,
        adgroup_ids: params.adgroup_ids,
        campaign_ids: params.campaign_ids,
      },
      page: params.page,
      page_size: params.page_size,
    });
  }

  /**
   * Get advertiser level summary
   */
  async getAdvertiserSummary(params: {
    advertiser_id: string;
    metrics: ReportMetric[];
    start_date: string;
    end_date: string;
  }): Promise<ReportData> {
    const response = await this.getIntegrated({
      advertiser_id: params.advertiser_id,
      data_level: 'AUCTION_ADVERTISER',
      metrics: params.metrics,
      dimensions: ['advertiser_id'],
      start_date: params.start_date,
      end_date: params.end_date,
    });
    return response.list[0] || { dimensions: {}, metrics: {} };
  }

  /**
   * Get daily report with time dimension
   */
  async getDailyReport(params: {
    advertiser_id: string;
    data_level: DataLevel;
    metrics: ReportMetric[];
    start_date: string;
    end_date: string;
    filtering?: {
      campaign_ids?: string[];
      adgroup_ids?: string[];
      ad_ids?: string[];
    };
    page?: number;
    page_size?: number;
  }): Promise<PaginatedData<ReportData>> {
    const baseDimension = params.data_level.toLowerCase().replace('auction_', '') + '_id';
    return this.getIntegrated({
      advertiser_id: params.advertiser_id,
      data_level: params.data_level,
      metrics: params.metrics,
      dimensions: [baseDimension as ReportDimension, 'stat_time_day'],
      start_date: params.start_date,
      end_date: params.end_date,
      filtering: params.filtering,
      page: params.page,
      page_size: params.page_size,
    });
  }

  /**
   * Get audience report with demographic breakdown
   */
  async getAudienceReport(params: {
    advertiser_id: string;
    data_level: DataLevel;
    metrics: ReportMetric[];
    start_date: string;
    end_date: string;
    dimensions: ('gender' | 'age' | 'country_code' | 'platform')[];
    filtering?: {
      campaign_ids?: string[];
      adgroup_ids?: string[];
      ad_ids?: string[];
    };
    page?: number;
    page_size?: number;
  }): Promise<PaginatedData<ReportData>> {
    return this.getIntegrated({
      advertiser_id: params.advertiser_id,
      report_type: 'AUDIENCE',
      data_level: params.data_level,
      metrics: params.metrics,
      dimensions: params.dimensions as ReportDimension[],
      start_date: params.start_date,
      end_date: params.end_date,
      filtering: params.filtering,
      page: params.page,
      page_size: params.page_size,
    });
  }

  /**
   * Get real-time report
   * GET /report/real_time/get/
   */
  async getRealTime(params: {
    advertiser_id: string;
    data_level: DataLevel;
    dimensions: ReportDimension[];
    metrics: ReportMetric[];
    filtering?: {
      campaign_ids?: string[];
      adgroup_ids?: string[];
      ad_ids?: string[];
    };
  }): Promise<{ list: ReportData[] }> {
    return this.client.get('/report/real_time/get/', {
      advertiser_id: params.advertiser_id,
      data_level: params.data_level,
      dimensions: JSON.stringify(params.dimensions),
      metrics: JSON.stringify(params.metrics),
      filtering: params.filtering ? JSON.stringify(params.filtering) : undefined,
    });
  }

  /**
   * Create an async report task
   * POST /report/task/create/
   */
  async createTask(params: {
    advertiser_id: string;
    report_type?: string;
    data_level: DataLevel;
    dimensions: ReportDimension[];
    metrics: ReportMetric[];
    start_date: string;
    end_date: string;
    filtering?: {
      campaign_ids?: string[];
      adgroup_ids?: string[];
      ad_ids?: string[];
    };
    file_name?: string;
  }): Promise<{ task_id: string }> {
    return this.client.post('/report/task/create/', {
      advertiser_id: params.advertiser_id,
      report_type: params.report_type || 'BASIC',
      data_level: params.data_level,
      dimensions: params.dimensions,
      metrics: params.metrics,
      start_date: params.start_date,
      end_date: params.end_date,
      filtering: params.filtering,
      file_name: params.file_name,
    });
  }

  /**
   * Check async report task status
   * GET /report/task/check/
   */
  async checkTask(advertiserId: string, taskId: string): Promise<{
    task_id: string;
    status: 'QUEUING' | 'PROCESSING' | 'SUCCESS' | 'FAILED';
    file_path?: string;
    file_size?: number;
    message?: string;
  }> {
    return this.client.get('/report/task/check/', {
      advertiser_id: advertiserId,
      task_id: taskId,
    });
  }

  /**
   * Download async report file
   * GET /report/task/download/
   */
  async downloadTask(advertiserId: string, taskId: string): Promise<{
    file_path: string;
    file_url: string;
  }> {
    return this.client.get('/report/task/download/', {
      advertiser_id: advertiserId,
      task_id: taskId,
    });
  }
}
