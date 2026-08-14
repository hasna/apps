// Maropost API Types

// ============================================
// Configuration
// ============================================

export interface MaropostConfig {
  apiKey: string;        // auth_token
  accountId: number;     // account_id in URL path
  baseUrl?: string;      // Override default base URL
}

// Alias for backward compatibility with scaffold
export type ConnectorConfig = MaropostConfig;

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'pretty';

export interface PaginatedResponse<T> {
  data: T[];
  total_pages: number;
  current_page: number;
}

export interface PaginationParams {
  page?: number;
  per?: number;
}

// ============================================
// Contact Types
// ============================================

export interface Contact {
  id: number;
  account_id: number;
  email: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
  fax?: string;
  uid?: string;
  created_at: string;
  updated_at: string;
  custom_fields?: Record<string, string>;
  tags?: string[];
  subscribed?: boolean;
}

export interface ContactListResponse {
  contacts: Contact[];
  total_pages: number;
  current_page: number;
}

export interface CreateContactParams {
  email: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
  fax?: string;
  custom_field?: Record<string, string>;
  tags?: string[];
  remove_tags?: string[];
  subscribe?: boolean;
  list_ids?: string;
}

export interface UpdateContactParams {
  first_name?: string;
  last_name?: string;
  phone?: string;
  fax?: string;
  custom_field?: Record<string, string>;
  tags?: string[];
  remove_tags?: string[];
  subscribe?: boolean;
}

// ============================================
// List Types
// ============================================

export interface List {
  id: number;
  account_id: number;
  name: string;
  subscribe_email?: string;
  unsubscribe_email?: string;
  post_url?: string;
  contact_count?: number;
  created_at: string;
  updated_at: string;
}

export interface ListResponse {
  lists: List[];
  total_pages: number;
  current_page: number;
}

export interface CreateListParams {
  name: string;
  subscribe_email?: string;
  unsubscribe_email?: string;
  post_url?: string;
}

export interface UpdateListParams {
  name?: string;
  subscribe_email?: string;
  unsubscribe_email?: string;
  post_url?: string;
}

// ============================================
// Campaign Types
// ============================================

export interface Campaign {
  id: number;
  account_id: number;
  name: string;
  subject: string;
  from_name: string;
  from_email: string;
  reply_to_email?: string;
  status: string;
  type: string;
  created_at: string;
  updated_at: string;
  send_at?: string;
  total_sent?: number;
  content_id?: number;
}

export interface CampaignListResponse {
  campaigns: Campaign[];
  total_pages: number;
  current_page: number;
}

export interface CampaignReportRecord {
  account_id: number;
  campaign_id: number;
  contact_id: number;
  email: string;
  recorded_at: string;
  ip_address?: string;
  browser?: string;
  url?: string;
  content_url_id?: number;
}

export interface CampaignReportResponse {
  data: CampaignReportRecord[];
  total_pages: number;
  current_page: number;
}

// ============================================
// Report Types
// ============================================

export interface ReportFilters {
  page?: number;
  fields?: string[];
  from?: string;
  to?: string;
  unique?: boolean;
  email?: string;
  uid?: string;
  per?: number;
}

export interface OpenReport {
  account_id: number;
  campaign_id: number;
  contact_id: number;
  email: string;
  recorded_at: string;
  ip_address?: string;
  browser?: string;
}

export interface ClickReport {
  account_id: number;
  campaign_id: number;
  contact_id: number;
  email: string;
  recorded_at: string;
  ip_address?: string;
  browser?: string;
  url: string;
  content_url_id?: number;
}

export interface BounceReport {
  account_id: number;
  campaign_id: number;
  contact_id: number;
  email: string;
  recorded_at: string;
  bounce_type?: 'soft' | 'hard';
  reason?: string;
}

export interface UnsubscribeReport {
  account_id: number;
  campaign_id: number;
  contact_id: number;
  email: string;
  recorded_at: string;
  reason?: string;
}

export interface ComplaintReport {
  account_id: number;
  campaign_id: number;
  contact_id: number;
  email: string;
  recorded_at: string;
}

export interface ReportListResponse<T> {
  data: T[];
  total_pages: number;
  current_page: number;
}

// ============================================
// Journey Types
// ============================================

export interface Journey {
  id: number;
  account_id: number;
  name: string;
  status: 'active' | 'paused' | 'draft';
  created_at: string;
  updated_at: string;
}

export interface JourneyResponse {
  journeys: Journey[];
  total_pages: number;
  current_page: number;
}

export interface JourneyContact {
  journey_id: number;
  contact_id: number;
  status: 'active' | 'paused' | 'completed' | 'stopped';
  current_step?: string;
  entered_at: string;
}

// ============================================
// Transactional Email Types
// ============================================

export interface TransactionalRecipient {
  address: {
    email: string;
    name?: string;
  };
  substitution_data?: Record<string, string>;
}

export interface TransactionalContent {
  subject: string;
  html?: string;
  text?: string;
  template_id?: string;
  from?: {
    email: string;
    name?: string;
  };
  reply_to?: string;
}

export interface TransactionalEmailParams {
  options?: {
    description?: string;
    tracking_domain?: string;
  };
  recipients: TransactionalRecipient[];
  content: TransactionalContent;
}

export interface TransactionalEmailResponse {
  id: string;
  status: string;
  message?: string;
}

// ============================================
// Webhook Types
// ============================================

export interface WebhookPayload {
  account_id: number;
  list_id?: number;
  contact: Contact;
  action: 'subscribe' | 'unsubscribe' | 'update' | 'delete';
  changed_at: string;
  changed_attribute?: {
    field: string;
    old_value?: string;
    new_value?: string;
  };
}

// ============================================
// API Error Types
// ============================================

export interface ApiErrorDetail {
  code: string;
  message: string;
  field?: string;
}

export class MaropostApiError extends Error {
  public readonly statusCode: number;
  public readonly errors?: ApiErrorDetail[];

  constructor(message: string, statusCode: number, errors?: ApiErrorDetail[]) {
    super(message);
    this.name = 'MaropostApiError';
    this.statusCode = statusCode;
    this.errors = errors;
  }
}

// Alias for backward compatibility
export const ConnectorApiError = MaropostApiError;
