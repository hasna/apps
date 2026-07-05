import type { WalmartMarketplaceConfig } from '../types';
import { WalmartMarketplaceApiError } from '../types';

export const DEFAULT_BASE_URL = 'https://marketplace.walmartapis.com/v3';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | unknown[] | string;
  headers?: Record<string, string>;
  correlationId?: string;
}

export class WalmartMarketplaceClient {
  private readonly accessToken: string;
  private readonly serviceName: string;
  private readonly baseUrl: string;
  private readonly defaultCorrelationId?: string;

  constructor(config: WalmartMarketplaceConfig) {
    if (!config.accessToken) {
      throw new Error('Access token is required');
    }
    if (!config.serviceName) {
      throw new Error('Service name is required');
    }

    this.accessToken = config.accessToken;
    this.serviceName = config.serviceName;
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
    this.defaultCorrelationId = config.correlationId;
  }

  private buildUrl(path: string, params?: Record<string, string | number | boolean | undefined>): string {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const url = new URL(`${this.baseUrl}${normalizedPath}`);

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.append(key, String(value));
        }
      });
    }

    return url.toString();
  }

  private resolveCorrelationId(override?: string): string {
    return override || this.defaultCorrelationId || crypto.randomUUID();
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body, headers = {}, correlationId } = options;
    const url = this.buildUrl(path, params);

    const requestHeaders: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'WM_SEC.ACCESS_TOKEN': this.accessToken,
      'WM_QOS.CORRELATION_ID': this.resolveCorrelationId(correlationId),
      'WM_SVC.NAME': this.serviceName,
      ...headers,
    };

    const fetchOptions: RequestInit = {
      method,
      headers: requestHeaders,
    };

    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
      fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
    }

    const response = await fetch(url, fetchOptions);

    if (response.status === 204) {
      return {} as T;
    }

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

    if (!response.ok) {
      const errorData = data as { errors?: Array<{ description?: string; info?: string }> };
      const firstError = errorData?.errors?.[0];
      throw new WalmartMarketplaceApiError(
        firstError?.description || firstError?.info || `Walmart Marketplace API error: ${response.status}`,
        response.status,
        errorData?.errors
      );
    }

    return data as T;
  }

  async get<T>(path: string, params?: Record<string, string | number | boolean | undefined>, options?: Pick<RequestOptions, 'correlationId'>): Promise<T> {
    return this.request<T>(path, { method: 'GET', params, ...options });
  }

  async post<T>(path: string, body?: Record<string, unknown> | unknown[] | string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'POST', body: body as Record<string, unknown>, params });
  }

  async put<T>(path: string, body?: Record<string, unknown> | object, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'PUT', body: body as Record<string, unknown>, params });
  }

  getAccessTokenPreview(): string {
    if (this.accessToken.length > 10) {
      return `${this.accessToken.substring(0, 6)}...${this.accessToken.substring(this.accessToken.length - 4)}`;
    }
    return '***';
  }

  getServiceName(): string {
    return this.serviceName;
  }
}
