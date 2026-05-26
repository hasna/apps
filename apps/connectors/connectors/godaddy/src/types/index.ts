// GoDaddy API Types

// ============================================
// Configuration
// ============================================

export interface GoDaddyConfig {
  apiKey: string;
  apiSecret: string;
  baseUrl?: string;
}

export interface CliConfig {
  apiKey?: string;
  apiSecret?: string;
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'pretty';

// ============================================
// Domain Types
// ============================================

export interface GoDaddyDomain {
  domain: string;
  status: string;
  expires: string;
  renewAuto: boolean;
  nameServers: string[];
}

export interface GoDaddyDomainDetail extends GoDaddyDomain {
  domainId: number;
  createdAt: string;
  expirationProtected: boolean;
  holdRegistrar: boolean;
  locked: boolean;
  privacy: boolean;
  registrarCreatedAt: string;
  renewDeadline: string;
  transferProtected: boolean;
  contactAdmin?: Record<string, unknown>;
  contactBilling?: Record<string, unknown>;
  contactRegistrant?: Record<string, unknown>;
  contactTech?: Record<string, unknown>;
}

// ============================================
// DNS Record Types
// ============================================

export type DnsRecordType = 'A' | 'AAAA' | 'CNAME' | 'MX' | 'NS' | 'SOA' | 'SRV' | 'TXT' | 'CAA';

export interface GoDaddyDnsRecord {
  type: string;
  name: string;
  data: string;
  ttl: number;
  priority?: number;
}

// ============================================
// Availability Types
// ============================================

export interface GoDaddyAvailability {
  available: boolean;
  domain: string;
  definitive: boolean;
  price: number;
  currency: string;
  period: number;
}

// ============================================
// Renewal Types
// ============================================

export interface GoDaddyRenewResponse {
  orderId: number;
  itemCount: number;
  total: number;
}

// ============================================
// API Error Types
// ============================================

export interface GoDaddyErrorField {
  code: string;
  message: string;
  path?: string;
}

export class GoDaddyApiError extends Error {
  public readonly statusCode: number;
  public readonly responseBody?: string;
  public readonly errors?: GoDaddyErrorField[];

  constructor(
    message: string,
    statusCode: number,
    options?: {
      responseBody?: string;
      errors?: GoDaddyErrorField[];
    }
  ) {
    super(message);
    this.name = 'GoDaddyApiError';
    this.statusCode = statusCode;
    this.responseBody = options?.responseBody;
    this.errors = options?.errors;
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
      case 401:
        return 'Authentication failed. Check your GODADDY_API_KEY and GODADDY_API_SECRET.';
      case 403:
        return 'Access denied. Your API credentials may not have permission for this action.';
      case 404:
        return 'Domain or resource not found.';
      case 422:
        return 'Validation error. Check your input parameters.';
      case 429:
        return 'Rate limit exceeded. Please wait and try again.';
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
      responseBody: this.responseBody,
    };
  }
}

/**
 * Parse a GoDaddy API error response
 */
export function parseApiError(
  response: unknown,
  statusCode: number
): GoDaddyApiError {
  if (typeof response === 'string') {
    return new GoDaddyApiError(response, statusCode, { responseBody: response });
  }

  if (!response || typeof response !== 'object') {
    return new GoDaddyApiError(`HTTP ${statusCode} Error`, statusCode);
  }

  const data = response as Record<string, unknown>;

  const message =
    (data.message as string) ||
    (data.error as string) ||
    ((data.error as Record<string, unknown>)?.message as string) ||
    `HTTP ${statusCode} Error`;

  let errors: GoDaddyErrorField[] | undefined;
  if (Array.isArray(data.fields)) {
    errors = data.fields.map((f: Record<string, unknown>) => ({
      code: String(f.code || 'unknown'),
      message: String(f.message || 'Unknown error'),
      path: f.path as string,
    }));
  }

  return new GoDaddyApiError(message, statusCode, {
    responseBody: JSON.stringify(data),
    errors,
  });
}
