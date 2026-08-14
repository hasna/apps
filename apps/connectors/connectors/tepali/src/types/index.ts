// Tepali API Types

// ============================================
// Configuration
// ============================================

export interface ConnectorConfig {
  apiKey?: string;
  token?: string;
  baseUrl?: string;
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'table' | 'pretty';

export interface ListParams {
  page?: number;
  per_page?: number;
  q?: string;
}

export interface ListMeta {
  page?: number;
  per_page?: number;
  total?: number;
  total_pages?: number;
}

export interface ListResponse<T> {
  data: T[];
  meta?: ListMeta;
}

// ============================================
// Patient Types
// ============================================

export interface Patient {
  id: string;
  first_name: string;
  last_name: string;
  email?: string;
  phone?: string;
  date_of_birth?: string;
  status?: string;
  tags?: string[];
  notes?: string;
  created_at?: string;
  updated_at?: string;
}

export interface PatientListParams extends ListParams {
  status?: string;
  email?: string;
}

// ============================================
// Appointment Types
// ============================================

export interface Appointment {
  id: string;
  patient_id: string;
  provider_id?: string;
  treatment_id?: string;
  status?: string;
  starts_at: string;
  ends_at?: string;
  location?: string;
  notes?: string;
  created_at?: string;
  updated_at?: string;
}

export interface AppointmentListParams extends ListParams {
  patient_id?: string;
  provider_id?: string;
  status?: string;
  starts_after?: string;
  starts_before?: string;
}

export interface AppointmentCreateParams {
  patient_id: string;
  starts_at: string;
  ends_at?: string;
  provider_id?: string;
  treatment_id?: string;
  location?: string;
  notes?: string;
}

// ============================================
// Treatment Types
// ============================================

export interface Treatment {
  id: string;
  name: string;
  description?: string;
  category?: string;
  duration_minutes?: number;
  price?: number;
  currency?: string;
  active?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface TreatmentListParams extends ListParams {
  category?: string;
  active?: boolean;
}

// ============================================
// Chart Types (clinical documentation)
// ============================================

export interface Chart {
  id: string;
  patient_id: string;
  appointment_id?: string;
  provider_id?: string;
  type?: string;
  content?: string;
  created_at?: string;
  updated_at?: string;
}

export interface ChartCreateParams {
  patient_id: string;
  content: string;
  appointment_id?: string;
  provider_id?: string;
  type?: string;
}

// ============================================
// Inventory Types
// ============================================

export interface InventoryItem {
  id: string;
  sku?: string;
  name: string;
  category?: string;
  quantity?: number;
  unit?: string;
  reorder_point?: number;
  expires_at?: string;
  created_at?: string;
  updated_at?: string;
}

export interface InventoryListParams extends ListParams {
  category?: string;
  low_stock?: boolean;
}

// ============================================
// Lead Types
// ============================================

export interface Lead {
  id: string;
  name?: string;
  email?: string;
  phone?: string;
  source?: string;
  status?: string;
  campaign?: string;
  created_at?: string;
  updated_at?: string;
}

export interface LeadListParams extends ListParams {
  status?: string;
  source?: string;
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
        return 'Authentication failed. Please check your API key.';
      case 403:
        return 'Access denied. You do not have permission to perform this action.';
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
      requestId: this.requestId,
    };
  }
}

export function parseApiError(
  response: unknown,
  statusCode: number
): ConnectorApiError {
  if (typeof response === 'string') {
    return new ConnectorApiError(response || `HTTP ${statusCode} Error`, statusCode);
  }

  if (!response || typeof response !== 'object') {
    return new ConnectorApiError(`HTTP ${statusCode} Error`, statusCode);
  }

  const data = response as Record<string, unknown>;

  const message =
    (data.message as string) ||
    (data.error as string) ||
    ((data.error as Record<string, unknown>)?.message as string) ||
    (data.error_description as string) ||
    (data.detail as string) ||
    `HTTP ${statusCode} Error`;

  let errors: ApiErrorDetail[] | undefined;
  if (Array.isArray(data.errors)) {
    errors = data.errors.map((e: Record<string, unknown>) => ({
      code: String(e.code || e.error || 'unknown'),
      message: String(e.message || e.description || 'Unknown error'),
      field: e.field as string,
    }));
  }

  const requestId =
    (data.request_id as string) ||
    (data.requestId as string) ||
    (data.trace_id as string);

  return new ConnectorApiError(message, statusCode, { errors, requestId });
}
