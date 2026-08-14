import type { ZohoRecruitConfig, ZohoRecruitDataCenter } from '../types';
import { ZohoRecruitApiError } from '../types';

export const RECRUIT_DC_BASES: Record<ZohoRecruitDataCenter, string> = {
  com: 'https://recruit.zoho.com',
  eu: 'https://recruit.zoho.eu',
  in: 'https://recruit.zoho.in',
  'com.au': 'https://recruit.zoho.com.au',
  jp: 'https://recruit.zoho.jp',
  ca: 'https://recruit.zoho.ca',
  sa: 'https://recruit.zoho.sa',
};

export function resolveRecruitBaseUrl(config: Pick<ZohoRecruitConfig, 'dataCenter' | 'baseUrl'>): string {
  if (config.baseUrl) {
    return config.baseUrl.replace(/\/$/, '');
  }
  const dc = (config.dataCenter || 'com').toLowerCase() as ZohoRecruitDataCenter;
  const host = RECRUIT_DC_BASES[dc];
  if (!host) {
    throw new Error(`Zoho Recruit data_center must be one of: ${Object.keys(RECRUIT_DC_BASES).join(', ')}`);
  }
  return `${host}/recruit/v2`;
}

export class ZohoRecruitClient {
  private readonly token: string;
  private readonly baseUrl: string;

  constructor(config: ZohoRecruitConfig) {
    if (!config.token) throw new Error('Zoho Recruit token is required');
    this.token = config.token;
    this.baseUrl = resolveRecruitBaseUrl(config);
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
        if (value !== undefined && value !== '') {
          url.searchParams.append(key, String(value));
        }
      }
    }

    const headers: Record<string, string> = {
      Authorization: `Zoho-oauthtoken ${this.token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };

    const fetchOptions: RequestInit = { method, headers };
    if (body && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      fetchOptions.body = JSON.stringify(body);
    }

    const response = await fetch(url.toString(), fetchOptions);
    if (response.status === 204) return {} as T;

    const text = await response.text();
    const data = text
      ? (() => {
          try {
            return JSON.parse(text) as Record<string, unknown>;
          } catch {
            return { raw: text };
          }
        })()
      : {};

    if (!response.ok) {
      const record = data as { message?: string; code?: string };
      throw new ZohoRecruitApiError(
        record.message || record.code || response.statusText,
        response.status,
        record.code,
      );
    }

    return data as T;
  }
}
