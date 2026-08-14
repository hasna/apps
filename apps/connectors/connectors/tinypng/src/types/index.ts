// TinyPNG Connector Types

export interface TinypngConfig {
  apiKey: string;
  baseUrl?: string;
}

export type OutputFormat = 'json' | 'pretty';

export interface ShrinkSource {
  url: string;
}

export interface ShrinkStoreOptions {
  service: StoreService;
  aws_access_key_id?: string;
  aws_secret_access_key?: string;
  gcp_access_token?: string;
  region?: string;
  path?: string;
  headers?: Record<string, string>;
  acl?: string;
}

export interface ShrinkRequest {
  source: ShrinkSource;
}

export interface OutputRequest {
  preserve?: PreserveMetadata[];
  store?: ShrinkStoreOptions;
}

export interface ShrinkImageInfo {
  size: number;
  type: string;
}

export interface ShrinkResponseBody {
  input?: ShrinkImageInfo;
  output?: ShrinkImageInfo;
  error?: string;
  message?: string;
}

export interface ShrinkResult extends ShrinkResponseBody {
  location?: string;
  compressionCount?: string;
  contentType?: string;
  contentLength?: string;
  imageWidth?: string;
  imageHeight?: string;
}

export interface OutputDataResult extends ShrinkResult {
  data: Uint8Array;
}

export const SUPPORTED_STORE_SERVICES = ['s3', 'gcs'] as const;
export type StoreService = (typeof SUPPORTED_STORE_SERVICES)[number];

export const SUPPORTED_PRESERVE_METADATA = ['copyright', 'creation', 'location'] as const;
export type PreserveMetadata = (typeof SUPPORTED_PRESERVE_METADATA)[number];

export class TinypngApiError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'TinypngApiError';
    this.statusCode = statusCode;
  }
}
