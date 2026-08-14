import type { ConnectorConfig, AuthMode } from '../types';
import { TrustpilotApiError } from '../types';

const DEFAULT_BASE_URL = 'https://api.trustpilot.com/v1';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  params?: Record<string, string | number | boolean | undefined | string[]>;
  body?: Record<string, unknown>;
  auth?: AuthMode;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

export class TrustpilotClient {
  private readonly apiKey?: string;
  private readonly accessToken?: string;
  private readonly baseUrl: string;

  constructor(config: ConnectorConfig) {
    this.apiKey = config.apiKey;
    this.accessToken = config.accessToken;
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  }

  private buildUrl(path: string, params?: Record<string, string | number | boolean | undefined | string[]>): string {
    const url = new URL(`${this.baseUrl}${path}`);

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null) continue;
        if (Array.isArray(value)) {
          url.searchParams.set(key, value.join(','));
        } else if (value !== '') {
          url.searchParams.set(key, String(value));
        }
      }
    }

    return url.toString();
  }

  private buildHeaders(auth: AuthMode): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
    };

    if (auth === 'apikey') {
      if (!this.apiKey) {
        throw new Error('Trustpilot API key is required for this endpoint');
      }
      headers.apikey = this.apiKey;
      return headers;
    }

    if (this.accessToken) {
      headers.Authorization = `Bearer ${this.accessToken}`;
      return headers;
    }

    if (this.apiKey) {
      headers.apikey = this.apiKey;
      return headers;
    }

    throw new Error('Trustpilot credentials not configured (access token or API key required)');
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body, auth = 'private' } = options;
    const url = this.buildUrl(path, params);
    const headers = this.buildHeaders(auth);

    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    const fetchOptions: RequestInit = {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    };

    const response = await fetch(url, fetchOptions);

    if (response.status === 204) {
      return {} as T;
    }

    const text = await response.text();
    let data: unknown = {};

    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { raw: text };
      }
    }

    if (!response.ok) {
      const record = asRecord(data);
      const fault = asRecord(record.fault);
      const message = String(record.message ?? fault.faultstring ?? `request failed (${response.status})`);
      throw new TrustpilotApiError(`Trustpilot: ${message}`, response.status);
    }

    return data as T;
  }

  async get<T>(path: string, params?: Record<string, string | number | boolean | undefined | string[]>, auth: AuthMode = 'private'): Promise<T> {
    return this.request<T>(path, { method: 'GET', params, auth });
  }

  async post<T>(path: string, body?: Record<string, unknown>, auth: AuthMode = 'private'): Promise<T> {
    return this.request<T>(path, { method: 'POST', body, auth });
  }

  async delete<T>(path: string, auth: AuthMode = 'private'): Promise<T> {
    return this.request<T>(path, { method: 'DELETE', auth });
  }

  getApiKeyPreview(): string {
    if (!this.apiKey) return 'not set';
    if (this.apiKey.length > 10) {
      return `${this.apiKey.substring(0, 6)}...${this.apiKey.substring(this.apiKey.length - 4)}`;
    }
    return '***';
  }

  hasAccessToken(): boolean {
    return Boolean(this.accessToken);
  }
}
