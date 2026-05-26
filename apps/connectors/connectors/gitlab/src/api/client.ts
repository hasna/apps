import type { GitLabConfig, OutputFormat } from '../types';
import { GitLabApiError } from '../types';

const DEFAULT_BASE_URL = 'https://gitlab.com/api/v4';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  params?: Record<string, string | number | boolean | string[] | undefined>;
  body?: Record<string, unknown> | unknown[] | string;
  headers?: Record<string, string>;
  format?: OutputFormat;
}

export interface PaginationHeaders {
  page?: number;
  perPage?: number;
  total?: number;
  totalPages?: number;
  nextPage?: number;
  prevPage?: number;
}

export class GitLabClient {
  private readonly accessToken: string;
  private readonly baseUrl: string;

  constructor(config: GitLabConfig) {
    if (!config.accessToken) {
      throw new Error('Access token is required');
    }
    this.accessToken = config.accessToken;
    // Support both full URL and just the hostname
    if (config.baseUrl) {
      if (config.baseUrl.includes('/api/')) {
        this.baseUrl = config.baseUrl;
      } else {
        // Strip trailing slash and add API path
        const base = config.baseUrl.replace(/\/+$/, '');
        this.baseUrl = `${base}/api/v4`;
      }
    } else {
      this.baseUrl = DEFAULT_BASE_URL;
    }
  }

  private buildUrl(path: string, params?: Record<string, string | number | boolean | string[] | undefined>): string {
    const url = new URL(`${this.baseUrl}${path}`);

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          if (Array.isArray(value)) {
            value.forEach(v => url.searchParams.append(`${key}[]`, String(v)));
          } else {
            url.searchParams.append(key, String(value));
          }
        }
      });
    }

    return url.toString();
  }

  /**
   * Make an authenticated request to GitLab API
   * Uses PRIVATE-TOKEN header for authentication
   */
  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body, headers = {} } = options;

    const url = this.buildUrl(path, params);

    const requestHeaders: Record<string, string> = {
      'PRIVATE-TOKEN': this.accessToken,
      'Accept': 'application/json',
      ...headers,
    };

    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
      requestHeaders['Content-Type'] = 'application/json';
    }

    const fetchOptions: RequestInit = {
      method,
      headers: requestHeaders,
    };

    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
      fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
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
      let errorMessage: string;
      let errors: string[] | undefined;

      if (typeof data === 'object' && data !== null) {
        const errorData = data as { message?: string | Record<string, string[]>; error?: string; error_description?: string };
        if (typeof errorData.message === 'string') {
          errorMessage = errorData.message;
        } else if (typeof errorData.message === 'object') {
          // GitLab returns validation errors as { field: [errors] }
          errors = Object.entries(errorData.message).flatMap(([field, msgs]) =>
            msgs.map(msg => `${field}: ${msg}`)
          );
          errorMessage = errors.join(', ');
        } else if (errorData.error_description) {
          errorMessage = errorData.error_description;
        } else if (errorData.error) {
          errorMessage = errorData.error;
        } else {
          errorMessage = JSON.stringify(data);
        }
      } else {
        errorMessage = String(data || response.statusText);
      }

      throw new GitLabApiError(errorMessage, response.status, errors);
    }

    return data as T;
  }

  /**
   * Make a paginated request and extract pagination headers
   */
  async requestWithPagination<T>(path: string, options: RequestOptions = {}): Promise<{ data: T; pagination: PaginationHeaders }> {
    const { method = 'GET', params, headers = {} } = options;

    const url = this.buildUrl(path, params);

    const requestHeaders: Record<string, string> = {
      'PRIVATE-TOKEN': this.accessToken,
      'Accept': 'application/json',
      ...headers,
    };

    const response = await fetch(url, {
      method,
      headers: requestHeaders,
    });

    // Parse pagination headers
    const pagination: PaginationHeaders = {
      page: parseInt(response.headers.get('x-page') || '1'),
      perPage: parseInt(response.headers.get('x-per-page') || '20'),
      total: response.headers.get('x-total') ? parseInt(response.headers.get('x-total')!) : undefined,
      totalPages: response.headers.get('x-total-pages') ? parseInt(response.headers.get('x-total-pages')!) : undefined,
      nextPage: response.headers.get('x-next-page') ? parseInt(response.headers.get('x-next-page')!) : undefined,
      prevPage: response.headers.get('x-prev-page') ? parseInt(response.headers.get('x-prev-page')!) : undefined,
    };

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
      const errorMessage = typeof data === 'object' && data !== null
        ? JSON.stringify(data)
        : String(data || response.statusText);
      throw new GitLabApiError(errorMessage, response.status);
    }

    return { data: data as T, pagination };
  }

  async get<T>(path: string, params?: Record<string, string | number | boolean | string[] | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'GET', params });
  }

  async post<T>(path: string, body?: Record<string, unknown> | unknown[] | string | object, params?: Record<string, string | number | boolean | string[] | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'POST', body: body as Record<string, unknown>, params });
  }

  async put<T>(path: string, body?: Record<string, unknown> | object, params?: Record<string, string | number | boolean | string[] | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'PUT', body: body as Record<string, unknown>, params });
  }

  async patch<T>(path: string, body?: Record<string, unknown> | object, params?: Record<string, string | number | boolean | string[] | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'PATCH', body: body as Record<string, unknown>, params });
  }

  async delete<T>(path: string, params?: Record<string, string | number | boolean | string[] | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'DELETE', params });
  }

  /**
   * Get a preview of the access token (for display/debugging)
   */
  getAccessTokenPreview(): string {
    if (this.accessToken.length > 10) {
      return `${this.accessToken.substring(0, 6)}...${this.accessToken.substring(this.accessToken.length - 4)}`;
    }
    return '***';
  }
}
