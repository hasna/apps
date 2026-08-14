import type { ToastConfig } from '../types';
import { ToastApiError } from '../types';
import { DEFAULT_BASE_URL, getValidAccessToken } from './auth';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | unknown[] | string;
  headers?: Record<string, string>;
  restaurantExternalId?: string;
  retries?: number;
  timeout?: number;
}

const DEFAULT_RETRIES = 2;
const DEFAULT_TIMEOUT_MS = 30_000;

export class ToastClient {
  private readonly config: ToastConfig;

  constructor(config: ToastConfig) {
    if (!config.clientId) {
      throw new Error('Client ID is required');
    }
    if (!config.clientSecret) {
      throw new Error('Client secret is required');
    }
    if (!config.restaurantExternalId) {
      throw new Error('Restaurant external ID is required');
    }
    this.config = config;
  }

  getBaseUrl(): string {
    return this.config.baseUrl || DEFAULT_BASE_URL;
  }

  getRestaurantExternalId(): string {
    return this.config.restaurantExternalId;
  }

  private buildUrl(
    path: string,
    params?: Record<string, string | number | boolean | undefined>,
  ): string {
    const url = new URL(`${this.getBaseUrl()}${path}`);

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.append(key, String(value));
        }
      });
    }

    return url.toString();
  }

  private async getAuthHeaders(): Promise<Record<string, string>> {
    const accessToken = await getValidAccessToken({
      clientId: this.config.clientId,
      clientSecret: this.config.clientSecret,
      baseUrl: this.getBaseUrl(),
    });

    return {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    };
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const {
      method = 'GET',
      params,
      body,
      headers = {},
      restaurantExternalId,
      retries = DEFAULT_RETRIES,
      timeout = DEFAULT_TIMEOUT_MS,
    } = options;

    const url = this.buildUrl(path, params);
    const authHeaders = await this.getAuthHeaders();
    const restaurantId = restaurantExternalId || this.config.restaurantExternalId;

    const requestHeaders: Record<string, string> = {
      ...authHeaders,
      'Toast-Restaurant-External-ID': restaurantId,
      ...headers,
    };

    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
      requestHeaders['Content-Type'] = 'application/json';
    }

    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= retries; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      try {
        const fetchOptions: RequestInit = {
          method,
          headers: requestHeaders,
          signal: controller.signal,
        };

        if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
          fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
        }

        const response = await fetch(url, fetchOptions);
        clearTimeout(timeoutId);

        if (response.status === 204) {
          return {} as T;
        }

        const contentType = response.headers.get('content-type') || '';
        let data: unknown;

        if (contentType.includes('application/json')) {
          const text = await response.text();
          data = text ? JSON.parse(text) : {};
        } else {
          data = await response.text();
        }

        if (!response.ok) {
          const shouldRetry = response.status === 429 || response.status >= 500;
          if (shouldRetry && attempt < retries) {
            const retryAfter = Number(response.headers.get('retry-after') || '1');
            await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
            continue;
          }

          const message =
            typeof data === 'object' && data !== null && 'message' in data
              ? String((data as { message?: string }).message)
              : `Toast API error: ${response.status}`;

          throw new ToastApiError(message, response.status);
        }

        return data as T;
      } catch (err) {
        clearTimeout(timeoutId);
        lastError = err instanceof Error ? err : new Error(String(err));

        if (attempt < retries && !(err instanceof ToastApiError && err.isAuthError())) {
          await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 500));
          continue;
        }

        throw lastError;
      }
    }

    throw lastError || new Error('Request failed');
  }

  async get<T>(
    path: string,
    params?: Record<string, string | number | boolean | undefined>,
    options?: Omit<RequestOptions, 'method' | 'params' | 'body'>,
  ): Promise<T> {
    return this.request<T>(path, { method: 'GET', params, ...options });
  }

  async post<T>(
    path: string,
    body?: Record<string, unknown> | unknown[] | string,
    options?: Omit<RequestOptions, 'method' | 'body'>,
  ): Promise<T> {
    return this.request<T>(path, { method: 'POST', body, ...options });
  }
}
