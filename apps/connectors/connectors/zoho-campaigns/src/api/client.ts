import type { ZohoCampaignsConfig, ZohoCampaignsResponse } from '../types';
import { ZohoCampaignsApiError } from '../types';

export const DC_BASES: Record<string, string> = {
  com: 'https://campaigns.zoho.com',
  eu: 'https://campaigns.zoho.eu',
  in: 'https://campaigns.zoho.in',
  'com.au': 'https://campaigns.zoho.com.au',
  jp: 'https://campaigns.zoho.jp',
  ca: 'https://campaigns.zoho.ca',
  sa: 'https://campaigns.zoho.sa',
};

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  query?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown>;
}

export function resolveBaseUrl(config: Pick<ZohoCampaignsConfig, 'dataCenter' | 'baseUrl'>): string {
  if (config.baseUrl) {
    return config.baseUrl.replace(/\/$/, '');
  }
  const dc = (config.dataCenter || 'com').toLowerCase();
  const base = DC_BASES[dc];
  if (!base) {
    throw new Error(`Zoho Campaigns data center must be one of: ${Object.keys(DC_BASES).join(', ')}`);
  }
  return base;
}

export function buildQuery(params: Record<string, string | number | boolean | undefined> = {}): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue;
    query.set(key, String(value));
  }
  query.set('resfmt', 'JSON');
  const text = query.toString();
  return text ? `?${text}` : '?resfmt=JSON';
}

function asRecord(value: unknown): ZohoCampaignsResponse {
  return value && typeof value === 'object' ? (value as ZohoCampaignsResponse) : {};
}

export class ZohoCampaignsClient {
  private readonly token: string;
  private readonly baseUrl: string;

  constructor(config: ZohoCampaignsConfig) {
    if (!config.token) {
      throw new Error('Zoho Campaigns OAuth token is required');
    }
    this.token = config.token;
    this.baseUrl = `${resolveBaseUrl(config)}/api/v1.1`;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  async request<T = ZohoCampaignsResponse>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', query = {}, body } = options;
    const url = `${this.baseUrl}${path}${buildQuery(query)}`;

    const headers: Record<string, string> = {
      Authorization: `Zoho-oauthtoken ${this.token}`,
      Accept: 'application/json',
    };

    let requestBody: string | undefined;
    if (body !== undefined) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      const encoded = new URLSearchParams();
      for (const [key, value] of Object.entries(body)) {
        if (value === undefined || value === null) continue;
        encoded.set(key, typeof value === 'string' ? value : JSON.stringify(value));
      }
      requestBody = encoded.toString();
    }

    const response = await fetch(url, { method, headers, body: requestBody });
    const text = await response.text();

    let data: unknown = {};
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { raw: text };
      }
    }

    const record = asRecord(data);

    if (!response.ok) {
      throw new ZohoCampaignsApiError(
        String(record.message ?? record.error_code ?? `request failed (${response.status})`),
        response.status,
        record.code,
      );
    }

    if (
      record.status === 'error' ||
      record.code === '1003' ||
      (typeof record.code === 'string' && record.code.startsWith('9'))
    ) {
      throw new ZohoCampaignsApiError(String(record.message ?? 'request failed'), response.status, record.code);
    }

    return data as T;
  }

  async get<T = ZohoCampaignsResponse>(
    path: string,
    query?: Record<string, string | number | boolean | undefined>,
  ): Promise<T> {
    return this.request<T>(path, { method: 'GET', query });
  }

  async post<T = ZohoCampaignsResponse>(
    path: string,
    options: {
      query?: Record<string, string | number | boolean | undefined>;
      body?: Record<string, unknown>;
    } = {},
  ): Promise<T> {
    return this.request<T>(path, { method: 'POST', query: options.query, body: options.body });
  }
}
