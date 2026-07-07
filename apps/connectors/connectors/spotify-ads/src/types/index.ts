// Spotify Ads API v3 Types

export interface ConnectorConfig {
  accessToken: string;
  baseUrl?: string;
}

export interface OAuth2Tokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  tokenType: string;
  scope?: string;
}

export interface CliConfig {
  clientId?: string;
  clientSecret?: string;
}

export interface ProfileConfig {
  adAccountId?: string;
  businessId?: string;
}

export type OutputFormat = 'json' | 'pretty';

export interface Paging {
  page_size?: number;
  total_results?: number;
  offset?: number;
  current_page?: number;
}

export interface Business {
  id: string;
  name: string;
  created_at?: string;
  updated_at?: string;
  status?: string;
  type?: string;
}

export interface BusinessesResponse {
  businesses: Business[];
}

export interface AdAccount {
  id: string;
  business_id?: string;
  name?: string;
  created_at?: string;
  updated_at?: string;
  country_code?: string;
  industry?: string;
  website?: string;
  legal_entity_name?: string;
  status?: string;
  status_reason?: string;
  ad_account_role?: string;
  tax_id?: string;
  currency_code?: string;
}

export interface AdAccountsResponse {
  paging?: Paging;
  ad_accounts: AdAccount[];
}

export interface Campaign {
  id: string;
  name: string;
  created_at?: string;
  updated_at?: string;
  purchase_order?: string;
  status?: string;
  objective?: string;
  delivery_goal_group?: string;
}

export interface CampaignsResponse {
  paging?: Paging;
  campaigns: Campaign[];
}

export interface CampaignCreateParams {
  name: string;
  delivery_goal_group?: string;
  objective?: string;
  purchase_order?: string;
  [key: string]: string | undefined;
}

export interface AdSet {
  id: string;
  name: string;
  campaign_id?: string;
  created_at?: string;
  updated_at?: string;
  status?: string;
  category?: string;
  start_time?: string;
  end_time?: string;
}

export interface AdSetsResponse {
  paging?: Paging;
  ad_sets: AdSet[];
}

export interface Ad {
  id: string;
  name?: string;
  ad_set_id?: string;
  created_at?: string;
  updated_at?: string;
  status?: string;
  ad_type?: string;
}

export interface AdsResponse {
  paging?: Paging;
  ads: Ad[];
}

export interface ListQueryParams {
  offset?: number;
  page_size?: number;
  campaign_ids?: string[];
  statuses?: string[];
  fields?: string[];
  [key: string]: string | number | boolean | string[] | undefined;
}

export interface ApiErrorDetail {
  field?: string;
  message: string;
  code?: string;
}

export class SpotifyAdsApiError extends Error {
  public readonly statusCode: number;
  public readonly errors?: ApiErrorDetail[];
  public readonly requestId?: string;

  constructor(
    message: string,
    statusCode: number,
    options?: { errors?: ApiErrorDetail[]; requestId?: string }
  ) {
    super(message);
    this.name = 'SpotifyAdsApiError';
    this.statusCode = statusCode;
    this.errors = options?.errors;
    this.requestId = options?.requestId;
  }

  isRateLimited(): boolean {
    return this.statusCode === 429;
  }

  isServerError(): boolean {
    return this.statusCode >= 500 && this.statusCode < 600;
  }
}

export function parseApiError(response: unknown, statusCode: number): SpotifyAdsApiError {
  if (typeof response === 'string') {
    return new SpotifyAdsApiError(response, statusCode);
  }

  if (!response || typeof response !== 'object') {
    return new SpotifyAdsApiError(`HTTP ${statusCode} Error`, statusCode);
  }

  const data = response as Record<string, unknown>;
  const message =
    (data.message as string) ||
    (data.error as string) ||
    (data.error_description as string) ||
    (data.detail as string) ||
    `HTTP ${statusCode} Error`;

  const requestId =
    (data.sp_trace_id as string) ||
    (data.request_id as string) ||
    undefined;

  return new SpotifyAdsApiError(message, statusCode, { requestId });
}
