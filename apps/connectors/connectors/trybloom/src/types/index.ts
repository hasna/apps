// Bloom (TryBloom) Connector Types

export interface TrybloomConfig {
  apiKey: string;
  baseUrl?: string;
}

export interface ListBrandsParams {
  limit?: number;
  offset?: number;
  [key: string]: string | number | boolean | undefined;
}

export interface CreateBrandRequest {
  name?: string;
  palette?: string[];
  [key: string]: unknown;
}

export interface CreateGenerationRequest {
  brandId?: string;
  prompt?: string;
  [key: string]: unknown;
}

export interface EditImageRequest {
  imageUrl?: string;
  prompt?: string;
  [key: string]: unknown;
}

export interface ResizeImageRequest {
  imageUrl?: string;
  width?: number;
  height?: number;
  [key: string]: unknown;
}

export interface UploadImageRequest {
  imageUrl?: string;
  [key: string]: unknown;
}

export interface RawRequestOptions {
  path: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  body?: Record<string, unknown> | unknown[] | string;
  params?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string>;
}

export type TrybloomJson = Record<string, unknown> | unknown[] | string | number | boolean | null;

export class TrybloomApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'TrybloomApiError';
    this.status = status;
  }
}
