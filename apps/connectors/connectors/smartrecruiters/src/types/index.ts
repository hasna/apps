// SmartRecruiters API Types

// ============================================
// Configuration
// ============================================

export interface SmartRecruitersConfig {
  /** Company API key, sent as the X-SmartToken header */
  apiKey: string;
  /** Optional default company identifier for the public Posting API */
  companyId?: string;
  /** Override the API base URL (defaults to https://api.smartrecruiters.com) */
  baseUrl?: string;
}

export interface CliConfig {
  apiKey?: string;
  companyId?: string;
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'pretty';

/**
 * Standard SmartRecruiters paginated list envelope.
 * Used by /jobs, /candidates, /users and the Posting API.
 */
export interface SmartRecruitersListResponse<T> {
  totalFound?: number;
  offset?: number;
  limit?: number;
  content: T[];
}

export interface Actor {
  id?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
}

export interface Label {
  id?: string;
  label?: string;
}

// ============================================
// Job Types
// ============================================

export interface Job {
  id: string;
  title?: string;
  refNumber?: string;
  createdOn?: string;
  updatedOn?: string;
  status?: string;
  postingStatus?: string;
  jobUuid?: string;
  company?: {
    identifier?: string;
    name?: string;
  };
  location?: JobLocation;
  industry?: Label;
  department?: Label;
  function?: Label;
  typeOfEmployment?: Label;
  experienceLevel?: Label;
  eeoCategory?: Label;
  creator?: Actor;
}

export interface JobLocation {
  country?: string;
  countryCode?: string;
  regionCode?: string;
  region?: string;
  city?: string;
  address?: string;
  postalCode?: string;
  remote?: boolean;
  manual?: boolean;
}

export interface JobStatus {
  id?: string;
  status?: string;
  postingStatus?: string;
}

export interface HiringTeamMember {
  id?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  role?: string;
}

// ============================================
// Candidate Types
// ============================================

export interface Candidate {
  id: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phoneNumber?: string;
  location?: JobLocation;
  web?: Record<string, string>;
  tags?: string[];
  createdOn?: string;
  updatedOn?: string;
  primaryAssignment?: {
    job?: { id?: string; title?: string };
    status?: string;
    subStatus?: string;
  };
  experience?: Array<Record<string, unknown>>;
  education?: Array<Record<string, unknown>>;
}

export interface CandidateStatus {
  id?: string;
  status?: string;
  subStatus?: string;
}

// ============================================
// Posting (public job board) Types
// ============================================

export interface Posting {
  id: string;
  uuid?: string;
  name?: string;
  refNumber?: string;
  company?: {
    identifier?: string;
    name?: string;
  };
  releasedDate?: string;
  location?: JobLocation;
  industry?: Label;
  department?: Label;
  function?: Label;
  typeOfEmployment?: Label;
  experienceLevel?: Label;
  customField?: Array<{ fieldId?: string; fieldLabel?: string; valueId?: string; valueLabel?: string }>;
  ref?: string;
  language?: { code?: string; label?: string };
  jobAd?: Record<string, unknown>;
}

// ============================================
// User Types
// ============================================

export interface User {
  id: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  language?: string;
  status?: string;
  role?: string;
  createdOn?: string;
  updatedOn?: string;
}

// ============================================
// Configuration Types
// ============================================

export interface ConfigurationItem {
  id: string;
  label?: string;
  labels?: Record<string, string>;
}

// ============================================
// API Error Types
// ============================================

export interface SmartRecruitersErrorDetail {
  code?: string;
  message?: string;
  field?: string;
}

export class SmartRecruitersApiError extends Error {
  public readonly statusCode: number;
  public readonly responseBody?: string;
  public readonly errors?: SmartRecruitersErrorDetail[];

  constructor(
    message: string,
    statusCode: number,
    options?: {
      responseBody?: string;
      errors?: SmartRecruitersErrorDetail[];
    }
  ) {
    super(message);
    this.name = 'SmartRecruitersApiError';
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
        return 'Authentication failed. Check your SMARTRECRUITERS_API_KEY (X-SmartToken).';
      case 403:
        return 'Access denied. Your API key may not have permission for this action.';
      case 404:
        return 'Resource not found.';
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
 * Parse a SmartRecruiters API error response into a SmartRecruitersApiError.
 * SmartRecruiters returns errors as { message } or { errors: [{ code, message, field }] }.
 */
export function parseApiError(
  response: unknown,
  statusCode: number
): SmartRecruitersApiError {
  if (typeof response === 'string') {
    return new SmartRecruitersApiError(response || `HTTP ${statusCode} Error`, statusCode, {
      responseBody: response,
    });
  }

  if (!response || typeof response !== 'object') {
    return new SmartRecruitersApiError(`HTTP ${statusCode} Error`, statusCode);
  }

  const data = response as Record<string, unknown>;

  let errors: SmartRecruitersErrorDetail[] | undefined;
  if (Array.isArray(data.errors)) {
    errors = data.errors.map((e: Record<string, unknown>) => ({
      code: e.code as string | undefined,
      message: (e.message as string) || 'Unknown error',
      field: e.field as string | undefined,
    }));
  }

  const message =
    (data.message as string) ||
    (data.error as string) ||
    errors?.[0]?.message ||
    `HTTP ${statusCode} Error`;

  return new SmartRecruitersApiError(message, statusCode, {
    responseBody: JSON.stringify(data),
    errors,
  });
}
