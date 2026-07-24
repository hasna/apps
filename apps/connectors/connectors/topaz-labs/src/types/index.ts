export interface TopazLabsConfig {
  apiKey?: string;
  token?: string;
  baseUrl?: string;
}

export type TopazBinaryInput = Blob | ArrayBuffer | Uint8Array;

export type TopazOutputFormat = 'jpeg' | 'jpg' | 'png' | 'tiff' | 'tif';

export type TopazModelSettingValue = string | number | boolean;

export interface TopazAsyncImageRequest {
  image?: TopazBinaryInput;
  filename?: string;
  sourceId?: string;
  sourceUrl?: string;
  model?: string;
  outputHeight?: number;
  outputWidth?: number;
  cropToFill?: boolean;
  outputFormat?: TopazOutputFormat;
  webhookUrl?: string;
  modelSettings?: Record<string, TopazModelSettingValue | undefined>;
}

export interface TopazEstimateRequest {
  category?: 'Enhance' | 'Sharpen' | 'Denoise' | 'Restore' | 'Lighting' | 'Matting' | 'Tool';
  model?: string;
  inputHeight: number;
  inputWidth: number;
  outputHeight?: number;
  outputWidth?: number;
  cropToFill?: boolean;
  outputFormat?: TopazOutputFormat;
  modelSettings?: Record<string, TopazModelSettingValue | undefined>;
}

export interface TopazBulkEstimateRequest extends TopazEstimateRequest {}

export interface TopazAsyncResponse {
  process_id: string;
  source_id: string;
  eta: number;
}

export type TopazStatusState = 'Pending' | 'Processing' | 'Completed' | 'Cancelled' | 'Failed';

export interface TopazStatusResponse {
  process_id: string;
  source_id?: string;
  filename: string;
  input_format: string;
  input_height: number;
  input_width: number;
  output_format: string;
  output_height: number;
  output_width: number;
  category: string;
  model_type: string;
  model: string;
  subject_detection?: string;
  face_enhancement?: boolean;
  face_enhancement_creativity?: number;
  face_enhancement_strength?: number;
  crop_to_fill: boolean;
  options_json?: string;
  status: TopazStatusState;
  progress: number;
  eta: number;
  creation_time: number;
  modification_time: number;
  credits: number;
}

export interface TopazPaginationMetadata {
  next_cursor?: string;
  has_next_page: boolean;
}

export interface TopazPaginatedStatusesResponse {
  data: TopazStatusResponse[];
  pagination: TopazPaginationMetadata;
}

export type TopazStatusesResponse = TopazStatusResponse[] | TopazPaginatedStatusesResponse;

export interface TopazDownloadResponse {
  download_url: string;
  head_url: string;
  expiry: number;
}

export interface TopazEstimationResponse {
  duration: number;
  credits: number;
}

export type TopazBulkEstimationResult =
  | (TopazEstimationResponse & { status: 'success' })
  | { status: 'error'; code: number; message: string };

export interface ApiErrorDetail {
  code: string;
  message: string;
  field?: string;
}

export class TopazLabsApiError extends Error {
  public readonly statusCode: number;
  public readonly errors?: ApiErrorDetail[];

  constructor(message: string, statusCode: number, options?: { errors?: ApiErrorDetail[] }) {
    super(message);
    this.name = 'TopazLabsApiError';
    this.statusCode = statusCode;
    this.errors = options?.errors;
  }

  isRateLimited(): boolean {
    return this.statusCode === 429;
  }

  isAuthError(): boolean {
    return this.statusCode === 401 || this.statusCode === 403;
  }
}

export function parseApiError(response: unknown, statusCode: number): TopazLabsApiError {
  if (typeof response === 'string') {
    return new TopazLabsApiError(response, statusCode);
  }
  if (!response || typeof response !== 'object') {
    return new TopazLabsApiError(`HTTP ${statusCode} Error`, statusCode);
  }
  const data = response as Record<string, unknown>;
  const nestedError = data.error && typeof data.error === 'object'
    ? data.error as Record<string, unknown>
    : undefined;
  const message =
    (data.message as string) ||
    (data.error as string) ||
    (nestedError?.message as string) ||
    (data.detail as string) ||
    `HTTP ${statusCode} Error`;
  return new TopazLabsApiError(message, statusCode);
}
