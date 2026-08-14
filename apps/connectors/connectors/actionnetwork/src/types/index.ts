// Action Network API Types
// Progressive organizing platform - petitions, events, fundraising, advocacy, email

// ============================================
// Configuration
// ============================================

export interface ConnectorConfig {
  apiKey?: string;      // OSDI-API-Token
  token?: string;       // Alias for apiKey
  accessToken?: string; // For OAuth2 authentication
  baseUrl?: string;     // Override default base URL
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

export interface HalLinks {
  self?: { href: string };
  next?: { href: string };
  previous?: { href: string };
  'osdi:people'?: { href: string };
  'osdi:person'?: { href: string };
  [key: string]: unknown;
}

export interface HalCollection<T> {
  total_pages: number;
  per_page: number;
  page: number;
  total_records: number;
  _links: HalLinks;
  _embedded: Record<string, T[]>;
}

export interface ListParams {
  page?: number;
  per_page?: number;
  filter?: string;
}

// ============================================
// Person Types
// ============================================

export interface EmailAddress {
  address: string;
  primary?: boolean;
  status?: 'subscribed' | 'unsubscribed' | 'bouncing' | 'spam complaint';
}

export interface PhoneNumber {
  number: string;
  primary?: boolean;
  number_type?: string;
  status?: 'subscribed' | 'unsubscribed' | 'bouncing';
}

export interface PostalAddress {
  address_lines?: string[];
  locality?: string;
  region?: string;
  postal_code?: string;
  country?: string;
  location?: {
    latitude?: number;
    longitude?: number;
    accuracy?: string;
  };
}

export interface Person {
  identifiers?: string[];
  given_name?: string;
  family_name?: string;
  email_addresses?: EmailAddress[];
  phone_numbers?: PhoneNumber[];
  postal_addresses?: PostalAddress[];
  languages_spoken?: string[];
  custom_fields?: Record<string, string>;
  created_date?: string;
  modified_date?: string;
  _links?: HalLinks;
  [key: string]: unknown;
}

export interface PersonSignupParams {
  person: {
    given_name?: string;
    family_name?: string;
    email_addresses?: EmailAddress[];
    phone_numbers?: PhoneNumber[];
    postal_addresses?: PostalAddress[];
    languages_spoken?: string[];
    custom_fields?: Record<string, string>;
  };
  add_tags?: string[];
  remove_tags?: string[];
  'action_network:referrer_data'?: ReferrerData;
}

export interface PersonUpdateParams {
  given_name?: string;
  family_name?: string;
  email_addresses?: EmailAddress[];
  phone_numbers?: PhoneNumber[];
  postal_addresses?: PostalAddress[];
  languages_spoken?: string[];
  custom_fields?: Record<string, string>;
}

// ============================================
// Action Types (Petition, Event, Form, etc.)
// ============================================

export interface ReferrerData {
  source?: string;
  referrer?: string;
  website?: string;
}

export interface ActionBase {
  identifiers?: string[];
  title?: string;
  name?: string;
  description?: string;
  origin_system?: string;
  browser_url?: string;
  featured_image_url?: string;
  created_date?: string;
  modified_date?: string;
  'action_network:hidden'?: boolean;
  _links?: HalLinks;
  [key: string]: unknown;
}

export interface Petition extends ActionBase {
  petition_text?: string;
  target?: Array<{ name: string }>;
  total_signatures?: number;
}

export interface PetitionCreateParams {
  title: string;
  origin_system: string;
  description?: string;
  petition_text?: string;
  target?: Array<{ name: string }>;
  'action_network:hidden'?: boolean;
}

export interface Event extends ActionBase {
  start_date?: string;
  end_date?: string;
  status?: 'confirmed' | 'tentative' | 'cancelled';
  capacity?: number;
  total_accepted?: number;
  location?: {
    venue?: string;
    address_lines?: string[];
    locality?: string;
    region?: string;
    postal_code?: string;
    country?: string;
    location?: {
      latitude?: number;
      longitude?: number;
    };
  };
}

export interface EventCreateParams {
  title: string;
  origin_system: string;
  description?: string;
  start_date?: string;
  end_date?: string;
  status?: 'confirmed' | 'tentative' | 'cancelled';
  capacity?: number;
  location?: Event['location'];
  'action_network:hidden'?: boolean;
}

export interface Form extends ActionBase {
  total_submissions?: number;
}

export interface FormCreateParams {
  title: string;
  origin_system: string;
  description?: string;
  'action_network:hidden'?: boolean;
}

export interface FundraisingPage extends ActionBase {
  total_donations?: number;
  total_amount?: string;
  currency?: string;
}

export interface FundraisingPageCreateParams {
  title: string;
  origin_system: string;
  description?: string;
  'action_network:hidden'?: boolean;
}

export interface AdvocacyCampaign extends ActionBase {
  type?: 'email' | 'phone';
  targets?: string;
  total_outreaches?: number;
}

export interface AdvocacyCampaignCreateParams {
  title: string;
  origin_system: string;
  description?: string;
  type?: 'email' | 'phone';
  targets?: string;
  'action_network:hidden'?: boolean;
}

// ============================================
// Action Response Types
// ============================================

export interface Signature {
  identifiers?: string[];
  created_date?: string;
  modified_date?: string;
  comments?: string;
  'action_network:referrer_data'?: ReferrerData;
  _links?: HalLinks;
  [key: string]: unknown;
}

export interface SignatureCreateParams {
  person: PersonSignupParams['person'];
  comments?: string;
  add_tags?: string[];
  'action_network:referrer_data'?: ReferrerData;
}

export interface Attendance {
  identifiers?: string[];
  created_date?: string;
  modified_date?: string;
  status?: 'accepted' | 'declined' | 'tentative';
  'action_network:referrer_data'?: ReferrerData;
  _links?: HalLinks;
  [key: string]: unknown;
}

export interface AttendanceCreateParams {
  person: PersonSignupParams['person'];
  status?: 'accepted' | 'declined' | 'tentative';
  add_tags?: string[];
  'action_network:referrer_data'?: ReferrerData;
}

export interface Submission {
  identifiers?: string[];
  created_date?: string;
  modified_date?: string;
  'action_network:referrer_data'?: ReferrerData;
  _links?: HalLinks;
  [key: string]: unknown;
}

export interface SubmissionCreateParams {
  person: PersonSignupParams['person'];
  add_tags?: string[];
  'action_network:referrer_data'?: ReferrerData;
}

export interface Donation {
  identifiers?: string[];
  created_date?: string;
  modified_date?: string;
  amount?: string;
  currency?: string;
  recipients?: Array<{ display_name: string; amount: string }>;
  payment?: {
    method?: string;
    reference_number?: string;
    authorization_stored?: boolean;
  };
  'action_network:recurrence'?: {
    recurring?: boolean;
    period?: string;
  };
  'action_network:referrer_data'?: ReferrerData;
  _links?: HalLinks;
  [key: string]: unknown;
}

export interface DonationCreateParams {
  recipients: Array<{ display_name: string; amount: string }>;
  person: PersonSignupParams['person'];
  payment?: Donation['payment'];
  'action_network:referrer_data'?: ReferrerData;
  add_tags?: string[];
}

// ============================================
// Tag Types
// ============================================

export interface Tag {
  identifiers?: string[];
  name: string;
  created_date?: string;
  modified_date?: string;
  _links?: HalLinks;
  [key: string]: unknown;
}

export interface TagCreateParams {
  name: string;
}

export interface Tagging {
  identifiers?: string[];
  item_type?: string;
  created_date?: string;
  _links?: HalLinks;
  [key: string]: unknown;
}

export interface TaggingCreateParams {
  _links: {
    'osdi:person': { href: string };
  };
}

// ============================================
// Message Types
// ============================================

export interface Message {
  identifiers?: string[];
  subject?: string;
  body?: string;
  from?: string;
  reply_to?: string;
  status?: 'draft' | 'calculating' | 'sending' | 'sent';
  created_date?: string;
  modified_date?: string;
  total_targeted?: number;
  statistics?: {
    sent?: number;
    opened?: number;
    clicked?: number;
    unsubscribed?: number;
    bounced?: number;
    [key: string]: unknown;
  };
  targets?: unknown[];
  _links?: HalLinks;
  [key: string]: unknown;
}

export interface MessageCreateParams {
  subject: string;
  body: string;
  from: string;
  reply_to: string;
  targets?: unknown[];
  'action_network:hidden'?: boolean;
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
        return 'Authentication failed. Please check your OSDI API token.';
      case 403:
        return 'Access denied. You may need partner-level API access.';
      case 404:
        return 'Resource not found.';
      case 429:
        return 'Rate limit exceeded. Maximum 4 requests per second.';
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
