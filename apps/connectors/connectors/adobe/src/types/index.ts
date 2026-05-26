// Adobe PDF Services API Types

// ============================================
// Configuration
// ============================================

export interface ConnectorConfig {
  apiKey?: string;        // client_id (used as x-api-key header)
  token?: string;         // Alias for apiKey
  apiSecret?: string;     // client_secret
  accessToken?: string;   // OAuth2 access token (cached)
  baseUrl?: string;       // Override base URL
  region?: 'us' | 'eu';  // API region
}

// ============================================
// OAuth2 Types
// ============================================

export interface OAuth2Config {
  clientId: string;
  clientSecret: string;
  redirectUri?: string;
}

export interface OAuth2Tokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  tokenType?: string;
  scope?: string;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'pretty';

// ============================================
// Asset Types
// ============================================

export interface AssetUploadResponse {
  uploadUri: string;
  assetID: string;
}

export interface AssetMetadata {
  type: string;
  size: number;
}

// ============================================
// Job Types
// ============================================

export type JobStatus = 'in progress' | 'done' | 'failed';

export interface JobAsset {
  downloadUri: string;
  metadata?: AssetMetadata;
}

export interface JobStatusResponse {
  status: JobStatus;
  asset?: JobAsset;
  assets?: JobAsset[];
  content?: unknown;
  error?: {
    code: string;
    message: string;
  };
}

// ============================================
// Operation Types
// ============================================

export type CompressionLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export type ExportFormat = 'docx' | 'doc' | 'xlsx' | 'pptx' | 'rtf' | 'jpeg' | 'png';

export type OcrLocale = 'en-US' | 'da-DK' | 'de-DE' | 'es-ES' | 'fi-FI' | 'fr-FR' | 'it-IT' | 'ja-JP' | 'ko-KR' | 'nb-NO' | 'nl-NL' | 'pt-BR' | 'sv-SE' | 'zh-CN' | 'zh-TW';

export type OcrType = 'SEARCHABLE_IMAGE' | 'SEARCHABLE_IMAGE_EXACT';

export type EncryptionAlgorithm = 'AES_128' | 'AES_256';

export interface PageRange {
  start: number;
  end: number;
}

export interface CombineAsset {
  assetID: string;
  pageRanges?: PageRange[];
}

export interface CompressParams {
  assetID: string;
  compressionLevel?: CompressionLevel;
}

export interface ExportParams {
  assetID: string;
  targetFormat: ExportFormat;
}

export interface CombineParams {
  assets: CombineAsset[];
}

export interface SplitParams {
  assetID: string;
  pageRanges?: PageRange[];
  pageCount?: number;
}

export interface OcrParams {
  assetID: string;
  ocrLocale?: OcrLocale;
  ocrType?: OcrType;
}

export interface ProtectParams {
  assetID: string;
  passwordProtection: {
    userPassword: string;
    ownerPassword?: string;
  };
  encryptionAlgorithm?: EncryptionAlgorithm;
}

export interface RemoveProtectionParams {
  assetID: string;
  password: string;
}

export interface ExtractParams {
  assetID: string;
  elementsToExtract?: ('text' | 'tables')[];
  renditionsToExtract?: ('tables' | 'figures')[];
}

export interface WatermarkParams {
  assetID: string;
  watermarkAssetID?: string;
  text?: string;
  appearance?: {
    fontSize?: number;
    fontColor?: string;
    opacity?: number;
  };
}

export interface DeletePagesParams {
  assetID: string;
  pageRanges: PageRange[];
}

export interface ReorderPagesParams {
  assetID: string;
  pagesOrdering: { pageNumber: number }[];
}

export interface RotatePagesParams {
  assetID: string;
  pagesRotation: { pageNumber: number; rotation: 90 | 180 | 270 }[];
}

export interface DocumentMergeParams {
  assetID: string;
  jsonDataForMerge: Record<string, unknown>;
  outputFormat?: 'pdf' | 'docx';
}

// ============================================
// API Error Types
// ============================================

export interface ApiErrorDetail {
  code: string;
  message: string;
  field?: string;
  resource?: string;
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
        return 'Authentication failed. Please check your client credentials.';
      case 403:
        return 'Access denied. You do not have permission to perform this action.';
      case 404:
        return 'Resource not found.';
      case 429:
        return 'Rate limit exceeded (250 req/min). Please wait and try again.';
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
      resource: e.resource as string,
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
