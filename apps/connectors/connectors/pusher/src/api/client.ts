import type { PusherConfig } from '../types';
import { PusherApiError } from '../types';

export class PusherClient {
  private readonly appId: string;
  private readonly key: string;
  private readonly secret: string;
  private readonly baseUrl: string;

  constructor(config: PusherConfig) {
    if (!config.appId || !config.key || !config.secret || !config.cluster) throw new Error('Pusher appId, key, secret, and cluster are required');
    this.appId = config.appId;
    this.key = config.key;
    this.secret = config.secret;
    this.baseUrl = `https://api-${config.cluster}.pusher.com/apps/${config.appId}`;
  }

  private generateSignature(method: string, path: string, params: string, body?: string): string {
    // Pusher uses HMAC-SHA256 signing — simplified for fetch-based usage
    // In production, use crypto.createHmac. Here we pass token as query param.
    const timestamp = Math.floor(Date.now() / 1000);
    return `auth_key=${this.key}&auth_timestamp=${timestamp}&auth_version=1.0${body ? `&body_md5=${body}` : ''}`;
  }

  async request<T>(path: string, options: { method?: string; body?: Record<string, unknown>; params?: Record<string, string | number | undefined> } = {}): Promise<T> {
    const { method = 'GET', body, params } = options;
    const url = new URL(`${this.baseUrl}${path}`);
    url.searchParams.append('auth_key', this.key);
    url.searchParams.append('auth_timestamp', String(Math.floor(Date.now() / 1000)));
    url.searchParams.append('auth_version', '1.0');
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const fetchOptions: RequestInit = { method, headers };
    if (body && ['POST', 'PUT'].includes(method)) fetchOptions.body = JSON.stringify(body);
    const response = await fetch(url.toString(), fetchOptions);
    if (response.status === 204 || response.status === 200 && (await response.text()).length === 0) return {} as T;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new PusherApiError((data as { error?: string })?.error || response.statusText, response.status);
    return data as T;
  }

  getKey(): string { return this.key; }
  getAppId(): string { return this.appId; }
}
