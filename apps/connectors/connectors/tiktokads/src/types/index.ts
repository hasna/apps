export interface TikTokAdsConfig {
  accessToken: string;
  advertiserId?: string;
  baseUrl?: string;
}

export interface OAuth2Tokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  tokenType?: string;
  scope?: string;
}

export interface CliConfig {
  clientId?: string;
  clientSecret?: string;
}

export interface TikTokAdsApiResponse<T> {
  code: number;
  message: string;
  request_id?: string;
  data: T;
}

export interface PaginatedData<T> {
  list: T[];
  page_info?: {
    page: number;
    page_size: number;
    total_number: number;
    total_page: number;
  };
}

export interface Advertiser {
  advertiser_id: string;
  advertiser_name?: string;
  status?: string;
  currency?: string;
  timezone?: string;
}

export interface Campaign {
  campaign_id: string;
  campaign_name?: string;
  campaign_type?: string;
  status?: string;
  objective_type?: string;
  budget_mode?: string;
  budget?: number;
  operation_status?: string;
  create_time?: string;
  modify_time?: string;
}

export interface CampaignListParams {
  advertiser_id: string;
  filtering?: { campaign_ids?: string[]; status?: string };
  page?: number;
  page_size?: number;
  fields?: string[];
}

export interface CampaignCreateParams {
  advertiser_id: string;
  campaign_name: string;
  objective_type: string;
  budget_mode: string;
  budget?: number;
  [key: string]: unknown;
}

export interface CampaignUpdateParams {
  advertiser_id: string;
  campaign_id: string;
  [key: string]: unknown;
}

export interface AdGroup {
  adgroup_id: string;
  adgroup_name?: string;
  campaign_id?: string;
  status?: string;
  optimization_goal?: string;
  bid_type?: string;
  bid_price?: number;
  budget?: number;
  budget_mode?: string;
  operation_status?: string;
  create_time?: string;
  modify_time?: string;
}

export interface AdGroupListParams {
  advertiser_id: string;
  filtering?: { campaign_ids?: string[]; adgroup_ids?: string[]; status?: string };
  page?: number;
  page_size?: number;
  fields?: string[];
}

export interface Ad {
  ad_id: string;
  ad_name?: string;
  adgroup_id?: string;
  campaign_id?: string;
  status?: string;
  ad_format?: string;
  call_to_action?: string;
  landing_page_url?: string;
  operation_status?: string;
  create_time?: string;
  modify_time?: string;
}

export interface AdListParams {
  advertiser_id: string;
  filtering?: { adgroup_ids?: string[]; ad_ids?: string[]; status?: string };
  page?: number;
  page_size?: number;
  fields?: string[];
}

export interface ReportParams {
  advertiser_id: string;
  report_type?: string;
  data_level: string;
  dimensions: string[];
  metrics: string[];
  start_date: string;
  end_date: string;
  page?: number;
  page_size?: number;
  filtering?: Record<string, unknown>;
}

export interface Pixel {
  pixel_id: string;
  pixel_name?: string;
  pixel_code?: string;
  status?: string;
}

export interface ImageInfo {
  image_id: string;
  material_id?: string;
  file_name?: string;
  image_url?: string;
  width?: number;
  height?: number;
}

export interface VideoInfo {
  video_id: string;
  material_id?: string;
  file_name?: string;
  video_cover_url?: string;
  duration?: number;
}

export class TikTokAdsApiError extends Error {
  readonly code: number | string;
  readonly requestId?: string;

  constructor(message: string, code: number | string, requestId?: string) {
    super(message);
    this.name = 'TikTokAdsApiError';
    this.code = code;
    this.requestId = requestId;
  }
}
