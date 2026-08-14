// Stripe Billing Advanced Connector Types
// Advanced usage-based billing via Stripe v2 /billing API

export interface StripeBillingAdvancedConfig {
  apiKey: string;
  baseUrl?: string;
  apiVersion?: string;
}

export type OutputFormat = 'json' | 'pretty';

export interface ListParams {
  limit?: number;
  starting_after?: string;
  ending_before?: string;
}

export interface StripeBillingObject {
  id: string;
  object: string;
  livemode: boolean;
  created: string;
  [key: string]: unknown;
}

export interface StripeBillingListResponse<T = StripeBillingObject> {
  data: T[];
  has_more: boolean;
  next_page_url?: string | null;
}

export interface StripeBillingErrorBody {
  error?: {
    type?: string;
    message?: string;
    code?: string;
    param?: string;
  };
}

export class StripeBillingAdvancedApiError extends Error {
  public readonly statusCode: number;
  public readonly body?: unknown;

  constructor(message: string, statusCode: number, body?: unknown) {
    super(message);
    this.name = 'StripeBillingAdvancedApiError';
    this.statusCode = statusCode;
    this.body = body;
  }
}
