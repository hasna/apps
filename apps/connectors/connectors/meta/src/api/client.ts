import type { MetaConfig, OutputFormat } from '../types';
import { MetaApiError } from '../types';

const DEFAULT_BASE_URL = 'https://graph.facebook.com';
const DEFAULT_API_VERSION = 'v22.0';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  params?: Record<string, string | number | boolean | string[] | undefined>;
  body?: Record<string, unknown> | unknown[] | string | FormData;
  headers?: Record<string, string>;
  format?: OutputFormat;
}

export class MetaClient {
  private readonly accessToken: string;
  private readonly baseUrl: string;
  private readonly apiVersion: string;

  constructor(config: MetaConfig) {
    if (!config.accessToken) {
      throw new Error('Access token is required');
    }
    this.accessToken = config.accessToken;
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
    this.apiVersion = config.apiVersion || DEFAULT_API_VERSION;
  }

  private buildUrl(path: string, params?: Record<string, string | number | boolean | string[] | undefined>): string {
    // Handle paths that already include version
    const fullPath = path.startsWith('/') ? path : `/${path}`;
    const versionedPath = fullPath.startsWith(`/${this.apiVersion}`)
      ? fullPath
      : `/${this.apiVersion}${fullPath}`;

    const url = new URL(`${this.baseUrl}${versionedPath}`);

    // Always add access token
    url.searchParams.append('access_token', this.accessToken);

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          if (Array.isArray(value)) {
            url.searchParams.append(key, value.join(','));
          } else {
            url.searchParams.append(key, String(value));
          }
        }
      });
    }

    return url.toString();
  }

  /**
   * Make an authenticated request to Meta Graph API
   */
  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body, headers = {} } = options;

    const url = this.buildUrl(path, params);

    const requestHeaders: Record<string, string> = {
      'Accept': 'application/json',
      ...headers,
    };

    const fetchOptions: RequestInit = {
      method,
      headers: requestHeaders,
    };

    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
      if (body instanceof FormData) {
        // Don't set Content-Type for FormData, let fetch handle it
        fetchOptions.body = body;
      } else {
        requestHeaders['Content-Type'] = 'application/json';
        fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
      }
    }

    const response = await fetch(url, fetchOptions);

    // Handle 204 No Content
    if (response.status === 204) {
      return {} as T;
    }

    // Parse response
    let data: unknown;
    const contentType = response.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
      const text = await response.text();
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = text;
        }
      }
    } else {
      data = await response.text();
    }

    // Handle errors
    if (!response.ok) {
      const errorData = data as { error?: { message?: string; type?: string; code?: number; error_subcode?: number; fbtrace_id?: string } };
      const errorMessage = errorData?.error?.message ||
        (typeof data === 'object' && data !== null ? JSON.stringify(data) : String(data || response.statusText));

      throw new MetaApiError(errorMessage, response.status, {
        message: errorMessage,
        type: errorData?.error?.type || 'Unknown',
        code: errorData?.error?.code || response.status,
        error_subcode: errorData?.error?.error_subcode,
        fbtrace_id: errorData?.error?.fbtrace_id,
      });
    }

    return data as T;
  }

  async get<T>(path: string, params?: Record<string, string | number | boolean | string[] | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'GET', params });
  }

  async post<T>(path: string, body?: Record<string, unknown> | unknown[] | string | FormData, params?: Record<string, string | number | boolean | string[] | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'POST', body, params });
  }

  async delete<T>(path: string, params?: Record<string, string | number | boolean | string[] | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'DELETE', params });
  }

  /**
   * Get a preview of the access token (for display/debugging)
   */
  getAccessTokenPreview(): string {
    if (this.accessToken.length > 20) {
      return `${this.accessToken.substring(0, 10)}...${this.accessToken.substring(this.accessToken.length - 6)}`;
    }
    return '***';
  }

  /**
   * Get API version
   */
  getApiVersion(): string {
    return this.apiVersion;
  }
}
