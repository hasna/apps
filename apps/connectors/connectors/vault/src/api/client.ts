import type { VaultConfig, VaultHttpMethod, VaultRequestOptions } from '../types';
import { VaultApiError } from '../types';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function buildQuery(params: Record<string, string | number | boolean | undefined | string[]>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) query.append(key, String(item));
    } else if (value !== '') {
      query.set(key, String(value));
    }
  }
  const serialized = query.toString();
  return serialized ? `?${serialized}` : '';
}

export class VaultClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly namespace?: string;

  constructor(config: VaultConfig) {
    const baseUrl = config.baseUrl?.trim();
    const token = config.token?.trim();
    if (!baseUrl) throw new Error('Vault baseUrl is required');
    if (!token) throw new Error('Vault token is required');
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.token = token;
    this.namespace = config.namespace?.trim() || undefined;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  async request<T>(
    method: VaultHttpMethod,
    path: string,
    options: VaultRequestOptions = {},
  ): Promise<T> {
    const namespace = options.namespace ?? this.namespace;
    const query = options.query ?? {};
    let url = `${this.baseUrl}${path}${buildQuery(query)}`;
    const httpMethod = method === 'LIST' ? 'GET' : method;
    if (method === 'LIST') {
      url += url.includes('?') ? '&list=true' : '?list=true';
    }

    const headers: Record<string, string> = {
      'X-Vault-Token': this.token,
      Accept: 'application/json',
    };
    if (namespace) headers['X-Vault-Namespace'] = namespace;
    if (options.wrapTtl) headers['X-Vault-Wrap-TTL'] = options.wrapTtl;
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';

    const response = await fetch(url, {
      method: httpMethod,
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

    if (!response.ok && !options.okStatuses?.includes(response.status)) {
      const record = asRecord(data);
      const errors = Array.isArray(record.errors) ? record.errors : null;
      const message =
        (typeof errors?.[0] === 'string' ? errors[0] : undefined) ??
        (typeof record.message === 'string' ? record.message : undefined) ??
        `request failed (${response.status})`;
      throw new VaultApiError(`Vault: ${message}`, response.status);
    }

    return data as T;
  }
}
