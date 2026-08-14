// Transload API Types — freight dimension measurement and warehouse vision

export interface ConnectorConfig {
  apiKey?: string;
  token?: string;
  baseUrl?: string;
}

export type OutputFormat = 'json' | 'pretty';

export interface ListParams {
  [key: string]: string | number | boolean | undefined;
}

// ============================================
// Site Types
// ============================================

export interface Site {
  id: string;
  name: string;
  address?: string;
  status?: string;
  created_at?: string;
  updated_at?: string;
}

export interface SiteListResponse {
  sites?: Site[];
  data?: Site[];
  total?: number;
}

export interface SiteResponse {
  site?: Site;
  data?: Site;
}

// ============================================
// Shipment Types
// ============================================

export interface Shipment {
  id: string;
  site_id?: string;
  status?: string;
  carrier?: string;
  tracking_number?: string;
  created_at?: string;
  updated_at?: string;
}

export interface ShipmentListResponse {
  shipments?: Shipment[];
  data?: Shipment[];
  total?: number;
}

export interface ShipmentResponse {
  shipment?: Shipment;
  data?: Shipment;
}

// ============================================
// Measurement Types
// ============================================

export interface Measurement {
  id?: string;
  shipment_id?: string;
  length?: number;
  width?: number;
  height?: number;
  weight?: number;
  unit?: string;
  captured_at?: string;
  confidence?: number;
}

export interface MeasurementResponse {
  measurement?: Measurement;
  data?: Measurement;
}

export interface SyncMeasurementsResponse {
  synced?: number;
  measurements?: Measurement[];
  data?: unknown;
}

// ============================================
// Camera Types
// ============================================

export interface Camera {
  id: string;
  site_id?: string;
  name?: string;
  status?: string;
  location?: string;
}

export interface CameraListResponse {
  cameras?: Camera[];
  data?: Camera[];
  total?: number;
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

  isAuthError(): boolean {
    return this.statusCode === 401 || this.statusCode === 403;
  }

  isNotFound(): boolean {
    return this.statusCode === 404;
  }

  getUserMessage(): string {
    switch (this.statusCode) {
      case 401:
        return 'Authentication failed. Please check your API key.';
      case 403:
        return 'Access denied.';
      case 404:
        return 'Resource not found.';
      case 429:
        return 'Rate limit exceeded. Please wait and try again.';
      default:
        return this.message;
    }
  }
}

export function parseApiError(response: unknown, statusCode: number): ConnectorApiError {
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
    ((data.error as Record<string, unknown>)?.message as string) ||
    (data.detail as string) ||
    `HTTP ${statusCode} Error`;

  let errors: ApiErrorDetail[] | undefined;
  if (Array.isArray(data.errors)) {
    errors = data.errors.map((e: Record<string, unknown>) => ({
      code: String(e.code || 'unknown'),
      message: String(e.message || 'Unknown error'),
      field: e.field as string,
    }));
  }

  const requestId =
    (data.request_id as string) ||
    (data.requestId as string);

  return new ConnectorApiError(message, statusCode, { errors, requestId });
}
