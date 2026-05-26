import type { WhatsAppConfig, WhatsAppErrorResponse } from '../types';
import { WhatsAppApiError } from '../types';

const DEFAULT_BASE_URL = 'https://graph.facebook.com/v18.0';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | unknown[];
  headers?: Record<string, string>;
}

export class WhatsAppClient {
  private readonly accessToken: string;
  private readonly phoneNumberId: string;
  private readonly businessAccountId?: string;
  private readonly baseUrl: string;

  constructor(config: WhatsAppConfig) {
    if (!config.accessToken) {
      throw new Error('Access token is required');
    }
    if (!config.phoneNumberId) {
      throw new Error('Phone number ID is required');
    }
    this.accessToken = config.accessToken;
    this.phoneNumberId = config.phoneNumberId;
    this.businessAccountId = config.businessAccountId;
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  }

  private buildUrl(path: string, params?: Record<string, string | number | boolean | undefined>): string {
    const url = new URL(`${this.baseUrl}${path}`);

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.append(key, String(value));
        }
      });
    }

    return url.toString();
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body, headers = {} } = options;

    const url = this.buildUrl(path, params);

    const requestHeaders: Record<string, string> = {
      'Authorization': `Bearer ${this.accessToken}`,
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
      fetchOptions.body = JSON.stringify(body);
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
      const errorData = data as WhatsAppErrorResponse | null;
      const error = errorData?.error;
      throw new WhatsAppApiError(
        error?.message || response.statusText,
        response.status,
        error?.code || 0,
        error?.fbtrace_id || '',
        error?.error_subcode
      );
    }

    return data as T;
  }

  async get<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'GET', params });
  }

  async post<T>(path: string, body?: Record<string, unknown>): Promise<T> {
    return this.request<T>(path, { method: 'POST', body });
  }

  async delete<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'DELETE', params });
  }

  getPhoneNumberId(): string {
    return this.phoneNumberId;
  }

  getBusinessAccountId(): string | undefined {
    return this.businessAccountId;
  }

  getTokenPreview(): string {
    if (this.accessToken.length > 15) {
      return `${this.accessToken.substring(0, 10)}...${this.accessToken.substring(this.accessToken.length - 4)}`;
    }
    return '***';
  }
}
