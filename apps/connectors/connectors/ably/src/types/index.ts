// Ably Connector Types

// ============================================
// Configuration
// ============================================

export interface ConnectorConfig {
  apiKey?: string;      // Full Ably API key (appId.keyId:keySecret)
  token?: string;       // Alias for apiKey
  apiSecret?: string;
  accessToken?: string;
  baseUrl?: string;
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

export interface PaginatedResponse<T> {
  data: T[];
  nextToken?: string;
  hasMore: boolean;
}

// ============================================
// Message Types
// ============================================

export interface Message {
  id?: string;
  name?: string;
  data?: unknown;
  clientId?: string;
  timestamp?: number;
  encoding?: string;
  extras?: Record<string, unknown>;
}

export interface PublishMessageParams {
  name?: string;
  data?: unknown;
  id?: string;
  clientId?: string;
  extras?: Record<string, unknown>;
}

export interface PublishMessageResult {
  channel: string;
  messageId: string;
}

export interface MessageHistoryParams {
  start?: string;
  end?: string;
  limit?: number;
  direction?: 'forwards' | 'backwards';
}

// ============================================
// Channel Types
// ============================================

export interface ChannelDetails {
  channelId: string;
  status?: {
    isActive: boolean;
    occupancy?: {
      metrics?: {
        connections?: number;
        publishers?: number;
        subscribers?: number;
        presenceConnections?: number;
        presenceMembers?: number;
        presenceSubscribers?: number;
      };
    };
  };
}

export interface ListChannelsParams {
  limit?: number;
  prefix?: string;
  by?: 'id' | 'value';
}

// ============================================
// Presence Types
// ============================================

export interface PresenceMember {
  id: string;
  clientId: string;
  connectionId: string;
  timestamp: number;
  action: string;
  data?: unknown;
  encoding?: string;
}

export interface PresenceParams {
  clientId?: string;
  connectionId?: string;
  limit?: number;
}

export interface PresenceHistoryParams {
  start?: string;
  end?: string;
  limit?: number;
  direction?: 'forwards' | 'backwards';
}

// ============================================
// Stats Types
// ============================================

export interface StatsParams {
  start?: string;
  end?: string;
  limit?: number;
  direction?: 'forwards' | 'backwards';
  unit?: 'minute' | 'hour' | 'day' | 'month';
}

export interface Stats {
  intervalId: string;
  all?: Record<string, unknown>;
  inbound?: Record<string, unknown>;
  outbound?: Record<string, unknown>;
  persisted?: Record<string, unknown>;
  connections?: Record<string, unknown>;
  channels?: Record<string, unknown>;
  apiRequests?: Record<string, unknown>;
  tokenRequests?: Record<string, unknown>;
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
        return 'Authentication failed. Please check your Ably API key.';
      case 403:
        return 'Access denied. Your API key may not have the required capabilities.';
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

  // Ably uses { error: { message, code, statusCode } } format
  const errorObj = data.error as Record<string, unknown> | undefined;
  const message =
    (errorObj?.message as string) ||
    (data.message as string) ||
    (data.error as string) ||
    (data.error_description as string) ||
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
