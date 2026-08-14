import type { SquarespaceConfig } from '../types';
import { SquarespaceApiError } from '../types';

const API_ORIGIN = 'https://api.squarespace.com';
const DEFAULT_BASE_URL = `${API_ORIGIN}/1.0`;

type QueryValue = string | number | boolean;

export interface SquarespaceRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  params?: Record<string, QueryValue | QueryValue[] | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
}

export class SquarespaceClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: SquarespaceConfig) {
    if (!config.apiKey) {
      throw new Error('Squarespace API key is required');
    }
    this.apiKey = config.apiKey;
    this.baseUrl = DEFAULT_BASE_URL;
  }

  async request<T>(endpoint: string, options: SquarespaceRequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body, headers = {} } = options;

    let url = this.getUrl(endpoint);
    if (params) {
      const searchParams = new URLSearchParams();
      Object.entries(params).forEach(([key, value]) => {
        if (Array.isArray(value)) {
          value.forEach(item => {
            if (item !== '') {
              searchParams.append(key, String(item));
            }
          });
        } else if (value !== undefined && value !== null && value !== '') {
          searchParams.append(key, String(value));
        }
      });
      const queryString = searchParams.toString();
      if (queryString) {
        url += `?${queryString}`;
      }
    }

    const requestHeaders: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: 'application/json',
      'User-Agent': 'Hasna-Connect-Squarespace/1.0',
      ...headers,
    };

    if (body !== undefined && method !== 'GET' && method !== 'DELETE') {
      requestHeaders['Content-Type'] = 'application/json';
    }

    const response = await fetch(url, {
      method,
      headers: requestHeaders,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

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
      let errorMessage = `Squarespace API Error: ${response.status} ${response.statusText}`;
      let type: string | undefined;
      let details: unknown;

      if (typeof data === 'object' && data !== null) {
        const errData = data as Record<string, unknown>;
        if (errData.message) {
          errorMessage = String(errData.message);
        } else if (errData.type) {
          errorMessage = String(errData.type);
        }
        if (errData.type) type = String(errData.type);
        if (errData.details) details = errData.details;
        if (errData.subtype) details = errData.subtype;
      }

      throw new SquarespaceApiError(errorMessage, response.status, type, details);
    }

    return data as T;
  }

  getApiKeyPreview(): string {
    if (this.apiKey.length > 12) {
      return `${this.apiKey.substring(0, 6)}...${this.apiKey.substring(this.apiKey.length - 4)}`;
    }
    return '***';
  }

  private getUrl(endpoint: string): string {
    if (/^https?:\/\//.test(endpoint)) {
      return endpoint;
    }

    if (endpoint.startsWith('/v') || endpoint.startsWith('/1.0/')) {
      return `${API_ORIGIN}${endpoint}`;
    }

    return `${this.baseUrl}${endpoint}`;
  }
}
