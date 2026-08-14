// StackAdapt API Types

export interface ConnectorConfig {
  apiKey?: string;
  token?: string;
  baseUrl?: string;
  graphqlUrl?: string;
}

export type OutputFormat = 'json' | 'pretty';

export interface Campaign {
  id?: number | string;
  name?: string;
  state?: string;
  budget?: number;
  bid_type?: string;
  bid_amount_total?: number;
  start_date?: string;
  end_date?: string;
  [key: string]: unknown;
}

export interface CampaignCreateParams {
  name: string;
  budget?: number;
  bid_type?: string;
  bid_amount_total?: number;
  optimize_type?: string;
  optimize_value?: number;
  daily_cap?: number;
  pace_evenly?: boolean;
  state?: string;
  start_date?: string;
  end_date?: string;
  country_options?: string[];
  advertiser?: { id?: number; name?: string };
  [key: string]: unknown;
}

export interface ConversionTracker {
  id?: number | string;
  name?: string;
  state?: string;
  [key: string]: unknown;
}

export interface StatsParams {
  resource: 'campaign' | 'conversion_tracker' | 'line_item' | 'native_ad' | 'advertiser' | 'buyer_account';
  type: 'domain' | 'total' | 'daily' | 'hourly';
  id?: number | string;
  start_date?: string;
  end_date?: string;
  timezone?: string;
  group_by_resource?: string;
}

export interface GraphQLRequest {
  query: string;
  variables?: Record<string, unknown>;
  operationName?: string;
}

export interface ApiErrorDetail {
  code: string;
  message: string;
  field?: string;
}

export class ConnectorApiError extends Error {
  public readonly statusCode: number;
  public readonly errors?: ApiErrorDetail[];
  public readonly requestId?: string;

  constructor(
    message: string,
    statusCode: number,
    options?: { errors?: ApiErrorDetail[]; requestId?: string }
  ) {
    super(message);
    this.name = 'ConnectorApiError';
    this.statusCode = statusCode;
    this.errors = options?.errors;
    this.requestId = options?.requestId;
  }

  isRateLimited(): boolean {
    return this.statusCode === 429;
  }

  isAuthError(): boolean {
    return this.statusCode === 401 || this.statusCode === 403;
  }

  isNotFound(): boolean {
    return this.statusCode === 404;
  }

  getUserMessage(): string {
    switch (this.statusCode) {
      case 401:
        return 'Authentication failed. Check STACKADAPT_API_KEY in Account Settings → API Integration.';
      case 403:
        return 'Access denied. Your API key may lack permission for this resource.';
      case 404:
        return 'Resource not found.';
      case 429:
        return 'Rate limit exceeded. Please wait and try again.';
      default:
        return this.message;
    }
  }
}

export function parseApiError(response: unknown, statusCode: number): ConnectorApiError {
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
    (data.detail as string) ||
    `HTTP ${statusCode} Error`;

  let errors: ApiErrorDetail[] | undefined;
  if (Array.isArray(data.errors)) {
    errors = data.errors.map((e: Record<string, unknown>) => ({
      code: String(e.code || e.error || 'unknown'),
      message: String(e.message || e.description || 'Unknown error'),
      field: e.field as string | undefined,
    }));
  }

  const requestId =
    (data.request_id as string) ||
    (data.requestId as string) ||
    (data.trace_id as string);

  return new ConnectorApiError(message, statusCode, { errors, requestId });
}
