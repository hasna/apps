import type {
  BlobAccessType,
  DeleteBlobOptions,
  GetBlobResult,
  HeadBlobResult,
  ListBlobsOptions,
  ListBlobsResult,
  PutBlobOptions,
  PutBlobResult,
  VercelBlobPlatformConfig,
} from '../types';
import { VercelBlobApiError } from '../types';

export const DEFAULT_API_URL = 'https://vercel.com/api/blob';
export const BLOB_API_VERSION = '12';

export interface ResolvedAuth {
  token: string;
  storeId: string;
}

export function parseStoreIdFromReadWriteToken(token: string): string {
  const [, , , storeId = ''] = token.split('_');
  if (!storeId) {
    throw new Error('Invalid BLOB_READ_WRITE_TOKEN: unable to extract store ID');
  }
  return storeId;
}

export function normalizeStoreId(storeId: string): string {
  return storeId.startsWith('store_') ? storeId.slice('store_'.length) : storeId;
}

export function constructBlobUrl(storeId: string, pathname: string, access: BlobAccessType): string {
  return `https://${storeId}.${access}.blob.vercel-storage.com/${pathname}`;
}

export function isUrl(value: string): boolean {
  return value.startsWith('http://') || value.startsWith('https://');
}

function extractPathnameFromUrl(url: string): string {
  return new URL(url).pathname.slice(1);
}

export function resolveAuth(config: VercelBlobPlatformConfig): ResolvedAuth {
  if (config.token) {
    const storeId = config.storeId
      ? normalizeStoreId(config.storeId)
      : parseStoreIdFromReadWriteToken(config.token);
    return { token: config.token, storeId };
  }

  if (config.oidcToken) {
    if (!config.storeId) {
      throw new Error('storeId is required when using OIDC token authentication');
    }
    return { token: config.oidcToken, storeId: normalizeStoreId(config.storeId) };
  }

  throw new Error('token or oidcToken is required');
}

interface BlobApiErrorBody {
  error?: { code?: string; message?: string };
}

export class VercelBlobPlatformClient {
  private readonly auth: ResolvedAuth;
  private readonly apiUrl: string;

  constructor(config: VercelBlobPlatformConfig, apiUrl = DEFAULT_API_URL) {
    this.auth = resolveAuth(config);
    this.apiUrl = apiUrl.replace(/\/$/, '');
  }

  getStoreId(): string {
    return this.auth.storeId;
  }

  private buildApiHeaders(extra: Record<string, string> = {}): Record<string, string> {
    return {
      authorization: `Bearer ${this.auth.token}`,
      'x-api-version': BLOB_API_VERSION,
      'x-vercel-blob-store-id': this.auth.storeId,
      ...extra,
    };
  }

  private async requestApi<T>(
    pathname: string,
    init: RequestInit & { body?: BodyInit | null },
  ): Promise<T> {
    const url = `${this.apiUrl}${pathname}`;
    const response = await fetch(url, {
      ...init,
      headers: {
        ...this.buildApiHeaders(),
        ...(init.headers as Record<string, string> | undefined),
      },
    });

    if (response.status === 204) {
      return {} as T;
    }

    const text = await response.text();
    let data: unknown = text;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }

    if (!response.ok) {
      const err = data as BlobApiErrorBody;
      throw new VercelBlobApiError(
        err.error?.message || response.statusText || 'Blob API request failed',
        response.status,
        err.error?.code,
      );
    }

