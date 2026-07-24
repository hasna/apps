import type { LibraryType, RequestOptions, ZoteroConfig } from '../types';
import { ZoteroApiError } from '../types';

export const DEFAULT_BASE_URL = 'https://api.zotero.org';
export const ZOTERO_API_VERSION = '3';

export function normalizeLibraryType(libraryType?: LibraryType | 'group'): LibraryType {
  return libraryType === 'groups' || libraryType === 'group' ? 'groups' : 'users';
}

export function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}

export function buildLibraryPrefix(libraryId: string, libraryType?: LibraryType | 'group'): string {
  const normalizedType = normalizeLibraryType(libraryType);
  return `/${normalizedType}/${encodePathSegment(libraryId)}`;
}

export function buildZoteroUrl(
  baseUrl: string,
  path: string,
  params?: Record<string, string | number | boolean | undefined>
): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const url = new URL(`${baseUrl.replace(/\/$/, '')}${normalizedPath}`);

  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.append(key, String(value));
      }
    }
  }

  return url.toString();
}

export class ZoteroClient {
  private readonly apiKey: string;
  private readonly libraryId: string;
  private readonly libraryType: LibraryType;
  private readonly baseUrl: string;

  constructor(config: ZoteroConfig) {
    if (!config.apiKey) {
      throw new Error('Zotero API key is required');
    }
    if (!config.libraryId) {
      throw new Error('Zotero library ID is required');
    }

    this.apiKey = config.apiKey;
    this.libraryId = config.libraryId;
    this.libraryType = normalizeLibraryType(config.libraryType);
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  libraryPrefix(): string {
    return buildLibraryPrefix(this.libraryId, this.libraryType);
  }

  buildUrl(path: string, params?: Record<string, string | number | boolean | undefined>): string {
    return buildZoteroUrl(this.baseUrl, path, params);
  }

  defaultHeaders(extra?: Record<string, string>): Record<string, string> {
    return {
      'Zotero-API-Key': this.apiKey,
      'Zotero-API-Version': ZOTERO_API_VERSION,
      Accept: 'application/json',
      ...extra,
    };
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body, headers = {}, version } = options;

    const url = this.buildUrl(path, params);
    const requestHeaders = this.defaultHeaders(headers);

    if (version !== undefined) {
      requestHeaders['If-Unmodified-Since-Version'] = String(version);
    }

    const fetchOptions: RequestInit = {
      method,
      headers: requestHeaders,
    };

    if (body !== undefined && ['POST', 'PUT', 'PATCH'].includes(method)) {
      if (body instanceof URLSearchParams) {
        fetchOptions.body = body;
      } else if (body instanceof Buffer || body instanceof Uint8Array) {
        fetchOptions.body = body as BodyInit;
      } else if (typeof body === 'string') {
        fetchOptions.body = body;
      } else {
        requestHeaders['Content-Type'] = requestHeaders['Content-Type'] || 'application/json';
        fetchOptions.body = JSON.stringify(body);
      }
    }

    const response = await fetch(url, fetchOptions);

    if (response.status === 204) {
      return {} as T;
    }

    const contentType = response.headers.get('content-type') || '';
    let data: unknown;

    if (contentType.includes('application/json')) {
      const text = await response.text();
      data = text ? JSON.parse(text) : undefined;
    } else {
      data = await response.text();
    }

    if (!response.ok) {
      const message = typeof data === 'string'
        ? data.slice(0, 500)
        : (data as { message?: string })?.message || response.statusText;
      throw new ZoteroApiError(
        `HTTP ${response.status}: ${message}`,
        'http_error',
        response.status
      );
    }

    return data as T;
  }

  async get<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'GET', params });
  }

  async post<T>(
    path: string,
    body?: unknown,
    options: Omit<RequestOptions, 'method' | 'body'> = {}
  ): Promise<T> {
    return this.request<T>(path, { ...options, method: 'POST', body });
  }

  async patch<T>(
    path: string,
    body?: unknown,
    options: Omit<RequestOptions, 'method' | 'body'> = {}
  ): Promise<T> {
    return this.request<T>(path, { ...options, method: 'PATCH', body });
  }

  async delete<T>(
    path: string,
    options: Omit<RequestOptions, 'method'> = {}
  ): Promise<T> {
    return this.request<T>(path, { ...options, method: 'DELETE' });
  }

  async requestText(path: string, options: RequestOptions = {}): Promise<string> {
    const result = await this.request<string>(path, options);
    return typeof result === 'string' ? result : JSON.stringify(result);
  }
}
