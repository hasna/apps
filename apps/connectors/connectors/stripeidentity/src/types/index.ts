// Stripe Identity Connector Types
// https://stripe.com/docs/api/identity

// ============================================
// Configuration
// ============================================

export interface ConnectorConfig {
  apiKey: string;
  baseUrl?: string;     // Override default base URL
  accountId?: string;   // Required for org API keys (Stripe-Context header)
  apiVersion?: string;  // Stripe API version
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'pretty' | 'table';

/** Key-value metadata */
export type Metadata = Record<string, string>;

/** Stripe list response wrapper */
export interface StripeList<T> {
  object: 'list';
  data: T[];
  has_more: boolean;
  url: string;
}

/** Range filter for created-style timestamp queries */
export type TimestampRange = number | { gt?: number; gte?: number; lt?: number; lte?: number };

/** Common list options for pagination */
export interface ListOptions {
  limit?: number;
  starting_after?: string;
  ending_before?: string;
}

// ============================================
// Shared verification structures
// ============================================

/** Error surfaced when a verification check fails */
export interface VerificationError {
  code?: string;
  reason?: string;
}

/** Document type allowed / detected during verification */
export type DocumentType = 'driving_license' | 'id_card' | 'passport';

/** Verified name/address/DOB outputs on a session or report */
export interface VerifiedAddress {
  city?: string;
  country?: string;
  line1?: string;
  line2?: string;
  postal_code?: string;
  state?: string;
}

export interface VerifiedDateOfBirth {
  day?: number;
  month?: number;
  year?: number;
}

export interface VerifiedOutputs {
  address?: VerifiedAddress;
  dob?: VerifiedDateOfBirth;
  first_name?: string;
  last_name?: string;
  id_number?: string;
  id_number_type?: 'br_cpf' | 'sg_nric' | 'us_ssn';
  email?: string;
  phone?: string;
  unparsed_name?: string;
}

/** Details provided by the platform about the person being verified */
export interface ProvidedDetails {
  email?: string;
  phone?: string;
}

// ============================================
// Verification Session Options
// ============================================

export interface DocumentOptions {
  allowed_types?: DocumentType[];
  require_id_number?: boolean;
  require_live_capture?: boolean;
  require_matching_selfie?: boolean;
}

export interface VerificationSessionOptions {
  document?: DocumentOptions;
  // id_number verification takes no additional options today
  id_number?: Record<string, never>;
}

// ============================================
// Verification Session
// ============================================

export type VerificationSessionStatus =
  | 'requires_input'
  | 'processing'
  | 'verified'
  | 'canceled';

export type VerificationType = 'document' | 'id_number';

export interface VerificationSession {
  id: string;
  object: 'identity.verification_session';
  client_secret?: string | null;
  created: number;
  last_error?: VerificationError | null;
  last_verification_report?: string | null;
  livemode: boolean;
  metadata: Metadata;
  options?: VerificationSessionOptions | null;
  provided_details?: ProvidedDetails | null;
  redaction?: { status: 'processing' | 'redacted' } | null;
  related_customer?: string | null;
  status: VerificationSessionStatus;
  type?: VerificationType | null;
  url?: string | null;
  verification_flow?: string;
  verified_outputs?: VerifiedOutputs | null;
}

export interface VerificationSessionCreateParams {
  type?: VerificationType;
  verification_flow?: string;
  client_reference_id?: string;
  metadata?: Metadata;
  options?: VerificationSessionOptions;
  provided_details?: ProvidedDetails;
  related_customer?: string;
  return_url?: string;
}

export interface VerificationSessionUpdateParams {
  type?: VerificationType;
  metadata?: Metadata;
  options?: VerificationSessionOptions;
  provided_details?: ProvidedDetails;
}

export interface VerificationSessionListOptions extends ListOptions {
  client_reference_id?: string;
  created?: TimestampRange;
  related_customer?: string;
  status?: VerificationSessionStatus;
}

// ============================================
// Verification Report
// ============================================

export interface ReportDocument {
  address?: VerifiedAddress;
  dob?: VerifiedDateOfBirth;
  error?: VerificationError | null;
  expiration_date?: VerifiedDateOfBirth;
  files?: string[];
  first_name?: string;
  issued_date?: VerifiedDateOfBirth;
  issuing_country?: string;
  last_name?: string;
  number?: string;
  status: 'unverified' | 'verified';
  type?: DocumentType;
}

export interface ReportIdNumber {
  dob?: VerifiedDateOfBirth;
  error?: VerificationError | null;
  first_name?: string;
  id_number?: string;
  id_number_type?: 'br_cpf' | 'sg_nric' | 'us_ssn';
  last_name?: string;
  status: 'unverified' | 'verified';
}

export interface ReportSelfie {
  document?: string;
  error?: VerificationError | null;
  selfie?: string;
  status: 'unverified' | 'verified';
}

export interface VerificationReport {
  id: string;
  object: 'identity.verification_report';
  created: number;
  document?: ReportDocument | null;
  id_number?: ReportIdNumber | null;
  livemode: boolean;
  options?: VerificationSessionOptions | null;
  selfie?: ReportSelfie | null;
  type?: VerificationType | null;
  verification_flow?: string;
  verification_session?: string | null;
}

export interface VerificationReportListOptions extends ListOptions {
  client_reference_id?: string;
  created?: TimestampRange;
  type?: VerificationType;
  verification_session?: string;
}

// ============================================
// Errors
// ============================================

export class ConnectorApiError extends Error {
  constructor(message: string, public readonly statusCode: number) {
    super(message);
    this.name = 'ConnectorApiError';
  }
}
