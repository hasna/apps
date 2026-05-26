// ActiveCampaign API Types

// ============================================
// Configuration
// ============================================

export interface ConnectorConfig {
  apiKey?: string;
  token?: string;
  apiSecret?: string;
  accessToken?: string;
  baseUrl?: string; // Required: account-specific URL e.g. https://youraccountname.api-us1.com
}

// ============================================
// OAuth2 Types
// ============================================

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

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'pretty';

export interface ListParams {
  limit?: number;
  offset?: number;
  orders?: Record<string, 'ASC' | 'DESC'>;
  filters?: Record<string, string | number>;
}

export interface MetaResponse {
  total: string;
  page_input?: {
    segmentid: number;
    formid: number;
    listid: number;
    tagid: number;
    limit: number;
    offset: number;
    search: string | null;
    sort: string | null;
    seriesid: number;
    waitid: number;
  };
}

// ============================================
// Contact Types
// ============================================

export interface Contact {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  orgid: string;
  orgname: string;
  segmentio_id: string;
  bounced_hard: string;
  bounced_soft: string;
  bounced_date: string | null;
  ip: string;
  ua: string | null;
  hash: string;
  socialdata_lastcheck: string | null;
  email_local: string;
  email_domain: string;
  sentcnt: string;
  rating_tstamp: string | null;
  gravatar: string;
  deleted: string;
  anonymized: string;
  adate: string | null;
  udate: string | null;
  edate: string | null;
  deleted_at: string | null;
  created_utc_timestamp: string;
  updated_utc_timestamp: string;
  created_timestamp: string;
  updated_timestamp: string;
  links: Record<string, string>;
}

export interface ContactCreateParams {
  email: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  fieldValues?: Array<{ field: string; value: string }>;
}

export interface ContactUpdateParams {
  email?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  fieldValues?: Array<{ field: string; value: string }>;
}

// ============================================
// Deal Types
// ============================================

export interface Deal {
  id: string;
  title: string;
  description: string;
  contact: string;
  account: string;
  value: string;
  currency: string;
  group: string;
  stage: string;
  owner: string;
  percent: string;
  status: string;
  cdate: string;
  mdate: string;
  edate: string | null;
  links: Record<string, string>;
}

export interface DealCreateParams {
  title: string;
  value: number;
  currency: string;
  group?: string;
  stage?: string;
  owner?: string;
  contact?: string;
  description?: string;
  percent?: number;
  status?: number;
  fields?: Array<{ customFieldId: number; fieldValue: string }>;
}

export interface DealUpdateParams {
  title?: string;
  value?: number;
  currency?: string;
  group?: string;
  stage?: string;
  owner?: string;
  contact?: string;
  description?: string;
  percent?: number;
  status?: number;
}

// ============================================
// Account Types
// ============================================

export interface Account {
  id: string;
  name: string;
  accountUrl: string;
  createdTimestamp: string;
  updatedTimestamp: string;
  links: Record<string, string>;
}

export interface AccountCreateParams {
  name: string;
  accountUrl?: string;
  fields?: Array<{ customFieldId: number; fieldValue: string }>;
}

// ============================================
// Campaign Types
// ============================================

export interface Campaign {
  id: string;
  type: string;
  userid: string;
  segmentid: string;
  bounceid: string;
  realcid: string;
  sendid: string;
  threadid: string;
  seriesid: string;
  formid: string;
  basetemplateid: string;
  basemessageid: string;
  addressid: string;
  source: string;
  name: string;
  cdate: string;
  mdate: string;
  sdate: string | null;
  ldate: string | null;
  send_amt: string;
  total_amt: string;
  opens: string;
  uniqueopens: string;
  linkclicks: string;
  uniquelinkclicks: string;
  subscriberclicks: string;
  forwards: string;
  uniqueforwards: string;
  hardbounces: string;
  softbounces: string;
  unsubscribes: string;
  unsubreasons: string;
  updates: string;
  socialshares: string;
  replies: string;
  uniquereplies: string;
  status: string;
  links: Record<string, string>;
}

// ============================================
// Tag Types
// ============================================

export interface Tag {
  id: string;
  tag: string;
  tagType: string;
  description: string;
  cdate: string;
  subscriber_count: string;
  links: Record<string, string>;
}

export interface TagCreateParams {
  tag: string;
  tagType: string;
  description?: string;
}

export interface ContactTag {
  id: string;
  contact: string;
  tag: string;
  cdate: string;
  links: Record<string, string>;
}

export interface ContactTagParams {
  contact: string;
  tag: string;
}

// ============================================
// List Types
// ============================================

export interface ContactList {
  id: string;
  stringid: string;
  userid: string;
  name: string;
  cdate: string;
  p_use_tracking: string;
  p_use_analytics_read: string;
  p_use_analytics_link: string;
  p_use_twitter: string;
  p_use_facebook: string;
  p_embed_image: string;
  p_use_captcha: string;
  send_last_broadcast: string;
  private: string;
  to_name: string;
  carboncopy: string | null;
  subscription_notify: string | null;
  unsubscription_notify: string | null;
  require_name: string;
  sender_name: string;
  sender_addr1: string;
  sender_addr2: string;
  sender_city: string;
  sender_state: string;
  sender_zip: string;
  sender_country: string;
  sender_phone: string;
  sender_url: string;
  sender_reminder: string;
  fulladdress: string;
  optinmessageid: string;
  optoutconf: string;
  deletestamp: string | null;
  links: Record<string, string>;
}

