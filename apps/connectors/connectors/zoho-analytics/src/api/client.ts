import type { ZohoAnalyticsConfig, ZohoAnalyticsResponse } from '../types';
import { ZohoAnalyticsApiError } from '../types';

export const DC_BASES: Record<string, string> = {
  com: 'https://analyticsapi.zoho.com',
  eu: 'https://analyticsapi.zoho.eu',
  in: 'https://analyticsapi.zoho.in',
  'com.au': 'https://analyticsapi.zoho.com.au',
  jp: 'https://analyticsapi.zoho.jp',
  ca: 'https://analyticsapi.zoho.ca',
  sa: 'https://analyticsapi.zoho.sa',
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function buildQuery(params: Record<string, string | number | boolean | undefined>): string {
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === '') continue;
    query.set(k, String(v));
  }
  const text = query.toString();
  return text ? `?${text}` : '';
}

export class ZohoAnalyticsClient {
  private readonly token: string;
  private readonly orgId: string;
  private readonly baseUrl: string;

  constructor(config: ZohoAnalyticsConfig) {
    if (!config.token?.trim()) throw new Error('Zoho Analytics access token not configured.');
    if (!config.orgId?.trim()) throw new Error('Zoho Analytics org_id not configured.');
    this.token = config.token.trim();
    this.orgId = config.orgId.trim();
    if (config.baseUrl) {
      this.baseUrl = config.baseUrl.replace(/\/$/, '');
    } else {
      const dc = (config.dataCenter ?? 'com').toLowerCase();
      const base = DC_BASES[dc];
      if (!base) {
        throw new Error(`Zoho Analytics data_center must be one of: ${Object.keys(DC_BASES).join(', ')}`);
      }
      this.baseUrl = base;
    }
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  getOrgId(): string {
    return this.orgId;
  }

  async request<T = ZohoAnalyticsResponse>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    options: {
      body?: unknown;
      query?: Record<string, string | number | boolean | undefined>;
      configParam?: Record<string, unknown>;
    } = {},
  ): Promise<T> {
    const query: Record<string, string | number | boolean | undefined> = { ...(options.query ?? {}) };
    if (options.configParam !== undefined) {
      query.CONFIG = JSON.stringify(options.configParam);
    }
    const url = `${this.baseUrl}/restapi/v2${path}${buildQuery(query)}`;
    const headers: Record<string, string> = {
      Authorization: `Zoho-oauthtoken ${this.token}`,
      Accept: 'application/json',
      'ZANALYTICS-ORGID': this.orgId,
    };
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    const response = await fetch(url, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
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
      throw new ZohoAnalyticsApiError(
        `Zoho Analytics: ${String(record.summary ?? record.message ?? `request failed (${response.status})`)}`,
        response.status,
      );
    }
    const record = asRecord(data);
    if (record.status === 'failure') {
      throw new ZohoAnalyticsApiError(
        `Zoho Analytics: ${String(record.summary ?? record.message ?? 'request failed')}`,
        response.status,
      );
    }
    return data as T;
  }
}
