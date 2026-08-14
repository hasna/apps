import type { ZohoVaultApiResponse, ZohoVaultConfig } from '../types';
import { ZohoVaultApiError } from '../types';

export const DC_BASES: Record<string, string> = {
  com: 'https://vault.zoho.com',
  eu: 'https://vault.zoho.eu',
  in: 'https://vault.zoho.in',
  'com.au': 'https://vault.zoho.com.au',
  jp: 'https://vault.zoho.jp',
  ca: 'https://vault.zoho.ca',
  sa: 'https://vault.zoho.sa',
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

export function resolveBaseUrl(config: ZohoVaultConfig): string {
  if (config.baseUrl) return config.baseUrl.replace(/\/$/, '');
  const dc = (config.dataCenter || 'com').toLowerCase();
  const base = DC_BASES[dc];
  if (!base) {
    throw new ZohoVaultApiError(
      `Invalid data center "${dc}". Must be one of: ${Object.keys(DC_BASES).join(', ')}`,
      400,
    );
  }
  return `${base}/api/rest/json/v1`;
}

export class ZohoVaultClient {
  private readonly token: string;
  private readonly baseUrl: string;

  constructor(config: ZohoVaultConfig) {
    if (!config.token?.trim()) throw new ZohoVaultApiError('Zoho Vault token is required', 401);
    this.token = config.token.trim();
    this.baseUrl = resolveBaseUrl(config);
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
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      const encoded = new URLSearchParams();
      for (const [key, value] of Object.entries(body)) {
        if (value === undefined || value === null) continue;
        encoded.set(key, typeof value === 'string' ? value : JSON.stringify(value));
      }
      fetchOptions.body = encoded.toString();
    }

    const response = await fetch(url.toString(), fetchOptions);
    const text = await response.text();
    const data: ZohoVaultApiResponse = text
      ? (() => {
          try {
            return JSON.parse(text) as ZohoVaultApiResponse;
          } catch {
            return { raw: text };
          }
        })()
      : {};

    if (!response.ok) {
      const record = asRecord(data);
      const operation = asRecord(record.operation);
      const result = asRecord(operation.result);
      const message =
        (typeof result.message === 'string' ? result.message : undefined) ||
        (typeof record.message === 'string' ? record.message : undefined) ||
        response.statusText ||
        `request failed (${response.status})`;
      throw new ZohoVaultApiError(message, response.status);
    }

    const record = asRecord(data);
    const operation = asRecord(record.operation);
    const result = asRecord(operation.result);
    if (result.status && result.status !== 'Success') {
      throw new ZohoVaultApiError(
        (typeof result.message === 'string' ? result.message : undefined) || 'request failed',
        response.status,
      );
    }

    return data as T;
  }
}
