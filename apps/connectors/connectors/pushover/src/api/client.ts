import type { PushoverConfig } from '../types';
import { PushoverApiError } from '../types';
const DEFAULT_BASE_URL = 'https://api.pushover.net/1';
export class PushoverClient {
  readonly token: string;
  readonly userKey: string;
  private readonly baseUrl: string;
  constructor(config: PushoverConfig) {
    if (!config.token || !config.userKey) throw new Error('Pushover token and userKey are required');
    this.token = config.token; this.userKey = config.userKey;
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  }
  async post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const form = new URLSearchParams();
    Object.entries({ ...body, token: this.token }).forEach(([k, v]) => { if (v !== undefined) form.append(k, String(v)); });
    const response = await fetch(`${this.baseUrl}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString() });
    const data = await response.json().catch(() => ({}));
    if ((data as { status?: number })?.status !== 1 && !response.ok) throw new PushoverApiError((data as { errors?: string[] })?.errors?.join(', ') || 'Pushover error', response.status);
    return data as T;
  }
  async get<T>(path: string, params?: Record<string, string>): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    url.searchParams.append('token', this.token);
    if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.append(k, v));
    const response = await fetch(url.toString());
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new PushoverApiError((data as { errors?: string[] })?.errors?.join(', ') || 'Pushover error', response.status);
    return data as T;
  }
}
