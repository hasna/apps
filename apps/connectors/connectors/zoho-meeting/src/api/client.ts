import type { ZohoMeetingConfig } from '../types';
import { ZohoMeetingApiError } from '../types';

export const DC_BASES: Record<string, string> = {
  com: 'https://meeting.zoho.com',
  eu: 'https://meeting.zoho.eu',
  in: 'https://meeting.zoho.in',
  'com.au': 'https://meeting.zoho.com.au',
  jp: 'https://meeting.zoho.jp',
  ca: 'https://meeting.zoho.ca',
  sa: 'https://meeting.zoho.sa',
};

export function resolveBaseUrl(config: Pick<ZohoMeetingConfig, 'dataCenter' | 'baseUrl'>): string {
  if (config.baseUrl) {
    return config.baseUrl.replace(/\/$/, '');
  }

  const dc = (config.dataCenter ?? 'com').toLowerCase();
  const host = DC_BASES[dc];
  if (!host) {
    throw new Error(`Zoho Meeting data_center must be one of: ${Object.keys(DC_BASES).join(', ')}`);
  }

  return `${host}/api/v2`;
}

export interface ZohoMeetingRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown>;
}

export class ZohoMeetingClient {
  private readonly token: string;
  private readonly baseUrl: string;

  constructor(config: ZohoMeetingConfig) {
    if (!config.token?.trim()) {
      throw new Error('Zoho Meeting token is required');
    }
    this.token = config.token.trim();
    this.baseUrl = resolveBaseUrl(config);
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  getTokenPreview(): string {
    if (this.token.length > 8) {
      return `${this.token.substring(0, 4)}...${this.token.substring(this.token.length - 4)}`;
    }
    return '***';
  }

  async request<T>(path: string, options: ZohoMeetingRequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body } = options;
    const url = new URL(`${this.baseUrl}${path}`);

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.append(key, String(value));
        }
      }
    }

    const headers: Record<string, string> = {
      Authorization: `Zoho-oauthtoken ${this.token}`,
      Accept: 'application/json',
    };

    const fetchOptions: RequestInit = { method, headers };

    if (body !== undefined && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      headers['Content-Type'] = 'application/json';
      fetchOptions.body = JSON.stringify(body);
    }

    const response = await fetch(url.toString(), fetchOptions);

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
      const record = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
      const message =
        (typeof record.message === 'string' && record.message) ||
        (typeof record.error === 'string' && record.error) ||
        `Zoho Meeting API Error: ${response.status} ${response.statusText}`;
      const code = typeof record.code === 'string' ? record.code : undefined;
      throw new ZohoMeetingApiError(message, response.status, code);
    }

    return data as T;
  }
}
