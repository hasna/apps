// Mailchimp Connector Types

// ============================================
// Configuration
// ============================================

export interface MailchimpConfig {
  apiKey: string;
  serverPrefix?: string;
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'pretty';

export interface Link {
  rel: string;
  href: string;
  method: string;
  targetSchema?: string;
  schema?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total_items: number;
  _links?: Link[];
}

// ============================================
// List/Audience Types
// ============================================

export interface List {
  id: string;
  web_id: number;
  name: string;
  contact: {
    company: string;
    address1: string;
    address2?: string;
    city: string;
    state: string;
    zip: string;
    country: string;
    phone?: string;
  };
  permission_reminder: string;
  use_archive_bar: boolean;
  campaign_defaults: {
    from_name: string;
    from_email: string;
    subject: string;
    language: string;
  };
  notify_on_subscribe?: string;
  notify_on_unsubscribe?: string;
  date_created: string;
  list_rating: number;
  email_type_option: boolean;
  subscribe_url_short?: string;
  subscribe_url_long?: string;
  beamer_address?: string;
  visibility?: string;
  double_optin: boolean;
  has_welcome: boolean;
  marketing_permissions: boolean;
  modules?: string[];
  stats: ListStats;
  _links?: Link[];
}

export interface ListStats {
  member_count: number;
  total_contacts: number;
  unsubscribe_count: number;
  cleaned_count: number;
  member_count_since_send: number;
  unsubscribe_count_since_send: number;
  cleaned_count_since_send: number;
  campaign_count: number;
  campaign_last_sent?: string;
  merge_field_count: number;
  avg_sub_rate: number;
  avg_unsub_rate: number;
  target_sub_rate: number;
  open_rate: number;
  click_rate: number;
  last_sub_date?: string;
  last_unsub_date?: string;
}

export interface ListListResponse extends PaginatedResponse<List> {
  lists: List[];
}

export interface ListCreateParams {
  name: string;
  contact: {
    company: string;
    address1: string;
    address2?: string;
    city: string;
    state: string;
    zip: string;
    country: string;
    phone?: string;
  };
  permission_reminder: string;
  campaign_defaults: {
    from_name: string;
    from_email: string;
    subject: string;
    language: string;
  };
  email_type_option?: boolean;
  double_optin?: boolean;
  marketing_permissions?: boolean;
}

// ============================================
// Member Types
// ============================================

export type MemberStatus = 'subscribed' | 'unsubscribed' | 'cleaned' | 'pending' | 'transactional' | 'archived';

export interface Member {
  id: string;
  email_address: string;
  unique_email_id: string;
  contact_id?: string;
  full_name?: string;
  web_id: number;
  email_type?: string;
  status: MemberStatus;
  unsubscribe_reason?: string;
  consents_to_one_to_one_messaging?: boolean;
  merge_fields?: Record<string, unknown>;
  interests?: Record<string, boolean>;
  stats: MemberStats;
  ip_signup?: string;
  timestamp_signup?: string;
  ip_opt?: string;
  timestamp_opt?: string;
  member_rating: number;
  last_changed: string;
  language?: string;
  vip: boolean;
  email_client?: string;
  location?: MemberLocation;
  marketing_permissions?: MarketingPermission[];
  last_note?: {
    note_id: number;
    created_at: string;
    created_by: string;
    note: string;
  };
  source?: string;
  tags_count: number;
  tags?: Tag[];
  list_id: string;
  _links?: Link[];
}

export interface MemberStats {
  avg_open_rate: number;
  avg_click_rate: number;
  ecommerce_data?: {
    total_revenue: number;
    number_of_orders: number;
    currency_code: string;
  };
}

export interface MemberLocation {
  latitude?: number;
  longitude?: number;
  gmtoff?: number;
  dstoff?: number;
  country_code?: string;
  timezone?: string;
  region?: string;
}

export interface MarketingPermission {
  marketing_permission_id: string;
  text: string;
  enabled: boolean;
}

export interface MemberListResponse extends PaginatedResponse<Member> {
  members: Member[];
  list_id: string;
}

export interface MemberCreateParams {
  email_address: string;
  status: MemberStatus;
  email_type?: 'html' | 'text';
  merge_fields?: Record<string, unknown>;
  interests?: Record<string, boolean>;
  language?: string;
  vip?: boolean;
  location?: {
    latitude?: number;
    longitude?: number;
  };
  marketing_permissions?: Array<{
    marketing_permission_id: string;
    enabled: boolean;
  }>;
  ip_signup?: string;
  timestamp_signup?: string;
  ip_opt?: string;
  timestamp_opt?: string;
  tags?: string[];
}

export interface MemberUpdateParams {
  email_address?: string;
  status?: MemberStatus;
  email_type?: 'html' | 'text';
  merge_fields?: Record<string, unknown>;
  interests?: Record<string, boolean>;
  language?: string;
  vip?: boolean;
  location?: {
    latitude?: number;
    longitude?: number;
  };
  marketing_permissions?: Array<{
    marketing_permission_id: string;
    enabled: boolean;
  }>;
}

// ============================================
// Campaign Types
// ============================================

export type CampaignType = 'regular' | 'plaintext' | 'absplit' | 'rss' | 'variate';
export type CampaignStatus = 'save' | 'paused' | 'schedule' | 'sending' | 'sent' | 'canceled' | 'canceling' | 'archived';

export interface Campaign {
  id: string;
  web_id: number;
  parent_campaign_id?: string;
  type: CampaignType;
  create_time: string;
  archive_url?: string;
  long_archive_url?: string;
  status: CampaignStatus;
  emails_sent: number;
  send_time?: string;
  content_type?: string;
  needs_block_refresh?: boolean;
  resendable?: boolean;
  recipients: {
    list_id: string;
    list_is_active?: boolean;
    list_name?: string;
    segment_text?: string;
    recipient_count: number;
    segment_opts?: {
      saved_segment_id?: number;
      match?: 'any' | 'all';
      conditions?: unknown[];
    };
  };
  settings: CampaignSettings;
  tracking: CampaignTracking;
  report_summary?: CampaignReportSummary;
  delivery_status?: {
    enabled: boolean;
    can_cancel?: boolean;
    status?: string;
    emails_sent?: number;
    emails_canceled?: number;
  };
  _links?: Link[];
}

export interface CampaignSettings {
  subject_line?: string;
  preview_text?: string;
  title?: string;
  from_name?: string;
  reply_to?: string;
  use_conversation?: boolean;
  to_name?: string;
  folder_id?: string;
  authenticate?: boolean;
  auto_footer?: boolean;
  inline_css?: boolean;
  auto_tweet?: boolean;
  fb_comments?: boolean;
  timewarp?: boolean;
  template_id?: number;
  drag_and_drop?: boolean;
}

export interface CampaignTracking {
  opens: boolean;
  html_clicks: boolean;
  text_clicks: boolean;
  goal_tracking?: boolean;
  ecomm360?: boolean;
  google_analytics?: string;
  clicktale?: string;
}

export interface CampaignReportSummary {
  opens: number;
  unique_opens: number;
  open_rate: number;
  clicks: number;
  subscriber_clicks: number;
  click_rate: number;
  ecommerce?: {
    total_orders: number;
    total_spent: number;
    total_revenue: number;
  };
}

export interface CampaignListResponse extends PaginatedResponse<Campaign> {
  campaigns: Campaign[];
}

export interface CampaignCreateParams {
  type: CampaignType;
  recipients?: {
    list_id: string;
    segment_opts?: {
      saved_segment_id?: number;
      match?: 'any' | 'all';
      conditions?: unknown[];
    };
  };
  settings?: CampaignSettings;
  tracking?: Partial<CampaignTracking>;
  content_type?: 'template' | 'html' | 'url' | 'multichannel';
}

// ============================================
// Template Types
// ============================================

export type TemplateType = 'user' | 'base' | 'gallery';

export interface Template {
  id: number;
  type: TemplateType;
  name: string;
  drag_and_drop: boolean;
  responsive: boolean;
  category?: string;
  date_created: string;
  date_edited?: string;
  created_by?: string;
  edited_by?: string;
  active: boolean;
  folder_id?: string;
  thumbnail?: string;
  share_url?: string;
  content_type?: string;
  _links?: Link[];
}

export interface TemplateListResponse extends PaginatedResponse<Template> {
  templates: Template[];
}

export interface TemplateCreateParams {
  name: string;
  html: string;
  folder_id?: string;
}

// ============================================
// Tag Types
// ============================================

export interface Tag {
  id: number;
  name: string;
  member_count?: number;
  date_added?: string;
  _links?: Link[];
}

export interface TagListResponse extends PaginatedResponse<Tag> {
  tags: Tag[];
  list_id: string;
}

// ============================================
// Segment Types
// ============================================

export interface Segment {
  id: number;
  name: string;
  member_count: number;
  type: 'saved' | 'static' | 'fuzzy';
  created_at: string;
  updated_at: string;
  options?: {
    match?: 'any' | 'all';
    conditions?: unknown[];
  };
  list_id: string;
  _links?: Link[];
}

export interface SegmentListResponse extends PaginatedResponse<Segment> {
  segments: Segment[];
  list_id: string;
}

// ============================================
// Report Types
// ============================================

export interface Report {
  id: string;
  campaign_title?: string;
  type: CampaignType;
  list_id: string;
  list_is_active: boolean;
  list_name: string;
  subject_line?: string;
  preview_text?: string;
  emails_sent: number;
  abuse_reports: number;
  unsubscribed: number;
  send_time?: string;
  bounces: {
    hard_bounces: number;
    soft_bounces: number;
    syntax_errors: number;
  };
  forwards: {
    forwards_count: number;
    forwards_opens: number;
  };
  opens: {
    opens_total: number;
    unique_opens: number;
    open_rate: number;
    last_open?: string;
  };
  clicks: {
    clicks_total: number;
    unique_clicks: number;
    unique_subscriber_clicks: number;
    click_rate: number;
    last_click?: string;
  };
  facebook_likes?: {
    recipient_likes: number;
    unique_likes: number;
    facebook_likes: number;
  };
  industry_stats?: {
    type: string;
    open_rate: number;
    click_rate: number;
    bounce_rate: number;
    unopen_rate: number;
    unsub_rate: number;
    abuse_rate: number;
  };
  list_stats?: {
    sub_rate: number;
    unsub_rate: number;
    open_rate: number;
    click_rate: number;
  };
  timeseries?: Array<{
    timestamp: string;
    emails_sent: number;
    unique_opens: number;
    recipients_clicks: number;
  }>;
  share_report?: {
    share_url: string;
    share_password: string;
  };
  ecommerce?: {
    total_orders: number;
    total_spent: number;
    total_revenue: number;
    currency_code: string;
  };
  delivery_status?: {
    enabled: boolean;
    can_cancel?: boolean;
    status?: string;
    emails_sent?: number;
    emails_canceled?: number;
  };
  _links?: Link[];
}

export interface ReportListResponse extends PaginatedResponse<Report> {
  reports: Report[];
}

// ============================================
// Account/Root Types
// ============================================

export interface AccountInfo {
  account_id: string;
  login_id: string;
  account_name: string;
  email: string;
  first_name: string;
  last_name: string;
  username?: string;
  avatar_url?: string;
  role?: string;
  member_since: string;
  pricing_plan_type: string;
  first_payment?: string;
  account_timezone?: string;
  account_industry?: string;
  contact: {
    company: string;
    addr1: string;
    addr2?: string;
    city: string;
    state: string;
    zip: string;
    country: string;
  };
  pro_enabled: boolean;
  last_login?: string;
  total_subscribers: number;
  industry_stats?: {
    open_rate: number;
    bounce_rate: number;
    click_rate: number;
  };
  _links?: Link[];
}

// ============================================
// API Error Types
// ============================================

export interface MailchimpErrorDetail {
  field?: string;
  message: string;
}

export interface MailchimpErrorResponse {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
  errors?: MailchimpErrorDetail[];
}

export class MailchimpApiError extends Error {
  public readonly statusCode: number;
  public readonly type?: string;
  public readonly title?: string;
  public readonly detail?: string;
  public readonly errors?: MailchimpErrorDetail[];

  constructor(message: string, statusCode: number, type?: string, title?: string, detail?: string, errors?: MailchimpErrorDetail[]) {
    super(message);
    this.name = 'MailchimpApiError';
    this.statusCode = statusCode;
    this.type = type;
    this.title = title;
    this.detail = detail;
    this.errors = errors;
  }
}
