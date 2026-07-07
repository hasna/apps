// Stripe Webhooks Advanced Connector Types

export interface ConnectorConfig {
  apiKey: string;
  apiSecret?: string;
  baseUrl?: string;
  accountId?: string;
  apiVersion?: string;
}

export type OutputFormat = 'json' | 'pretty';

export type Metadata = Record<string, string>;

export interface StripeList<T> {
  object: 'list';
  data: T[];
  has_more: boolean;
  url: string;
}

export interface ListOptions {
  limit?: number;
  starting_after?: string;
  ending_before?: string;
}

export interface DeletedObject {
  id: string;
  object: string;
  deleted: true;
}

export interface Event {
  id: string;
  object: 'event';
  account?: string;
  api_version?: string;
  created: number;
  data: {
    object: Record<string, unknown>;
    previous_attributes?: Record<string, unknown>;
  };
  livemode: boolean;
  pending_webhooks: number;
  request?: { id?: string; idempotency_key?: string };
  type: string;
}

export interface EventListOptions extends ListOptions {
  created?: number | { gt?: number; gte?: number; lt?: number; lte?: number };
  delivery_success?: boolean;
  type?: string;
  types?: string[];
}

export interface EventSearchOptions extends EventListOptions {
  /** Alias for type filter */
  query?: string;
}

export interface WebhookEndpoint {
  id: string;
  object: 'webhook_endpoint';
  api_version?: string;
  application?: string;
  created: number;
  description?: string;
  enabled_events: string[];
  livemode: boolean;
  metadata: Metadata;
  secret?: string;
  status: 'disabled' | 'enabled';
  url: string;
}

export interface WebhookEndpointCreateParams {
  url: string;
  enabled_events: string[];
  api_version?: string;
  description?: string;
  metadata?: Metadata;
}

export interface WebhookEndpointUpdateParams {
  description?: string;
  disabled?: boolean;
  enabled_events?: string[];
  metadata?: Metadata;
  url?: string;
}

export interface WebhookEndpointListOptions extends ListOptions {}

export interface VerifyOptions {
  payload: string;
  signature: string;
  secret: string;
  tolerance?: number;
}

export interface VerifyResult {
  valid: boolean;
  event?: Event;
  error?: string;
  timestamp?: number;
}

export interface RawRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  path: string;
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | string;
}

export interface ApiErrorDetail {
  message?: string;
  type?: string;
  code?: string;
}

export class ConnectorApiError extends Error {
  public readonly statusCode: number;
  public readonly errors?: ApiErrorDetail[];

  constructor(message: string, statusCode: number, errors?: ApiErrorDetail[]) {
    super(message);
    this.name = 'ConnectorApiError';
    this.statusCode = statusCode;
    this.errors = errors;
  }
}

export class SignatureVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SignatureVerificationError';
  }
}
