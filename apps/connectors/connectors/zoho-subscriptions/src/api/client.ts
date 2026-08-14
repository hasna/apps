import type { ZohoSubscriptionsConfig } from '../types';
import { ZohoSubscriptionsApiError } from '../types';

export const DC_BASES: Record<string, string> = {
  com: 'https://www.zohoapis.com',
  eu: 'https://www.zohoapis.eu',
  in: 'https://www.zohoapis.in',
  'com.au': 'https://www.zohoapis.com.au',
  jp: 'https://www.zohoapis.jp',
  ca: 'https://www.zohoapis.ca',
  sa: 'https://www.zohoapis.sa',
  uk: 'https://www.zohoapis.uk',
};

export function resolveBaseUrl(config: Pick<ZohoSubscriptionsConfig, 'dataCenter' | 'baseUrl'>): string {
  if (config.baseUrl) return config.baseUrl.replace(/\/$/, '');
  const dc = (config.dataCenter ?? 'com').toLowerCase();
  const host = DC_BASES[dc];
  if (!host) {
    throw new Error(`Zoho Subscriptions data_center must be one of: ${Object.keys(DC_BASES).join(', ')}`);
  }
  return `${host}/billing/v1`;
}

type QueryValue = string | number | boolean | undefined;

export class ZohoSubscriptionsClient {
  private readonly token: string;
  private readonly organizationId: string;
  private readonly baseUrl: string;

  constructor(config: ZohoSubscriptionsConfig) {
    if (!config.token || !config.organizationId) {
      throw new Error('Zoho Subscriptions token and organizationId are required');
    }
    this.token = config.token;
    this.organizationId = config.organizationId;
    this.baseUrl = resolveBaseUrl(config);
  }

  async request<T>(
    path: string,
    options: {
      method?: string;
      body?: Record<string, unknown>;
      params?: Record<string, QueryValue>;
    } = {},
  ): Promise<T> {
    const { method = 'GET', body, params } = options;
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
      }
    }

    const headers: Record<string, string> = {
      Authorization: `Zoho-oauthtoken ${this.token}`,
      Accept: 'application/json',
      'X-com-zoho-subscriptions-organizationid': this.organizationId,
    };

    const fetchOptions: RequestInit = { method, headers };
    if (body !== undefined && ['POST', 'PUT', 'PATCH'].includes(method)) {
      headers['Content-Type'] = 'application/json';
      fetchOptions.body = JSON.stringify(body);
    }

    const response = await fetch(url.toString(), fetchOptions);
    const text = await response.text();
    const data = (text
      ? (() => {
          try {
            return JSON.parse(text) as { code?: number; message?: string; [key: string]: unknown };
          } catch {
            return { raw: text };
          }
        })()
      : {}) as { code?: number; message?: string; [key: string]: unknown };

    if (!response.ok || (typeof data.code === 'number' && data.code !== 0)) {
      throw new ZohoSubscriptionsApiError(
        data.message || response.statusText || 'Request failed',
        response.status,
        typeof data.code === 'number' ? data.code : undefined,
      );
    }

    return data as T;
  }
}