    return data as T;
  }

  async put(pathname: string, body: BodyInit, options: PutBlobOptions): Promise<PutBlobResult> {
    const params = new URLSearchParams({ pathname });
    const headers: Record<string, string> = {
      'x-vercel-blob-access': options.access,
    };

    if (options.contentType) {
      headers['x-content-type'] = options.contentType;
    }
    if (options.addRandomSuffix !== undefined) {
      headers['x-add-random-suffix'] = options.addRandomSuffix ? '1' : '0';
    }
    if (options.allowOverwrite !== undefined) {
      headers['x-allow-overwrite'] = options.allowOverwrite ? '1' : '0';
    }
    if (options.cacheControlMaxAge !== undefined) {
      headers['x-cache-control-max-age'] = String(options.cacheControlMaxAge);
    }
    if (options.ifMatch) {
      headers['x-if-match'] = options.ifMatch;
      if (options.allowOverwrite === undefined) {
        headers['x-allow-overwrite'] = '1';
      }
    }

    return this.requestApi<PutBlobResult>(`/?${params.toString()}`, {
      method: 'PUT',
      body,
      headers,
    });
  }

  async list(options: ListBlobsOptions = {}): Promise<ListBlobsResult> {
    const searchParams = new URLSearchParams();
    if (options.limit !== undefined) searchParams.set('limit', String(options.limit));
    if (options.prefix) searchParams.set('prefix', options.prefix);
    if (options.cursor) searchParams.set('cursor', options.cursor);
    if (options.mode) searchParams.set('mode', options.mode);

    const query = searchParams.toString();
    return this.requestApi<ListBlobsResult>(query ? `?${query}` : '', { method: 'GET' });
  }

  async del(urlOrPathnames: string | string[], options: DeleteBlobOptions = {}): Promise<void> {
    const urls = Array.isArray(urlOrPathnames) ? urlOrPathnames : [urlOrPathnames];
    if (options.ifMatch && urls.length > 1) {
      throw new Error('ifMatch can only be used when deleting a single blob');
    }

    const headers: Record<string, string> = {
      'content-type': 'application/json',
    };
    if (options.ifMatch) {
      headers['x-if-match'] = options.ifMatch;
    }

    await this.requestApi('/delete', {
      method: 'POST',
      headers,
      body: JSON.stringify({ urls }),
    });
  }

  async head(urlOrPathname: string): Promise<HeadBlobResult> {
    const searchParams = new URLSearchParams({ url: urlOrPathname });
    return this.requestApi<HeadBlobResult>(`?${searchParams.toString()}`, { method: 'GET' });
  }

  async get(urlOrPathname: string, access: BlobAccessType): Promise<GetBlobResult | null> {
    let blobUrl: string;
    let pathname: string;

    if (isUrl(urlOrPathname)) {
      blobUrl = urlOrPathname;
      pathname = extractPathnameFromUrl(urlOrPathname);
      const { hostname } = new URL(blobUrl);
      if (!hostname.endsWith('.blob.vercel-storage.com')) {
        throw new Error('URL does not point to a Vercel Blob store');
      }
    } else {
      pathname = urlOrPathname;
      blobUrl = constructBlobUrl(this.auth.storeId, pathname, access);
    }

    const response = await fetch(blobUrl, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${this.auth.token}`,
      },
    });

    if (response.status === 404) {
      return null;
    }

    if (response.status === 304) {
      const downloadUrl = new URL(blobUrl);
      downloadUrl.searchParams.set('download', '1');
      const lastModified = response.headers.get('last-modified');
      return {
        statusCode: 304,
        body: null,
        blob: {
          url: blobUrl,
          downloadUrl: downloadUrl.toString(),
          pathname,
          contentType: null,
          contentDisposition: response.headers.get('content-disposition') || '',
          cacheControl: response.headers.get('cache-control') || '',
          size: null,
          uploadedAt: lastModified || new Date().toISOString(),
          etag: response.headers.get('etag') || '',
        },
      };
    }

    if (!response.ok) {
      throw new VercelBlobApiError(
        `Failed to fetch blob: ${response.status} ${response.statusText}`,
        response.status,
      );
    }

    const body = await response.text();
    const contentLength = response.headers.get('content-length');
    const lastModified = response.headers.get('last-modified');
    const downloadUrl = new URL(blobUrl);
    downloadUrl.searchParams.set('download', '1');

    return {
      statusCode: 200,
      body,
      blob: {
        url: blobUrl,
        downloadUrl: downloadUrl.toString(),
        pathname,
        contentType: response.headers.get('content-type') || 'application/octet-stream',
        contentDisposition: response.headers.get('content-disposition') || '',
        cacheControl: response.headers.get('cache-control') || '',
        size: contentLength ? parseInt(contentLength, 10) : body.length,
        uploadedAt: lastModified || new Date().toISOString(),
        etag: response.headers.get('etag') || '',
      },
    };
  }
}
