import type { ZohoCliqConfig } from '../types';
import { ZohoCliqApiError } from '../types';

export const ZOHO_CLIQ_DC_BASES: Record<string, string> = {
  com: 'https://cliq.zoho.com',
  eu: 'https://cliq.zoho.eu',
  in: 'https://cliq.zoho.in',
  'com.au': 'https://cliq.zoho.com.au',
  jp: 'https://cliq.zoho.jp',
  ca: 'https://cliq.zoho.ca',
  sa: 'https://cliq.zoho.sa',
};

export function resolveZohoCliqBaseUrl(dataCenter = 'com', baseUrl?: string): string {
  if (baseUrl) {
    return baseUrl.replace(/\/$/, '');
  }

  const dc = dataCenter.toLowerCase();
  const host = ZOHO_CLIQ_DC_BASES[dc];
  if (!host) {
    throw new ZohoCliqApiError(
      `Invalid data center "${dataCenter}". Expected one of: ${Object.keys(ZOHO_CLIQ_DC_BASES).join(', ')}`,
      0
    );
  }

  return `${host}/api/v2`;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown>;
}

function buildQuery(params?: Record<string, string | number | boolean | undefined>): string {
  if (!params) return '';

  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue;
    query.set(key, String(value));
  }

  const text = query.toString();
  return text ? `?${text}` : '';
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

export class ZohoCliqClient {
  private readonly token: string;
  private readonly baseUrl: string;

  constructor(config: ZohoCliqConfig) {
    if (!config.token) {
      throw new Error('Zoho Cliq token is required');
    }

    this.token = config.token;
    this.baseUrl = resolveZohoCliqBaseUrl(config.dataCenter ?? 'com', config.baseUrl);
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  async request<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body } = options;
    const url = `${this.baseUrl}${path}${buildQuery(params)}`;

    const headers: Record<string, string> = {
      Authorization: `Zoho-oauthtoken ${this.token}`,
      Accept: 'application/json',
    };

    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const text = await response.text();
    const data: unknown = text
      ? (() => {
          try {
            return JSON.parse(text);
          } catch {
            return { raw: text };
          }
        })()
      : {};

    if (!response.ok) {
      const record = asRecord(data);
      const error = asRecord(record.error);
      const message =
        (typeof error.message === 'string' && error.message) ||
        (typeof record.message === 'string' && record.message) ||
        response.statusText ||
        `request failed (${response.status})`;
      const code = typeof error.code === 'string' ? error.code : undefined;
      throw new ZohoCliqApiError(message, response.status, code);
    }

    return data as T;
  }

  async get<T = unknown>(
    path: string,
    params?: Record<string, string | number | boolean | undefined>
  ): Promise<T> {
    return this.request<T>(path, { method: 'GET', params });
  }

  async post<T = unknown>(path: string, body?: Record<string, unknown>): Promise<T> {
    return this.request<T>(path, { method: 'POST', body });
  }

  async put<T = unknown>(path: string, body?: Record<string, unknown>): Promise<T> {
    return this.request<T>(path, { method: 'PUT', body });
  }

  async delete<T = unknown>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'DELETE' });
  }
}
