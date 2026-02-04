// Resend API Types

// ============================================
// Configuration
// ============================================

export interface ResendConfig {
  apiKey: string;
  baseUrl?: string;
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'pretty';

export interface ListResponse<T> {
  data: T[];
}

// ============================================
// Email Types
// ============================================

export interface EmailAddress {
  email: string;
  name?: string;
}

export type EmailRecipient = string | EmailAddress;

export interface Attachment {
  filename: string;
  content?: string; // Base64 encoded
  path?: string; // URL to the file
  content_type?: string;
}

export interface Tag {
  name: string;
  value: string;
}

export interface SendEmailParams {
  from: string;
  to: EmailRecipient | EmailRecipient[];
  subject: string;
  html?: string;
  text?: string;
  cc?: EmailRecipient | EmailRecipient[];
  bcc?: EmailRecipient | EmailRecipient[];
  reply_to?: EmailRecipient | EmailRecipient[];
  headers?: Record<string, string>;
  attachments?: Attachment[];
  tags?: Tag[];
  scheduled_at?: string; // ISO 8601 format
}

export interface BatchEmailParams {
  emails: SendEmailParams[];
}

export interface SendEmailResponse {
  id: string;
}

export interface BatchEmailResponse {
  data: SendEmailResponse[];
}

export interface Email {
  id: string;
  object: 'email';
  to: string[];
  from: string;
  created_at: string;
  subject: string;
  html: string | null;
  text: string | null;
  bcc: string[] | null;
  cc: string[] | null;
  reply_to: string[] | null;
  last_event: string;
  scheduled_at: string | null;
}

export interface UpdateEmailParams {
  scheduled_at?: string; // ISO 8601 format, must be within 7 days
}

// ============================================
// Template Types (requires Resend Emails plan)
// ============================================

export interface Template {
  id: string;
  name: string;
  subject: string;
  html: string;
  text?: string;
  created_at: string;
  updated_at: string;
}

export interface CreateTemplateParams {
  name: string;
  subject: string;
  html: string;
  text?: string;
}

export interface UpdateTemplateParams {
  name?: string;
  subject?: string;
  html?: string;
  text?: string;
}

export interface DuplicateTemplateParams {
  name?: string;
}

// ============================================
// Domain Types
// ============================================

export type DomainStatus = 'pending' | 'verified' | 'failed' | 'temporary_failure' | 'not_started';

export interface DnsRecord {
  record: string;
  name: string;
  type: string;
  ttl: string;
  status: DomainStatus;
  value: string;
  priority?: number;
}

export interface Domain {
  id: string;
  name: string;
  status: DomainStatus;
  created_at: string;
  region: string;
  records: DnsRecord[];
}

export interface CreateDomainParams {
  name: string;
  region?: 'us-east-1' | 'eu-west-1' | 'sa-east-1';
}

export interface UpdateDomainParams {
  click_tracking?: boolean;
  open_tracking?: boolean;
  tls?: 'enforced' | 'opportunistic';
}

export interface VerifyDomainResponse {
  object: 'domain';
  id: string;
}

// ============================================
// API Key Types
// ============================================

export type ApiKeyPermission = 'full_access' | 'sending_access';

export interface ApiKey {
  id: string;
  name: string;
  created_at: string;
}

export interface ApiKeyWithToken extends ApiKey {
  token: string;
}

export interface CreateApiKeyParams {
  name: string;
  permission?: ApiKeyPermission;
  domain_id?: string;
}

// ============================================
// Audience Types
// ============================================

export interface Audience {
  id: string;
  name: string;
  created_at: string;
}

export interface CreateAudienceParams {
  name: string;
}

// ============================================
// Contact Types
// ============================================

export interface Contact {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  created_at: string;
  unsubscribed: boolean;
}

export interface CreateContactParams {
  email: string;
  first_name?: string;
  last_name?: string;
  unsubscribed?: boolean;
  audience_id: string;
}

export interface UpdateContactParams {
  first_name?: string;
  last_name?: string;
  unsubscribed?: boolean;
}

// ============================================
// Webhook Types
// ============================================

export type WebhookEvent =
  | 'email.sent'
  | 'email.delivered'
  | 'email.delivery_delayed'
  | 'email.complained'
  | 'email.bounced'
  | 'email.opened'
  | 'email.clicked';

export interface Webhook {
  id: string;
  endpoint_url: string;
  events: WebhookEvent[];
  created_at: string;
}

export interface CreateWebhookParams {
  endpoint_url: string;
  events: WebhookEvent[];
}

export interface UpdateWebhookParams {
  endpoint_url?: string;
  events?: WebhookEvent[];
}

// ============================================
// Broadcast Types
// ============================================

export type BroadcastStatus = 'draft' | 'queued' | 'sending' | 'sent' | 'cancelled';

export interface Broadcast {
  id: string;
  name: string;
  audience_id: string;
  from: string;
  subject: string;
  reply_to: string[] | null;
  preview_text: string | null;
  status: BroadcastStatus;
  created_at: string;
  scheduled_at: string | null;
  sent_at: string | null;
}

export interface CreateBroadcastParams {
  name: string;
  audience_id: string;
  from: string;
  subject: string;
  reply_to?: string[];
  preview_text?: string;
  html?: string;
  text?: string;
}

export interface UpdateBroadcastParams {
  name?: string;
  audience_id?: string;
  from?: string;
  subject?: string;
  reply_to?: string[];
  preview_text?: string;
  html?: string;
  text?: string;
}

export interface SendBroadcastParams {
  scheduled_at?: string; // ISO 8601 format
}

export interface SendBroadcastResponse {
  id: string;
}

// ============================================
// API Error Types
// ============================================

export interface ApiErrorDetail {
  message: string;
  name?: string;
}

export class ResendApiError extends Error {
  public readonly statusCode: number;
  public readonly errorName?: string;

  constructor(message: string, statusCode: number, errorName?: string) {
    super(message);
    this.name = 'ResendApiError';
    this.statusCode = statusCode;
    this.errorName = errorName;
  }
}
