// Typless API Types
// AI-powered document data extraction and OCR

export interface ConnectorConfig {
  apiKey?: string;
  token?: string;
  baseUrl?: string;
}

export type OutputFormat = 'json' | 'pretty';

export interface ExtractDataRequest {
  file: string;
  file_name: string;
  document_type_name: string;
  customer?: string;
}

export interface ExtractDataAsyncResponse {
  extraction_id: string;
}

export type ExtractionStatus = 'IN_PROGRESS' | 'SUCCESS' | 'ERROR' | 'EXPIRED';

export interface ExtractedFieldValue {
  value: string;
  confidence_score?: number;
  page_number?: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

export interface ExtractedField {
  name: string;
  data_type?: string;
  values: ExtractedFieldValue[];
}

export interface ExtractionResult {
  customer?: string;
  file_name?: string;
  object_id?: string;
  extracted_fields?: ExtractedField[];
  line_items?: unknown[];
  vat_rates?: unknown[];
}

export interface ExtractionPollResponse {
  status: ExtractionStatus;
  error?: Record<string, unknown>;
  result?: ExtractionResult;
}

export interface AwaitingPollResponse {
  extraction_ids: string[];
}

export interface AddDocumentRequest {
  file: string;
  file_name: string;
  document_type_name: string;
  learning_fields?: Record<string, unknown>;
  line_items?: unknown[];
  customer?: string;
}

export interface AddDocumentFeedbackRequest {
  object_id: string;
  learning_fields?: Record<string, unknown>;
  line_items?: unknown[];
}

export interface StartTrainingRequest {
  document_type_name: string;
}

export interface ApiErrorDetail {
  code: string;
  message: string;
  field?: string;
  details?: unknown;
}

export class ConnectorApiError extends Error {
  public readonly statusCode: number;
  public readonly errors?: ApiErrorDetail[];
  public readonly documentationUrl?: string;
  public readonly requestId?: string;

  constructor(
    message: string,
    statusCode: number,
    options?: {
      errors?: ApiErrorDetail[];
      documentationUrl?: string;
      requestId?: string;
    }
  ) {
    super(message);
    this.name = 'ConnectorApiError';
    this.statusCode = statusCode;
    this.errors = options?.errors;
    this.documentationUrl = options?.documentationUrl;
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
      documentationUrl: this.documentationUrl,
      requestId: this.requestId,
    };
  }
}

export function parseApiError(
  response: unknown,
  statusCode: number
): ConnectorApiError {
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
    (data.error_description as string) ||
    (data.detail as string) ||
    `HTTP ${statusCode} Error`;

  let errors: ApiErrorDetail[] | undefined;
  if (Array.isArray(data.errors)) {
    errors = data.errors.map((e: Record<string, unknown>) => ({
      code: String(e.code || e.error || 'unknown'),
      message: String(e.message || e.description || 'Unknown error'),
      field: e.field as string,
      details: e.details,
    }));
  }

  const documentationUrl =
    (data.documentation_url as string) ||
    (data.docs_url as string) ||
    (data.help_url as string);

  const requestId =
    (data.request_id as string) ||
    (data.requestId as string) ||
    (data.trace_id as string);

  return new ConnectorApiError(message, statusCode, {
    errors,
    documentationUrl,
    requestId,
  });
}
