import type { ZohoProjectsConfig } from '../types';
import { ZohoProjectsApiError } from '../types';

export const DC_BASES: Record<string, string> = {
  com: 'https://projectsapi.zoho.com',
  eu: 'https://projectsapi.zoho.eu',
  in: 'https://projectsapi.zoho.in',
  'com.au': 'https://projectsapi.zoho.com.au',
  jp: 'https://projectsapi.zoho.jp',
  ca: 'https://projectsapi.zoho.ca',
  sa: 'https://projectsapi.zoho.sa',
};

type QueryValue = string | number | boolean | undefined;

export interface ZohoProjectsRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  params?: Record<string, QueryValue>;
  body?: unknown;
}

export function resolveBaseUrl(config: ZohoProjectsConfig): string {
  if (config.baseUrl) {
    return config.baseUrl.replace(/\/$/, '');
  }
  const dc = (config.dataCenter || 'com').toLowerCase();
  const base = DC_BASES[dc];
  if (!base) {
    throw new ZohoProjectsApiError(
      `Invalid data center "${dc}". Must be one of: ${Object.keys(DC_BASES).join(', ')}`,
      0,
    );
  }
  return base;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function buildQuery(params?: Record<string, QueryValue>): string {
  if (!params) return '';
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue;
    query.set(key, String(value));
  }
  const text = query.toString();
  return text ? `?${text}` : '';
}

export class ZohoProjectsClient {
  private readonly token: string;
  private readonly baseUrl: string;
  private readonly portalId?: string;

  constructor(config: ZohoProjectsConfig) {
    if (!config.token) throw new Error('Zoho Projects token is required');
    this.token = config.token;
    this.portalId = config.portalId;
    this.baseUrl = resolveBaseUrl(config);
  }

  getPortalId(): string | undefined {
    return this.portalId;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  requirePortalId(portalId?: string): string {
    const id = portalId ?? this.portalId;
    if (!id?.trim()) {
      throw new Error('portalId is required');
    }
    return id.trim();
  }

  portalPath(portalId: string, suffix: string): string {
    return `/portal/${encodeURIComponent(portalId)}${suffix}`;
  }

  async request<T>(path: string, options: ZohoProjectsRequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body } = options;
    const url = `${this.baseUrl}/restapi${path}${buildQuery(params)}`;
    const headers: Record<string, string> = {
      Authorization: `Zoho-oauthtoken ${this.token}`,
      Accept: 'application/json',
    };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    const fetchOptions: RequestInit = { method, headers };
    if (body !== undefined) {
      fetchOptions.body = JSON.stringify(body);
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
      const errorObj = asRecord(record.error);
      const message =
        (typeof errorObj.message === 'string' && errorObj.message) ||
        (typeof record.message === 'string' && record.message) ||
        response.statusText ||
        `request failed (${response.status})`;
      throw new ZohoProjectsApiError(message, response.status);
    }

    return data as T;
  }
}
