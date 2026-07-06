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
  service: string;
  aws_access_key_id?: string;
  aws_secret_access_key?: string;
  region?: string;
  path?: string;
  headers?: Record<string, string>;
}

export interface ShrinkRequest {
  source: ShrinkSource;
  preserve?: string[];
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
}

export const SUPPORTED_STORE_SERVICES = ['s3', 'gcs'] as const;
export type StoreService = (typeof SUPPORTED_STORE_SERVICES)[number];

export class TinypngApiError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'TinypngApiError';
    this.statusCode = statusCode;
  }
}
