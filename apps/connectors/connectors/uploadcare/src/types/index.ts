// Uploadcare API Types

export const UPLOADCARE_ACCEPT_VERSION = 'application/vnd.uploadcare-v0.7+json';

// ============================================
// Configuration
// ============================================

export interface UploadcareConfig {
  publicKey: string;
  secretKey: string;
  baseUrl?: string;
}

export interface CliConfig {
  publicKey?: string;
  secretKey?: string;
  baseUrl?: string;
}

export type OutputFormat = 'json' | 'pretty';

// ============================================
// File Types
// ============================================

export interface UploadcareFile {
  uuid: string;
  datetime_uploaded: string;
  datetime_stored?: string | null;
  datetime_removed?: string | null;
  size: number;
  original_filename?: string;
  mime_type?: string;
  is_image?: boolean;
  is_ready?: boolean;
  url?: string;
  original_file_url?: string;
  metadata?: Record<string, string>;
}

export interface UploadcareFileList {
  total: number;
  per_page: number;
  current_page: number;
  results: UploadcareFile[];
}

// ============================================
// Group Types
// ============================================

export interface UploadcareGroup {
  id: string;
  datetime_created: string;
  files_count: number;
  cdn_url?: string;
  url?: string;
  files?: UploadcareFile[];
}

export interface UploadcareGroupList {
  total: number;
  per_page: number;
  current_page: number;
  results: UploadcareGroup[];
}

// ============================================
// Webhook Types
// ============================================

export interface UploadcareWebhook {
  id: string;
  created: string;
  updated: string;
  target_url: string;
  is_active: boolean;
  version: string;
  event: string;
}

export interface UploadcareWebhookList {
  total: number;
  per_page: number;
  current_page: number;
  results: UploadcareWebhook[];
}

// ============================================
// Project Types
// ============================================

export interface UploadcareProject {
  name: string;
  pub_key: string;
  autostore_enabled: boolean;
  secure_uploads: boolean;
  webhook_settings?: Record<string, unknown>;
}

// ============================================
// API Error Types
// ============================================

export interface UploadcareErrorDetail {
  detail?: string;
  message?: string;
}

export class ConnectorApiError extends Error {
  public readonly statusCode: number;
  public readonly responseBody?: string;
  public readonly detail?: string;

  constructor(
    message: string,
    statusCode: number,
    options?: {
      responseBody?: string;
      detail?: string;
    }
  ) {
    super(message);
    this.name = 'ConnectorApiError';
    this.statusCode = statusCode;
    this.responseBody = options?.responseBody;
    this.detail = options?.detail;
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
        return 'Authentication failed. Check your UPLOADCARE_PUBLIC_KEY and UPLOADCARE_SECRET_KEY.';
      case 403:
        return 'Access denied. Your API credentials may not have permission for this action.';
      case 404:
        return 'Resource not found.';
      case 429:
        return 'Rate limit exceeded. Please wait and try again.';
      default:
        return this.detail || this.message;
    }
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      statusCode: this.statusCode,
      detail: this.detail,
      responseBody: this.responseBody,
    };
  }
}

export function parseApiError(
  response: unknown,
  statusCode: number
): ConnectorApiError {
  if (typeof response === 'string') {
    return new ConnectorApiError(response, statusCode, { responseBody: response });
  }

  if (!response || typeof response !== 'object') {
    return new ConnectorApiError(`HTTP ${statusCode} Error`, statusCode);
  }

  const data = response as Record<string, unknown>;
  const detail =
    (data.detail as string) ||
    (data.message as string) ||
    ((data.error as Record<string, unknown>)?.message as string);

  const message = detail || `HTTP ${statusCode} Error`;

  return new ConnectorApiError(message, statusCode, {
    responseBody: JSON.stringify(data),
    detail,
  });
}
