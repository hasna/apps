import type { ZohoCreatorConfig, ZohoCreatorApiResponse } from '../types';
import { ZohoCreatorApiError } from '../types';

export const DC_BASES: Record<string, string> = {
  com: 'https://creator.zoho.com',
  eu: 'https://creator.zoho.eu',
  in: 'https://creator.zoho.in',
  'com.au': 'https://creator.zoho.com.au',
  jp: 'https://creator.zoho.jp',
  ca: 'https://creator.zoho.ca',
  sa: 'https://creator.zoho.sa',
};

export const VALID_DATA_CENTERS = Object.keys(DC_BASES);

const ENV_SEGMENTS = {
  production: '',
  stage: '/stage',
  stage_v2: '/stage',
} as const;

export const VALID_ENVIRONMENTS = Object.keys(ENV_SEGMENTS);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

export class ZohoCreatorClient {
  private readonly accessToken: string;
  private readonly baseUrl: string;
  private readonly envSegment: string;

  constructor(config: ZohoCreatorConfig) {
    const token = config.accessToken?.trim();
    if (!token) throw new Error('Zoho Creator access token is required');
    const dc = (config.dataCenter || 'com').toLowerCase();
    const base = DC_BASES[dc];
    if (!base) {
      throw new Error(`Zoho Creator data_center must be one of: ${VALID_DATA_CENTERS.join(', ')}`);
    }
    const environment = (config.environment || 'production').toLowerCase();
    const envSegment = ENV_SEGMENTS[environment as keyof typeof ENV_SEGMENTS];
    if (envSegment === undefined) {
      throw new Error(`Zoho Creator environment must be one of: ${VALID_ENVIRONMENTS.join(', ')}`);
    }
    this.accessToken = token;
    this.baseUrl = base;
    this.envSegment = envSegment;
  }

  getApiPrefix(): string {
    return `/api/v2.1${this.envSegment}`;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  private buildQuery(params?: Record<string, string | number | boolean | undefined>): string {
    if (!params) return '';
    const query = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === '') continue;
      query.set(k, String(v));
    }
    const text = query.toString();
    return text ? `?${text}` : '';
  }

  async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    options: {
      body?: unknown;
      query?: Record<string, string | number | boolean | undefined>;
    } = {},
  ): Promise<T> {
    const url = `${this.baseUrl}${this.getApiPrefix()}${path}${this.buildQuery(options.query)}`;
    const headers: Record<string, string> = {
      Authorization: `Zoho-oauthtoken ${this.accessToken}`,
      Accept: 'application/json',
    };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';

    const fetchOptions: RequestInit = { method, headers };
    if (options.body !== undefined) {
      fetchOptions.body = JSON.stringify(options.body);
    }

    const response = await fetch(url, fetchOptions);
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
      throw new ZohoCreatorApiError(
        `Zoho Creator: ${String(record.message ?? record.description ?? `request failed (${response.status})`)}`,
        response.status,
      );
    }

    const record = asRecord(data);
    if (record.code && typeof record.code === 'number' && record.code !== 3000 && record.code >= 4000) {
      throw new ZohoCreatorApiError(
        `Zoho Creator: ${String(record.message ?? record.description ?? `code ${record.code}`)}`,
        response.status,
        record.code as number,
      );
    }

    return data as T;
  }

  async get<T>(path: string, query?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>('GET', path, { query });
  }

  async post<T>(path: string, body?: unknown, query?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>('POST', path, { body, query });
  }

  async patch<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PATCH', path, { body });
  }

  async delete<T>(path: string, query?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>('DELETE', path, { query });
  }
}

export function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Zoho Creator: ${label} is required`);
  }
  return value.trim();
}

export function appBase(accountOwner: string, appLinkName: string): string {
  return `/${encodeURIComponent(requireString(accountOwner, 'accountOwner'))}/${encodeURIComponent(requireString(appLinkName, 'appLinkName'))}`;
}
