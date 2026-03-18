import type { GhostConfig } from '../types';
import { GhostApiError } from '../types';

export class GhostClient {
  private readonly adminApiKey?: string;
  private readonly contentApiKey?: string;
  private readonly adminUrl: string;
  private readonly contentUrl: string;

  constructor(config: GhostConfig) {
    if (!config.url) throw new Error('Ghost url is required');
    if (!config.adminApiKey && !config.contentApiKey) throw new Error('Ghost adminApiKey or contentApiKey is required');
    this.adminApiKey = config.adminApiKey;
    this.contentApiKey = config.contentApiKey;
    const base = config.url.replace(/\/$/, '');
    this.adminUrl = `${base}/ghost/api/admin`;
    this.contentUrl = `${base}/ghost/api/content`;
  }

  async contentRequest<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
    if (!this.contentApiKey) throw new Error('Ghost contentApiKey required for content API');
    const url = new URL(`${this.contentUrl}${path}`);
    url.searchParams.append('key', this.contentApiKey);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    const response = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new GhostApiError((data as { errors?: { message?: string }[] })?.errors?.[0]?.message || response.statusText, response.status);
    return data as T;
  }

  async adminRequest<T>(path: string, options: { method?: string; body?: Record<string, unknown>; params?: Record<string, string | number | undefined> } = {}): Promise<T> {
    if (!this.adminApiKey) throw new Error('Ghost adminApiKey required for admin API');
    const { method = 'GET', body, params } = options;
    const url = new URL(`${this.adminUrl}${path}`);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    // Ghost Admin API uses key:secret JWT — simplified to key-based header
    const [id, secret] = this.adminApiKey.split(':');
    const headers: Record<string, string> = { Authorization: `Ghost ${this.adminApiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' };
    const fetchOptions: RequestInit = { method, headers };
    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) fetchOptions.body = JSON.stringify(body);
    const response = await fetch(url.toString(), fetchOptions);
    if (response.status === 204) return {} as T;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new GhostApiError((data as { errors?: { message?: string }[] })?.errors?.[0]?.message || response.statusText, response.status);
    return data as T;
  }
}