export interface ListCreateParams {
  name: string;
  stringid: string;
  sender_url: string;
  sender_reminder: string;
  subscription_notify?: string;
  unsubscription_notify?: string;
}

// ============================================
// Automation Types
// ============================================

export interface Automation {
  id: string;
  name: string;
  cdate: string;
  mdate: string;
  userid: string;
  status: string;
  entered: string;
  exited: string;
  hidden: string;
  links: Record<string, string>;
}

// ============================================
// Note Types
// ============================================

export interface Note {
  id: string;
  relid: string;
  reltype: string;
  userid: string;
  cdate: string;
  mdate: string;
  note: string;
  links: Record<string, string>;
}

export interface NoteCreateParams {
  note: string;
  relid: number;
  reltype: string;
}

// ============================================
// Custom Field Types
// ============================================

export interface CustomField {
  id: string;
  title: string;
  descript: string;
  type: string;
  isrequired: string;
  perstag: string;
  defval: string;
  show_in_list: string;
  rows: string;
  cols: string;
  visible: string;
  service: string;
  ordernum: string;
  cdate: string;
  udate: string;
  links: Record<string, string>;
}

export interface CustomFieldCreateParams {
  title: string;
  type: string;
  descript?: string;
  isrequired?: number;
  perstag?: string;
  defval?: string;
  visible?: number;
  ordernum?: number;
}

// ============================================
// Webhook Types
// ============================================

export interface Webhook {
  id: string;
  name: string;
  url: string;
  events: string[];
  sources: string[];
  listid: string;
  cdate: string;
  mdate: string;
  links: Record<string, string>;
}

export interface WebhookCreateParams {
  name: string;
  url: string;
  events: string[];
  sources: string[];
  listid?: number;
}

// ============================================
// User Types
// ============================================

export interface User {
  id: string;
  username: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  links: Record<string, string>;
}

// ============================================
// Task Types
// ============================================

export interface DealTask {
  id: string;
  title: string;
  reltype: string;
  relid: string;
  status: string;
  note: string;
  duedate: string;
  edate: string | null;
  automation: string | null;
  cdate: string;
  udate: string;
  owner: Record<string, string>;
  links: Record<string, string>;
}

export interface DealTaskCreateParams {
  title: string;
  reltype: string;
  relid: number;
  status?: number;
  note?: string;
  duedate: string;
  dealTasktype: number;
}

// ============================================
// API Error Types
// ============================================

export interface ApiErrorDetail {
  code: string;
  message: string;
  field?: string;
  resource?: string;
}

export class ConnectorApiError extends Error {
  public readonly statusCode: number;
  public readonly errors?: ApiErrorDetail[];
  public readonly documentationUrl?: string;
  public readonly requestId?: string;

  constructor(
    message: string,
    statusCode: number,
    options?: {
      errors?: ApiErrorDetail[];
      documentationUrl?: string;
      requestId?: string;
    }
  ) {
    super(message);
    this.name = 'ConnectorApiError';
    this.statusCode = statusCode;
    this.errors = options?.errors;
    this.documentationUrl = options?.documentationUrl;
    this.requestId = options?.requestId;
  }

  isRateLimited(): boolean {
    return this.statusCode === 429;
  }

  isServerError(): boolean {
    return this.statusCode >= 500 && this.statusCode < 600;
  }

  isClientError(): boolean {
    return this.statusCode >= 400 && this.statusCode < 500;
  }

  isAuthError(): boolean {
    return this.statusCode === 401 || this.statusCode === 403;
  }

  isNotFound(): boolean {
    return this.statusCode === 404;
  }

  getUserMessage(): string {
    switch (this.statusCode) {
      case 400:
        return 'Bad request. Please check your input.';
      case 401:
        return 'Authentication failed. Please check your API key.';
      case 403:
        return 'Access denied. You do not have permission to perform this action.';
      case 404:
        return 'Resource not found.';
      case 429:
        return 'Rate limit exceeded. Please wait and try again.';
      case 500:
        return 'Server error. Please try again later.';
      case 502:
      case 503:
      case 504:
        return 'Service temporarily unavailable. Please try again later.';
      default:
        return this.message;
    }
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      statusCode: this.statusCode,
      errors: this.errors,
      documentationUrl: this.documentationUrl,
      requestId: this.requestId,
    };
  }
}

export function parseApiError(
  response: unknown,
  statusCode: number
): ConnectorApiError {
  if (typeof response === 'string') {
    return new ConnectorApiError(response, statusCode);
  }

  if (!response || typeof response !== 'object') {
    return new ConnectorApiError(`HTTP ${statusCode} Error`, statusCode);
  }

  const data = response as Record<string, unknown>;

  const message =
    (data.message as string) ||
    (data.error as string) ||
    ((data.error as Record<string, unknown>)?.message as string) ||
    (data.error_description as string) ||
    (data.detail as string) ||
    `HTTP ${statusCode} Error`;

  let errors: ApiErrorDetail[] | undefined;
  if (Array.isArray(data.errors)) {
    errors = data.errors.map((e: Record<string, unknown>) => ({
      code: String(e.code || e.error || 'unknown'),
      message: String(e.message || e.description || 'Unknown error'),
      field: e.field as string,
      resource: e.resource as string,
    }));
  }

  const documentationUrl =
    (data.documentation_url as string) ||
    (data.docs_url as string) ||
    (data.help_url as string);

  const requestId =
    (data.request_id as string) ||
    (data.requestId as string) ||
    (data.trace_id as string);

  return new ConnectorApiError(message, statusCode, {
    errors,
    documentationUrl,
    requestId,
  });
}
