import type { MailgunConfig } from '../types';
import { MailgunApiError } from '../types';

export class MailgunClient {
  private readonly authHeader: string;
  private readonly baseUrl: string;
  private readonly domain: string;

  constructor(config: MailgunConfig) {
    if (!config.apiKey || !config.domain) throw new Error('Mailgun apiKey and domain are required');
    this.authHeader = `Basic ${btoa(`api:${config.apiKey}`)}`;
    this.domain = config.domain;
    this.baseUrl = config.region === 'eu' ? 'https://api.eu.mailgun.net/v3' : 'https://api.mailgun.net/v3';
  }

  async request<T>(path: string, options: { method?: string; body?: Record<string, unknown> | FormData; params?: Record<string, string | number | undefined>; form?: boolean } = {}): Promise<T> {
    const { method = 'GET', body, params, form } = options;
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    const headers: Record<string, string> = { Authorization: this.authHeader };
    if (!form) headers['Content-Type'] = 'application/json';
    const fetchOptions: RequestInit = { method, headers };
    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
      if (form && !(body instanceof FormData)) {
        const fd = new URLSearchParams();
        Object.entries(body).forEach(([k, v]) => { if (v !== undefined) fd.append(k, String(v)); });
        fetchOptions.body = fd;
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
      } else {
        fetchOptions.body = JSON.stringify(body);
      }
    }
    const response = await fetch(url.toString(), fetchOptions);
    if (response.status === 204) return {} as T;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new MailgunApiError((data as { message?: string })?.message || response.statusText, response.status);
    return data as T;
  }

  getDomain(): string { return this.domain; }
}
