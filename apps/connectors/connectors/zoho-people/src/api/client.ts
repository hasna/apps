import type { ZohoPeopleConfig, ZohoPeopleResponse } from '../types';
import { ZohoPeopleApiError } from '../types';

export const DATA_CENTER_BASES: Record<string, string> = {
  com: 'https://people.zoho.com',
  eu: 'https://people.zoho.eu',
  in: 'https://people.zoho.in',
  'com.au': 'https://people.zoho.com.au',
  jp: 'https://people.zoho.jp',
  ca: 'https://people.zoho.ca',
  sa: 'https://people.zoho.sa',
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

export function resolveBaseUrl(config: Pick<ZohoPeopleConfig, 'dataCenter' | 'baseUrl'>): string {
  if (config.baseUrl) return config.baseUrl.replace(/\/$/, '');
  const dc = (config.dataCenter ?? 'com').toLowerCase();
  const base = DATA_CENTER_BASES[dc];
  if (!base) {
    throw new ZohoPeopleApiError(
      `Zoho People data_center must be one of: ${Object.keys(DATA_CENTER_BASES).join(', ')}`,
      0,
    );
  }
  return base;
}

export class ZohoPeopleClient {
  private readonly token: string;
  private readonly baseUrl: string;

  constructor(config: ZohoPeopleConfig) {
    if (!config.token?.trim()) throw new ZohoPeopleApiError('Zoho People token is required', 0);
    this.token = config.token.trim();
    this.baseUrl = resolveBaseUrl(config);
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  async request<T = ZohoPeopleResponse>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    options: {
      query?: Record<string, string | number | boolean | undefined>;
      body?: Record<string, unknown>;
    } = {},
  ): Promise<T> {
    const url = `${this.baseUrl}/people/api${path}${buildQuery(options.query ?? {})}`;
    const headers: Record<string, string> = {
      Authorization: `Zoho-oauthtoken ${this.token}`,
      Accept: 'application/json',
    };

    let body: string | undefined;
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      const encoded = new URLSearchParams();
      for (const [k, v] of Object.entries(options.body)) {
        if (v === undefined || v === null) continue;
        encoded.set(k, typeof v === 'string' ? v : JSON.stringify(v));
      }
      body = encoded.toString();
    }

    const response = await fetch(url, { method, headers, body });
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
      const envelope = asRecord(record.response);
      throw new ZohoPeopleApiError(
        String(envelope.message ?? record.message ?? envelope.errorMessage ?? `request failed (${response.status})`),
        response.status,
      );
    }

    const record = asRecord(data);
    const envelope = asRecord(record.response);
    if (envelope.status === 1 || envelope.status === '1' || record.errorCode) {
      throw new ZohoPeopleApiError(
        String(envelope.message ?? record.errorMessage ?? 'request failed'),
        response.status,
      );
    }

    return data as T;
  }
}
