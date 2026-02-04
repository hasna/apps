// Brandsight/GoDaddy Domain API Types

// ============================================
// Configuration
// ============================================

export interface BrandsightConfig {
  apiKey: string;
  apiSecret: string;
  customerId?: string;
  baseUrl?: string;
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'xml';
export type OptimizeFor = 'SPEED' | 'ACCURACY';
export type CheckType = 'REGISTRATION' | 'RENEWAL' | 'TRANSFER';

export interface PaginatedResponse<T> {
  data: T[];
  page: number;
  hasMore: boolean;
}

// ============================================
// Domain Availability Types
// ============================================

export interface DomainAvailabilityParams {
  domain: string;
  period?: number; // 1-10 years
  checkType?: CheckType;
  optimizeFor?: OptimizeFor;
}

export interface DomainAvailabilityResponse {
  available: boolean;
  domain: string;
  definitive: boolean;
  price?: number;
  currency?: string;
  period?: number;
}

export interface BulkAvailabilityResponse {
  domains: DomainAvailabilityResponse[];
  errors?: DomainAvailabilityError[];
}

export interface DomainAvailabilityError {
  code: string;
  domain: string;
  message: string;
  path: string;
  status: number;
}

// ============================================
// Domain Purchase Types
// ============================================

export interface Contact {
  addressMailing: Address;
  email: string;
  fax?: string;
  jobTitle?: string;
  nameFirst: string;
  nameLast: string;
  nameMiddle?: string;
  organization?: string;
  phone: string;
}

export interface Address {
  address1: string;
  address2?: string;
  city: string;
  country: string;
  postalCode: string;
  state: string;
}

export interface Consent {
  agreedAt: string;
  agreedBy: string;
  agreementKeys: string[];
}

export interface DomainPurchaseRequest {
  domain: string;
  consent: Consent;
  contactAdmin?: Contact;
  contactBilling?: Contact;
  contactRegistrant: Contact;
  contactTech?: Contact;
  nameServers?: string[];
  period?: number;
  privacy?: boolean;
  renewAuto?: boolean;
}

export interface DomainPurchaseResponse {
  domain: string;
  orderId: number;
  itemCount: number;
  total: number;
  currency: string;
}

// ============================================
// Domain Info Types
// ============================================

export interface DomainInfo {
  domain: string;
  domainId: number;
  status: string;
  expires: string;
  expirationProtected: boolean;
  holdRegistrar: boolean;
  locked: boolean;
  privacy: boolean;
  renewAuto: boolean;
  renewable: boolean;
  transferProtected: boolean;
  createdAt: string;
  nameServers: string[];
  contactAdmin?: Contact;
  contactBilling?: Contact;
  contactRegistrant?: Contact;
  contactTech?: Contact;
}

// ============================================
// Agreement Types
// ============================================

export interface Agreement {
  agreementKey: string;
  content: string;
  title: string;
  url?: string;
}

export interface AgreementParams {
  tlds: string[];
  privacy?: boolean;
  forTransfer?: boolean;
}

// ============================================
// Action Types
// ============================================

export interface DomainAction {
  type: string;
  status: string;
  createdAt: string;
  modifiedAt: string;
}

// ============================================
// TLD Suggestions
// ============================================

export interface TldSuggestion {
  domain: string;
  available: boolean;
  price?: number;
  currency?: string;
}

// ============================================
// API Error Types
// ============================================

export interface BrandsightError {
  code: string;
  message: string;
  field?: string;
  path?: string;
}

export class BrandsightApiError extends Error {
  public readonly statusCode: number;
  public readonly errors?: BrandsightError[];

  constructor(message: string, statusCode: number, errors?: BrandsightError[]) {
    super(message);
    this.name = 'BrandsightApiError';
    this.statusCode = statusCode;
    this.errors = errors;
  }
}
