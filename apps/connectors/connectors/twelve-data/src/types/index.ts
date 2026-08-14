// Twelve Data API Types

export interface ConnectorConfig {
  apiKey?: string;
  token?: string;
  apiSecret?: string;
  accessToken?: string;
  baseUrl?: string;
}

export type OutputFormat = 'json' | 'pretty';

// ============================================
// Price
// ============================================

export interface PriceParams {
  symbol: string;
  exchange?: string;
  country?: string;
  type?: string;
  dp?: number;
  prepost?: boolean;
  mic_code?: string;
}

export interface PriceResult {
  price: string;
  symbol?: string;
}

// ============================================
// Quote
// ============================================

export interface QuoteParams {
  symbol: string;
  interval?: string;
  exchange?: string;
  country?: string;
  type?: string;
  dp?: number;
  prepost?: boolean;
  mic_code?: string;
  eod?: boolean;
  rolling_period?: number;
  timezone?: string;
}

export interface QuoteResult {
  symbol?: string;
  name?: string;
  exchange?: string;
  currency?: string;
  datetime?: string;
  timestamp?: number;
  open?: string;
  high?: string;
  low?: string;
  close?: string;
  volume?: string;
  previous_close?: string;
  change?: string;
  percent_change?: string;
  average_volume?: string;
  is_market_open?: boolean;
  fifty_two_week?: {
    low?: string;
    high?: string;
    low_change?: string;
    high_change?: string;
    low_change_percent?: string;
    high_change_percent?: string;
    range?: string;
  };
}

// ============================================
// Time Series
// ============================================

export interface TimeSeriesParams {
  symbol: string;
  interval: string;
  exchange?: string;
  country?: string;
  type?: string;
  outputsize?: number;
  dp?: number;
  start_date?: string;
  end_date?: string;
  prepost?: boolean;
  mic_code?: string;
  timezone?: string;
}

export interface TimeSeriesValue {
  datetime: string;
  open?: string;
  high?: string;
  low?: string;
  close?: string;
  volume?: string;
}

export interface TimeSeriesResult {
  meta?: {
    symbol?: string;
    interval?: string;
    currency?: string;
    exchange_timezone?: string;
    exchange?: string;
    mic_code?: string;
    type?: string;
  };
  values?: TimeSeriesValue[];
  status?: string;
}

// ============================================
// Exchange Rate
// ============================================

export interface ExchangeRateParams {
  symbol: string;
  dp?: number;
}

export interface ExchangeRateResult {
  symbol?: string;
  rate?: number;
  timestamp?: number;
}

// ============================================
// Symbols (stocks list)
// ============================================

export interface SymbolsParams {
  symbol?: string;
  figi?: string;
  isin?: string;
  cusip?: string;
  exchange?: string;
  mic_code?: string;
  country?: string;
  type?: string;
  format?: string;
  show_plan?: boolean;
  include_delisted?: boolean;
}

export interface SymbolInfo {
  symbol?: string;
  name?: string;
  currency?: string;
  exchange?: string;
  mic_code?: string;
  country?: string;
  type?: string;
}

export interface SymbolsResult {
  data?: SymbolInfo[];
  status?: string;
}

// ============================================
// API Error Types
// ============================================

export interface ApiErrorDetail {
  code: string;
  message: string;
  field?: string;
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
        return 'Authentication failed. Please check your Twelve Data API key.';
      case 403:
        return 'Access denied. Your API key may not have access to this endpoint.';
      case 404:
        return 'Resource not found.';
      case 422:
        return 'Invalid parameters. Please check your input.';
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
    (data.detail as string) ||
    `HTTP ${statusCode} Error`;

  return new ConnectorApiError(message, statusCode);
}
