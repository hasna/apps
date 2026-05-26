// SendGrid Connector Types

// ============================================
// Configuration
// ============================================

export interface SendGridConfig {
  apiKey: string;
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'pretty';

// ============================================
// Email Types
// ============================================

export interface EmailAddress {
  email: string;
  name?: string;
}

export interface Attachment {
  content: string; // Base64 encoded
  type?: string;
  filename: string;
  disposition?: 'inline' | 'attachment';
  content_id?: string;
}

export interface Personalization {
  to: EmailAddress[];
  cc?: EmailAddress[];
  bcc?: EmailAddress[];
  subject?: string;
  headers?: Record<string, string>;
  substitutions?: Record<string, string>;
  dynamic_template_data?: Record<string, unknown>;
  custom_args?: Record<string, string>;
  send_at?: number;
}

export interface MailContent {
  type: string;
  value: string;
}

export interface ASM {
  group_id: number;
  groups_to_display?: number[];
}

export interface MailSettings {
  bypass_list_management?: { enable?: boolean };
  bypass_spam_management?: { enable?: boolean };
  bypass_bounce_management?: { enable?: boolean };
  bypass_unsubscribe_management?: { enable?: boolean };
  footer?: { enable?: boolean; text?: string; html?: string };
  sandbox_mode?: { enable?: boolean };
}

export interface TrackingSettings {
  click_tracking?: { enable?: boolean; enable_text?: boolean };
  open_tracking?: { enable?: boolean; substitution_tag?: string };
  subscription_tracking?: { enable?: boolean; text?: string; html?: string; substitution_tag?: string };
  ganalytics?: {
    enable?: boolean;
    utm_source?: string;
    utm_medium?: string;
    utm_term?: string;
    utm_content?: string;
    utm_campaign?: string;
  };
}

export interface SendMailParams {
  personalizations: Personalization[];
  from: EmailAddress;
  reply_to?: EmailAddress;
  reply_to_list?: EmailAddress[];
  subject?: string;
  content?: MailContent[];
  attachments?: Attachment[];
  template_id?: string;
  headers?: Record<string, string>;
  categories?: string[];
  custom_args?: Record<string, string>;
  send_at?: number;
  batch_id?: string;
  asm?: ASM;
  ip_pool_name?: string;
  mail_settings?: MailSettings;
  tracking_settings?: TrackingSettings;
}

// ============================================
// Contact Types
// ============================================

export interface Contact {
  id?: string;
  email: string;
  phone_number_id?: string;
  external_id?: string;
  anonymous_id?: string;
  first_name?: string;
  last_name?: string;
  address_line_1?: string;
  address_line_2?: string;
  city?: string;
  state_province_region?: string;
  postal_code?: string;
  country?: string;
  alternate_emails?: string[];
  custom_fields?: Record<string, string | number>;
  created_at?: string;
  updated_at?: string;
}

export interface ContactListResponse {
  result: Contact[];
  _metadata?: {
    self?: string;
    count?: number;
  };
}

export interface ContactImportJob {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  job_type: string;
  results?: {
    requested_count?: number;
    created_count?: number;
    updated_count?: number;
    deleted_count?: number;
    errored_count?: number;
  };
  started_at?: string;
  finished_at?: string;
}

// ============================================
// List Types
// ============================================

export interface ContactList {
  id: string;
  name: string;
  contact_count: number;
  _metadata?: {
    self?: string;
  };
}

export interface ListListResponse {
  result: ContactList[];
  _metadata?: {
    self?: string;
    count?: number;
  };
}

// ============================================
// Template Types
// ============================================

export type TemplateGeneration = 'legacy' | 'dynamic';

export interface TemplateVersion {
  id: string;
  template_id: string;
  active: number;
  name: string;
  html_content?: string;
  plain_content?: string;
  generate_plain_content?: boolean;
  subject?: string;
  editor?: 'code' | 'design';
  test_data?: string;
  updated_at?: string;
}

export interface Template {
  id: string;
  name: string;
  generation: TemplateGeneration;
  updated_at?: string;
  versions?: TemplateVersion[];
}

export interface TemplateListResponse {
  result?: Template[];
  templates?: Template[];
  _metadata?: {
    self?: string;
    count?: number;
  };
}

export interface TemplateCreateParams {
  name: string;
  generation?: TemplateGeneration;
}

export interface TemplateVersionCreateParams {
  template_id: string;
  active?: number;
  name: string;
  html_content?: string;
  plain_content?: string;
  generate_plain_content?: boolean;
  subject?: string;
  editor?: 'code' | 'design';
  test_data?: string;
}

// ============================================
// Sender Types
// ============================================

export interface Sender {
  id: number;
  nickname: string;
  from: {
    email: string;
    name?: string;
  };
  reply_to?: {
    email: string;
    name?: string;
  };
  address: string;
  address_2?: string;
  city: string;
  state?: string;
  zip?: string;
  country: string;
  verified: {
    status: boolean;
    reason?: string;
  };
  updated_at?: number;
  created_at?: number;
  locked?: boolean;
}

export interface SenderListResponse {
  results: Sender[];
}

export interface SenderCreateParams {
  nickname: string;
  from: {
    email: string;
    name?: string;
  };
  reply_to?: {
    email: string;
    name?: string;
  };
  address: string;
  address_2?: string;
  city: string;
  state?: string;
  zip?: string;
  country: string;
}

// ============================================
// Stats Types
// ============================================

export interface Stats {
  date: string;
  stats: Array<{
    metrics: {
      blocks?: number;
      bounce_drops?: number;
      bounces?: number;
      clicks?: number;
      deferred?: number;
      delivered?: number;
      invalid_emails?: number;
      opens?: number;
      processed?: number;
      requests?: number;
      spam_report_drops?: number;
      spam_reports?: number;
      unique_clicks?: number;
      unique_opens?: number;
      unsubscribe_drops?: number;
      unsubscribes?: number;
    };
    name?: string;
    type?: string;
  }>;
}

// ============================================
// Suppression Types
// ============================================

export interface Bounce {
  email: string;
  created: number;
  reason?: string;
  status?: string;
}

export interface Block {
  email: string;
  created: number;
  reason?: string;
  status?: string;
}

export interface SpamReport {
  email: string;
  created: number;
  ip?: string;
}

export interface InvalidEmail {
  email: string;
  created: number;
  reason?: string;
}

export interface Unsubscribe {
  email: string;
  created: number;
  group_id?: number;
}

// ============================================
// Unsubscribe Group Types
// ============================================

export interface UnsubscribeGroup {
  id: number;
  name: string;
  description?: string;
  is_default?: boolean;
  unsubscribes?: number;
}

export interface UnsubscribeGroupCreateParams {
  name: string;
  description?: string;
  is_default?: boolean;
}

// ============================================
// API Key Types
// ============================================

export interface ApiKey {
  api_key_id: string;
  name: string;
  scopes?: string[];
}

export interface ApiKeyCreateParams {
  name: string;
  scopes?: string[];
}

export interface ApiKeyCreateResponse {
  api_key: string;
  api_key_id: string;
  name: string;
  scopes?: string[];
}

// ============================================
// API Error Types
// ============================================

export interface SendGridErrorDetail {
  field?: string;
  message: string;
  help?: unknown;
}

export interface SendGridErrorResponse {
  errors: SendGridErrorDetail[];
}

export class SendGridApiError extends Error {
  public readonly statusCode: number;
  public readonly errors?: SendGridErrorDetail[];

  constructor(message: string, statusCode: number, errors?: SendGridErrorDetail[]) {
    super(message);
    this.name = 'SendGridApiError';
    this.statusCode = statusCode;
    this.errors = errors;
  }
}
