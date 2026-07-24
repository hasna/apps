import type { TeleportConfig } from '../types';
import { TeleportApiError } from '../types';

export type QueryValue = string | number | boolean | undefined | string[];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function buildQuery(params: Record<string, QueryValue>): string {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      for (const item of value) q.append(key, String(item));
    } else {
      q.set(key, String(value));
    }
  }
  const query = q.toString();
  return query ? `?${query}` : '';
}

export class TeleportClient {
  private readonly token: string;
  private readonly baseUrl: string;

  constructor(config: TeleportConfig) {
    if (!config.baseUrl?.trim()) throw new Error('Teleport baseUrl is required');
    if (!config.token?.trim()) throw new Error('Teleport token is required');
    this.token = config.token.trim();
    this.baseUrl = config.baseUrl.trim().replace(/\/$/, '');
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  async request<T>(
    path: string,
    options: {
      method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
      query?: Record<string, QueryValue>;
      body?: unknown;
    } = {},
  ): Promise<T> {
    const { method = 'GET', query, body } = options;
    const url = `${this.baseUrl}${path}${buildQuery(query ?? {})}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/json',
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    const response = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
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
      const message =
        (typeof record.message === 'string' && record.message) ||
        (typeof record.error === 'string' && record.error) ||
        (typeof record.raw === 'string' && record.raw) ||
        `request failed (${response.status})`;
      throw new TeleportApiError(`Teleport: ${message}`, response.status);
    }

    return data as T;
  }
}
