import type { MaropostClient } from './client';
import type {
  Campaign,
  CampaignListResponse,
  CampaignReportResponse,
  PaginationParams,
} from '../types';

export interface CampaignReportOptions extends PaginationParams {
  unique?: boolean;
}

/**
 * Campaigns API module for Maropost
 * Manages email campaigns and retrieves campaign reports
 */
export class CampaignsApi {
  constructor(private readonly client: MaropostClient) {}

  /**
   * List all campaigns with pagination
   */
  async list(options?: PaginationParams): Promise<CampaignListResponse> {
    return this.client.get<CampaignListResponse>('/campaigns.json', {
      page: options?.page,
      per: options?.per,
    });
  }

  /**
   * Get a single campaign by ID
   */
  async get(id: number): Promise<Campaign> {
    return this.client.get<Campaign>(`/campaigns/${id}.json`);
  }

  /**
   * Get bounce report for a campaign
   */
  async getBounceReport(campaignId: number, options?: PaginationParams): Promise<CampaignReportResponse> {
    return this.client.get<CampaignReportResponse>(`/campaigns/${campaignId}/bounce_report.json`, {
      page: options?.page,
      per: options?.per,
    });
  }

  /**
   * Get click report for a campaign
   */
  async getClickReport(campaignId: number, options?: CampaignReportOptions): Promise<CampaignReportResponse> {
    return this.client.get<CampaignReportResponse>(`/campaigns/${campaignId}/click_report.json`, {
      page: options?.page,
      per: options?.per,
      unique: options?.unique,
    });
  }

  /**
   * Get complaint report for a campaign
   */
  async getComplaintReport(campaignId: number, options?: PaginationParams): Promise<CampaignReportResponse> {
    return this.client.get<CampaignReportResponse>(`/campaigns/${campaignId}/complaint_report.json`, {
      page: options?.page,
      per: options?.per,
    });
  }

  /**
   * Get delivered report for a campaign
   */
  async getDeliveredReport(campaignId: number, options?: PaginationParams): Promise<CampaignReportResponse> {
    return this.client.get<CampaignReportResponse>(`/campaigns/${campaignId}/delivered_report.json`, {
      page: options?.page,
      per: options?.per,
    });
  }

  /**
   * Get hard bounce report for a campaign
   */
  async getHardBounceReport(campaignId: number, options?: PaginationParams): Promise<CampaignReportResponse> {
    return this.client.get<CampaignReportResponse>(`/campaigns/${campaignId}/hard_bounce_report.json`, {
      page: options?.page,
      per: options?.per,
    });
  }

  /**
   * Get link report for a campaign
   */
  async getLinkReport(campaignId: number, options?: CampaignReportOptions): Promise<CampaignReportResponse> {
    return this.client.get<CampaignReportResponse>(`/campaigns/${campaignId}/link_report.json`, {
      page: options?.page,
      per: options?.per,
      unique: options?.unique,
    });
  }

  /**
   * Get open report for a campaign
   */
  async getOpenReport(campaignId: number, options?: CampaignReportOptions): Promise<CampaignReportResponse> {
    return this.client.get<CampaignReportResponse>(`/campaigns/${campaignId}/open_report.json`, {
      page: options?.page,
      per: options?.per,
      unique: options?.unique,
    });
  }

  /**
   * Get soft bounce report for a campaign
   */
  async getSoftBounceReport(campaignId: number, options?: PaginationParams): Promise<CampaignReportResponse> {
    return this.client.get<CampaignReportResponse>(`/campaigns/${campaignId}/soft_bounce_report.json`, {
      page: options?.page,
      per: options?.per,
    });
  }

  /**
   * Get unsubscribe report for a campaign
   */
  async getUnsubscribeReport(campaignId: number, options?: PaginationParams): Promise<CampaignReportResponse> {
    return this.client.get<CampaignReportResponse>(`/campaigns/${campaignId}/unsubscribe_report.json`, {
      page: options?.page,
      per: options?.per,
    });
  }
}
