// SparkPost Connector Types

export type SparkPostRegion = 'us' | 'eu';

export interface SparkPostConfig {
  apiKey: string;
  region?: SparkPostRegion;
}

export type OutputFormat = 'json' | 'pretty';

export interface SparkPostErrorDetail {
  message: string;
  code?: string;
  description?: string;
}

export class SparkPostApiError extends Error {
  readonly status: number;
  readonly errors?: SparkPostErrorDetail[];

  constructor(message: string, status: number, errors?: SparkPostErrorDetail[]) {
    super(message);
    this.name = 'SparkPostApiError';
    this.status = status;
    this.errors = errors;
  }
}

// ============================================
// Transmission Types
// ============================================

export interface TransmissionRecipient {
  address: string | { email: string; name?: string };
  substitution_data?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  tags?: string[];
}

export interface TransmissionContent {
  from: string | { email: string; name?: string };
  subject?: string;
  text?: string;
  html?: string;
  amp_html?: string;
  reply_to?: string;
  headers?: Record<string, string>;
  template_id?: string;
  use_draft_template?: boolean;
}

export interface TransmissionOptions {
  open_tracking?: boolean;
  click_tracking?: boolean;
  transactional?: boolean;
  sandbox?: boolean;
  ip_pool?: string;
  start_time?: string;
}

export interface SendTransmissionParams {
  recipients: TransmissionRecipient[];
  content: TransmissionContent;
  options?: TransmissionOptions;
  campaign_id?: string;
  description?: string;
  metadata?: Record<string, unknown>;
  substitution_data?: Record<string, unknown>;
  return_path?: string;
}

export interface Transmission {
  id: string;
  state?: string;
  num_rcpt?: number;
  num_generated?: number;
  num_failed_generation?: number;
  total_accepted_recipients?: number;
  total_rejected_recipients?: number;
  description?: string;
  campaign_id?: string;
  return_path?: string;
  metadata?: Record<string, unknown>;
}

export interface TransmissionListResponse {
  results: Transmission[];
}

export interface SendTransmissionResponse {
  results: {
    total_accepted_recipients: number;
    total_rejected_recipients: number;
    id: string;
  };
}

// ============================================
// Template Types
// ============================================

export interface TemplateContent {
  from?: string | { email: string; name?: string };
  subject?: string;
  text?: string;
  html?: string;
  amp_html?: string;
  reply_to?: string;
  headers?: Record<string, string>;
}

export interface Template {
  id: string;
  name?: string;
  description?: string;
  published?: boolean;
  shared_with_subaccounts?: boolean;
  content?: TemplateContent;
  options?: Record<string, unknown>;
  last_update_time?: string;
}

export interface TemplateListResponse {
  results: Template[];
}

export interface CreateTemplateParams {
  id: string;
  name?: string;
  description?: string;
  content?: TemplateContent;
  options?: Record<string, unknown>;
  shared_with_subaccounts?: boolean;
}

// ============================================
// Sending Domain Types
// ============================================

export interface SendingDomain {
  domain: string;
  dkim?: Record<string, unknown>;
  cname?: Record<string, unknown>;
  abuse_at?: Record<string, unknown>;
  postmaster_at?: Record<string, unknown>;
  tracking_domain?: string;
  is_default_bounce_domain?: boolean;
  shared_with_subaccounts?: boolean;
}

export interface SendingDomainListResponse {
  results: SendingDomain[];
}

export interface CreateSendingDomainParams {
  domain: string;
  dkim?: { signing_domain?: string; selector?: string; private?: string; public?: string };
  tracking_domain?: string;
  shared_with_subaccounts?: boolean;
}

// ============================================
// Suppression Types
// ============================================

export interface SuppressionEntry {
  recipient: string;
  type: string;
  description?: string;
  source?: string;
  created?: string;
  updated?: string;
  transactional?: boolean;
}

export interface SuppressionListResponse {
  results: SuppressionEntry[];
}

// ============================================
// Webhook Types
// ============================================

export interface Webhook {
  id: string;
  name: string;
  target: string;
  events: string[];
  auth_type?: string;
  auth_token?: string;
  active?: boolean;
}

export interface WebhookListResponse {
  results: Webhook[];
}

export interface CreateWebhookParams {
  name: string;
  target: string;
  events: string[];
  auth_type?: string;
  auth_token?: string;
}

// ============================================
// Recipient List Types
// ============================================

export interface RecipientList {
  id: string;
  name?: string;
  description?: string;
  recipient_count?: number;
}

export interface RecipientListListResponse {
  results: RecipientList[];
}

// ============================================
// IP Pool Types
// ============================================

export interface IpPool {
  id: string;
  name: string;
  ips?: string[];
}

export interface IpPoolListResponse {
  results: IpPool[];
}

// ============================================
// Account Types
// ============================================

export interface Account {
  company_name?: string;
  country_code?: string;
  plan?: string;
  status?: string;
  subscription?: Record<string, unknown>;
  options?: Record<string, unknown>;
}

export interface Subaccount {
  id: number;
  name: string;
  status?: string;
  compliance_status?: string;
  ip_pool?: string;
}

export interface SubaccountListResponse {
  results: Subaccount[];
}

// ============================================
// Inbound Domain Types
// ============================================

export interface InboundDomain {
  domain: string;
}

export interface InboundDomainListResponse {
  results: InboundDomain[];
}

// ============================================
// Recipient Validation Types
// ============================================

export interface RecipientValidationResult {
  valid: boolean;
  result: string;
  is_role?: boolean;
  is_disposable?: boolean;
  is_free?: boolean;
  did_you_mean?: string;
}

export interface RecipientValidationResponse {
  results: RecipientValidationResult;
}
