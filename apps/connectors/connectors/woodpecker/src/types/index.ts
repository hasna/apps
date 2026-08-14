// Woodpecker API Types
// https://developers.woodpecker.co/docs/

export interface WoodpeckerConfig {
  apiKey: string;
  baseUrl?: string;
}

export interface OAuth2Config {
  clientId: string;
  clientSecret: string;
  redirectUri?: string;
}

export interface OAuth2Tokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  tokenType?: string;
  scope?: string;
}

export type OutputFormat = 'json' | 'pretty';

export type CampaignStatus =
  | 'RUNNING'
  | 'DRAFT'
  | 'EDITED'
  | 'PAUSED'
  | 'STOPPED'
  | 'COMPLETED';

export interface CampaignSummary {
  id: number;
  name: string;
  status: CampaignStatus;
  created?: string;
  from_name?: string;
  from_names?: string[];
  from_email?: string;
  from_emails?: string[];
  per_day?: number;
  folder_name?: string;
  folder_id?: number;
  gdpr_unsubscribe?: boolean;
  bcc?: string;
  cc?: string;
}

export interface CampaignSettings {
  timezone?: string;
  prospect_timezone?: boolean;
  daily_enroll?: number;
  gdpr_unsubscribe?: boolean;
  list_unsubscribe?: boolean;
  open_disabled_list?: string[];
  auto_pause_prospect_from_domain?: boolean;
  auto_pause_prospect_from_domain_statuses?: string[];
  catch_all_verification_mode?: 'NONE' | 'BALANCED' | 'MAXIMUM' | 'ONLY_VERIFY';
}

export interface Campaign {
  id: number;
  name: string;
  status: CampaignStatus;
  bounce_shield_autopaused_at?: string | null;
  email_account_ids?: number[];
  settings?: CampaignSettings;
  steps?: Record<string, unknown>;
}

export interface CreateCampaignParams {
  name: string;
  settings?: CampaignSettings;
  email_account_ids?: number[];
  steps?: Record<string, unknown>;
}

export interface ListCampaignsParams {
  status?: string;
  id?: string;
}

export interface WebhookSubscription {
  target_url: string;
  event: string;
}

export interface WebhooksResponse {
  webhooks: WebhookSubscription[];
}

export interface ProspectSearchParams {
  search: string;
  campaigns_details?: boolean;
  page?: number;
  per_page?: number;
  sort?: string;
  id?: string;
  status?: string;
  campaigns_id?: string;
  contacted?: boolean;
  interested?: string;
}

export interface Prospect {
  id: number;
  email: string;
  first_name?: string;
  last_name?: string;
  company?: string;
  status?: string;
  [key: string]: unknown;
}

export interface RawRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  path: string;
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | unknown[];
}

export class WoodpeckerApiError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'WoodpeckerApiError';
    this.statusCode = statusCode;
  }

  isRateLimited(): boolean {
    return this.statusCode === 429;
  }

  isAuthError(): boolean {
    return this.statusCode === 401 || this.statusCode === 403;
  }
}

export function parseApiError(response: unknown, statusCode: number): WoodpeckerApiError {
  if (typeof response === 'string') {
    return new WoodpeckerApiError(response, statusCode);
  }
  if (!response || typeof response !== 'object') {
    return new WoodpeckerApiError(`HTTP ${statusCode} Error`, statusCode);
  }
  const data = response as Record<string, unknown>;
  const message =
    (data.message as string) ||
    (data.error as string) ||
    ((data.error as Record<string, unknown>)?.message as string) ||
    (data.detail as string) ||
    `HTTP ${statusCode} Error`;
  return new WoodpeckerApiError(message, statusCode);
}
