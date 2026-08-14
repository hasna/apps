// Telnyx Connect Types

// ============================================
// Configuration
// ============================================

export interface TelnyxConfig {
  apiKey: string;
  baseUrl?: string;
}

export type OutputFormat = 'json' | 'pretty' | 'table';

// ============================================
// Errors
// ============================================

export interface TelnyxErrorDetail {
  code?: string;
  title?: string;
  detail?: string;
  source?: {
    pointer?: string;
    parameter?: string;
  };
  meta?: {
    url?: string;
  };
}

/**
 * Error thrown for non-2xx Telnyx API responses.
 * Telnyx returns errors as `{ "errors": [{ code, title, detail, ... }] }`.
 */
export class TelnyxApiError extends Error {
  readonly status: number;
  readonly errors: TelnyxErrorDetail[];
  readonly code?: string;

  constructor(message: string, status: number, errors: TelnyxErrorDetail[] = []) {
    super(message);
    this.name = 'TelnyxApiError';
    this.status = status;
    this.errors = errors;
    this.code = errors[0]?.code;
  }

  isRateLimited(): boolean {
    return this.status === 429;
  }

  isAuthError(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

// ============================================
// Common response envelope
// ============================================

export interface TelnyxPageMeta {
  total_pages?: number;
  total_results?: number;
  page_number?: number;
  page_size?: number;
}

export interface TelnyxResponse<T> {
  data: T;
  meta?: TelnyxPageMeta;
}

export interface TelnyxListResponse<T> {
  data: T[];
  meta?: TelnyxPageMeta;
}

// ============================================
// Messages
// ============================================

export interface SendMessageParams {
  from?: string;
  to: string;
  text?: string;
  messaging_profile_id?: string;
  subject?: string;
  media_urls?: string[];
  webhook_url?: string;
  webhook_failover_url?: string;
  use_profile_webhooks?: boolean;
  type?: 'SMS' | 'MMS';
}

export interface MessageCostBreakdown {
  amount?: string;
  currency?: string;
}

export interface MessageRecipient {
  phone_number: string;
  status?: string;
  carrier?: string;
  line_type?: string;
}

export interface Message {
  record_type: string;
  direction: string;
  id: string;
  type: string;
  messaging_profile_id: string | null;
  organization_id?: string;
  from: { phone_number: string; carrier?: string; line_type?: string };
  to: MessageRecipient[];
  text: string | null;
  subject?: string | null;
  media?: unknown[];
  webhook_url?: string | null;
  encoding?: string;
  parts?: number;
  cost?: MessageCostBreakdown | null;
  received_at?: string | null;
  sent_at?: string | null;
  completed_at?: string | null;
  valid_until?: string | null;
  errors?: TelnyxErrorDetail[];
}

// ============================================
// Phone Numbers
// ============================================

export interface PhoneNumber {
  record_type: string;
  id: string;
  phone_number: string;
  status?: string;
  connection_id?: string | null;
  connection_name?: string | null;
  messaging_profile_id?: string | null;
  messaging_profile_name?: string | null;
  phone_number_type?: string;
  purchased_at?: string;
  created_at?: string;
  tags?: string[];
}

export interface ListPhoneNumbersParams {
  page_number?: number;
  page_size?: number;
  status?: string;
  tag?: string;
  phone_number?: string;
  voice_connection_name?: string;
}

// ============================================
// Available Phone Numbers (search)
// ============================================

export interface AvailablePhoneNumberFeature {
  name: string;
}

export interface AvailablePhoneNumberCostInformation {
  monthly_cost?: string;
  upfront_cost?: string;
  currency?: string;
}

export interface AvailablePhoneNumber {
  record_type: string;
  phone_number: string;
  vanity_format?: string | null;
  best_effort?: boolean;
  quickship?: boolean;
  reservable?: boolean;
  phone_number_type?: string;
  features?: AvailablePhoneNumberFeature[];
  cost_information?: AvailablePhoneNumberCostInformation;
  region_information?: { region_type?: string; region_name?: string }[];
}

export interface SearchAvailableNumbersParams {
  country_code?: string;
  starts_with?: string;
  ends_with?: string;
  contains?: string;
  locality?: string;
  administrative_area?: string;
  national_destination_code?: string;
  phone_number_type?: string;
  features?: string[];
  limit?: number;
  best_effort?: boolean;
  quickship?: boolean;
  reservable?: boolean;
  exclude_held_numbers?: boolean;
}

// ============================================
// Messaging Profiles
// ============================================

export interface MessagingProfile {
  record_type: string;
  id: string;
  name: string;
  enabled?: boolean;
  webhook_url?: string | null;
  webhook_failover_url?: string | null;
  webhook_api_version?: string;
  whitelisted_destinations?: string[];
  created_at?: string;
  updated_at?: string;
}

export interface ListMessagingProfilesParams {
  page_number?: number;
  page_size?: number;
  name?: string;
}

// ============================================
// Number Lookup
// ============================================

export interface NumberLookupResult {
  record_type: string;
  country_code?: string;
  national_format?: string;
  phone_number?: string;
  fraud?: unknown;
  carrier?: {
    mobile_country_code?: string | null;
    mobile_network_code?: string | null;
    name?: string | null;
    type?: string | null;
    error_code?: string | null;
  };
  caller_name?: {
    caller_name?: string | null;
    error_code?: string | null;
  };
  portability?: unknown;
}

export interface NumberLookupParams {
  /** Comma-separated list of enrichments, e.g. "carrier", "caller-name" */
  type?: string;
}
