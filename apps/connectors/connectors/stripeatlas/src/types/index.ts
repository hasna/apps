// Stripe Atlas Connector Types
// Uses browser automation since Stripe Atlas doesn't have a public API

// ============================================
// Configuration
// ============================================

export interface StripeAtlasConfig {
  email: string;
  password?: string;
  baseUrl?: string;   // Override default Stripe Atlas URL
}

// Alias for backwards compatibility with scaffold patterns
export type ConnectorConfig = StripeAtlasConfig & { apiKey?: string };

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
// Stripe Atlas Resource Types
// ============================================

export interface AtlasCompany {
  id: string;
  name: string;
  status: 'pending' | 'active' | 'completed' | 'rejected';
  incorporationState?: string;
  incorporationDate?: string;
  ein?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AtlasApplication {
  id: string;
  companyName: string;
  status: 'draft' | 'submitted' | 'processing' | 'approved' | 'rejected';
  step?: string;
  submittedAt?: string;
  createdAt: string;
}

export interface AtlasBankAccount {
  id: string;
  bankName: string;
  accountType: string;
  status: 'pending' | 'active' | 'closed';
  last4?: string;
}

export interface AtlasDocument {
  id: string;
  type: string;
  name: string;
  status: 'pending' | 'ready' | 'processing';
  downloadUrl?: string;
  createdAt: string;
}

// ============================================
// API Error Types
// ============================================

export interface ApiErrorDetail {
  code: string;
  message: string;
  field?: string;
}

export class StripeAtlasApiError extends Error {
  public readonly statusCode: number;
  public readonly errors?: ApiErrorDetail[];

  constructor(message: string, statusCode: number, errors?: ApiErrorDetail[]) {
    super(message);
    this.name = 'StripeAtlasApiError';
    this.statusCode = statusCode;
    this.errors = errors;
  }
}

// Alias for backwards compatibility
export { StripeAtlasApiError as ConnectorApiError };
