// Namecheap Connector Types

// ============================================
// Configuration
// ============================================

export interface ConnectorConfig {
  apiKey: string;
  username: string;
  clientIp: string;
  sandbox?: boolean;
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'pretty';

// ============================================
// Domain Types
// ============================================

export interface Domain {
  domain: string;
  expiry: string;
  autoRenew: boolean;
  isLocked: boolean;
}

export interface DomainInfo {
  domain: string;
  registrar: string;
  created: string;
  expires: string;
  nameservers: string[];
}

export interface RenewResult {
  domain: string;
  success: boolean;
  transactionId?: string;
  chargedAmount?: string;
  orderId?: string;
}

export interface AvailabilityResult {
  domain: string;
  available: boolean;
}

// ============================================
// DNS Types
// ============================================

export interface DnsRecord {
  hostId?: string;
  type: string;
  name: string;
  address: string;
  mxPref?: number;
  ttl: number;
}

// ============================================
// API Error Types
// ============================================

export interface ApiErrorDetail {
  code: string;
  message: string;
}

export class ConnectorApiError extends Error {
  public readonly statusCode: number;
  public readonly errorNumber?: string;

  constructor(message: string, statusCode: number, errorNumber?: string) {
    super(message);
    this.name = 'ConnectorApiError';
    this.statusCode = statusCode;
    this.errorNumber = errorNumber;
  }
}
