// Wappalyzer API v2 types

export interface ConnectorConfig {
  apiKey?: string;
  token?: string;
  baseUrl?: string;
}

export type OutputFormat = 'json' | 'pretty';

export interface TechnologyCategory {
  id?: number;
  slug?: string;
  name?: string;
}

export interface Technology {
  slug?: string;
  name?: string;
  cpe?: string;
  categories?: TechnologyCategory[];
  versions?: string[];
  trafficRank?: number;
  confirmedAt?: number;
  [key: string]: unknown;
}

export interface LookupResult {
  url: string;
  technologies?: Technology[];
  crawl?: boolean;
  errors?: string[];
  results?: Array<{
    monthYear?: string;
    technologies?: Technology[];
  }>;
  [key: string]: unknown;
}

export interface LookupParams {
  urls: string[];
  live?: boolean;
  recursive?: boolean;
  callback_url?: string;
  sets?: string;
  denoise?: boolean;
  min_age?: number;
  max_age?: number;
  squash?: boolean;
  debug_email?: string;
}

export interface CreditsBalance {
  credits: number;
}

export interface ResponseMeta {
  creditsSpent?: number;
  creditsRemaining?: number;
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
    options?: {
      errors?: ApiErrorDetail[];
      requestId?: string;
    }
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

  isServerError(): boolean {
    return this.statusCode >= 500 && this.statusCode < 600;
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
      case 403:
        return 'Authentication failed or insufficient credits. Check your API key and plan.';
      case 404:
        return 'Resource not found.';
      case 429:
        return 'Rate limit exceeded. Please wait and try again.';
      case 500:
      case 502:
      case 503:
      case 504:
        return 'Service temporarily unavailable. Please try again later.';
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
    errors = data.errors.map((e: unknown) => {
      if (typeof e === 'string') {
        return { code: 'error', message: e };
      }
      const entry = e as Record<string, unknown>;
      return {
        code: String(entry.code || entry.error || 'unknown'),
        message: String(entry.message || entry.description || 'Unknown error'),
        field: entry.field as string | undefined,
      };
    });
  }

  const requestId =
    (data.request_id as string) ||
    (data.requestId as string) ||
    (data.trace_id as string);

  return new ConnectorApiError(message, statusCode, { errors, requestId });
}
