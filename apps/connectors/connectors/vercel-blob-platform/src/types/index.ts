// Vercel Blob Platform connector types

export type BlobAccessType = 'public' | 'private';
export type ListMode = 'expanded' | 'folded';
export type OutputFormat = 'json' | 'pretty';

export interface VercelBlobPlatformConfig {
  token?: string;
  storeId?: string;
  oidcToken?: string;
}

export interface ProfileConfig {
  token?: string;
  storeId?: string;
  oidcToken?: string;
}

export interface PutBlobOptions {
  access: BlobAccessType;
  contentType?: string;
  addRandomSuffix?: boolean;
  allowOverwrite?: boolean;
  cacheControlMaxAge?: number;
  ifMatch?: string;
}

export interface PutBlobResult {
  url: string;
  downloadUrl: string;
  pathname: string;
  contentType: string;
  contentDisposition: string;
  etag: string;
}

export interface ListBlobItem {
  url: string;
  downloadUrl: string;
  pathname: string;
  size: number;
  uploadedAt: string;
  etag: string;
}

export interface ListBlobsResult {
  blobs: ListBlobItem[];
  cursor?: string;
  hasMore: boolean;
  folders?: string[];
}

export interface ListBlobsOptions {
  limit?: number;
  prefix?: string;
  cursor?: string;
  mode?: ListMode;
}

export interface HeadBlobResult {
  url: string;
  downloadUrl: string;
  pathname: string;
  size: number;
  contentType: string;
  contentDisposition: string;
  cacheControl: string;
  uploadedAt: string;
  etag: string;
}

export interface GetBlobMetadata {
  url: string;
  downloadUrl: string;
  pathname: string;
  contentType: string | null;
  contentDisposition: string;
  cacheControl: string;
  size: number | null;
  uploadedAt: string;
  etag: string;
}

export interface GetBlobResult {
  statusCode: 200 | 304;
  body: string | null;
  blob: GetBlobMetadata;
}

export interface DeleteBlobOptions {
  ifMatch?: string;
}

export class VercelBlobApiError extends Error {
  public readonly statusCode: number;
  public readonly code?: string;

  constructor(message: string, statusCode: number, code?: string) {
    super(message);
    this.name = 'VercelBlobApiError';
    this.statusCode = statusCode;
    this.code = code;
  }
}
