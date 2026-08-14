import type { ZohoFormsConfig } from '../types';
import { ZohoFormsApiError } from '../types';

export const DC_BASES: Record<string, string> = {
  com: 'https://forms.zoho.com',
  eu: 'https://forms.zoho.eu',
  in: 'https://forms.zoho.in',
  'com.au': 'https://forms.zoho.com.au',
  jp: 'https://forms.zoho.jp',
  ca: 'https://forms.zoho.ca',
  sa: 'https://forms.zoho.sa',
};

export function resolveBaseUrl(config: ZohoFormsConfig): string {
  if (config.baseUrl) {
    return config.baseUrl.replace(/\/$/, '').replace(/\/api\/v2$/, '');
  }
  const dc = (config.dataCenter || 'com').toLowerCase();
  const base = DC_BASES[dc];
  if (!base) {
    throw new Error(`Zoho Forms data_center must be one of: ${Object.keys(DC_BASES).join(', ')}`);
  }
  return base;
}

export class ZohoFormsClient {
  private readonly token: string;
  private readonly baseUrl: string;

  constructor(config: ZohoFormsConfig) {
    if (!config.token) {
      throw new Error('Zoho Forms token is required');
    }
    this.token = config.token;
    this.baseUrl = `${resolveBaseUrl(config)}/api/v2`;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  async request<T>(
    path: string,
    options: {
      method?: string;
      body?: Record<string, unknown>;
      params?: Record<string, string | number | boolean | undefined>;
    } = {},
  ): Promise<T> {
    const { method = 'GET', body, params } = options;
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
      const record = (typeof data === 'object' && data !== null ? data : {}) as {
        message?: string;
        error?: string;
        code?: string;
      };
      throw new ZohoFormsApiError(
        record.message || record.error || response.statusText || 'Request failed',
        response.status,
        record.code,
      );
    }

    const record = (typeof data === 'object' && data !== null ? data : {}) as {
      code?: string;
      message?: string;
    };
    if (record.code && typeof record.code === 'string' && !['0', '200'].includes(record.code)) {
      throw new ZohoFormsApiError(record.message || `code ${record.code}`, response.status, record.code);
    }

    return data as T;
  }
}
