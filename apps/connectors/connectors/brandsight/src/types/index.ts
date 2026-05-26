// Brandsight Connector Types

// ============================================
// Configuration
// ============================================

export interface ConnectorConfig {
  apiKey: string;
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'pretty';

// ============================================
// Monitoring Types
// ============================================

export interface BrandAlert {
  domain: string;
  type: 'typosquat' | 'homoglyph' | 'keyword' | 'tld_variation';
  registered_at: string;
}

export interface BrandMonitorResult {
  brand: string;
  alerts: BrandAlert[];
  stub: boolean;
}

export interface SimilarDomain {
  domain: string;
  similar: string[];
  stub: boolean;
}

// ============================================
// Intelligence Types
// ============================================

export interface WhoisRecord {
  registrant: string;
  date: string;
  changes: string[];
}

export interface WhoisHistoryResult {
  domain: string;
  history: WhoisRecord[];
  stub: boolean;
}

export interface ThreatAssessment {
  domain: string;
  risk_level: 'low' | 'medium' | 'high' | 'critical';
  threats: string[];
  recommendation: string;
  stub: boolean;
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
  public readonly responseBody?: string;

  constructor(message: string, statusCode: number, responseBody?: string) {
    super(message);
    this.name = 'ConnectorApiError';
    this.statusCode = statusCode;
    this.responseBody = responseBody;
  }
}
