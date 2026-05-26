import type { AzureCosmosDBConfig } from '../types';
import { AzureCosmosDBApiError } from '../types';

export class AzureCosmosDBClient {
  private readonly key: string;
  private readonly baseUrl: string;

  constructor(config: AzureCosmosDBConfig) {
    if (!config.endpoint || !config.key) throw new Error('Azure Cosmos DB endpoint and key are required');
    this.key = config.key;
    this.baseUrl = config.endpoint.replace(/\/$/, '');
  }

  private async generateAuthToken(verb: string, resourceType: string, resourceLink: string, date: string): Promise<string> {
    // Cosmos DB requires HMAC-SHA256 signed auth tokens
    // Simplified: in production use crypto.subtle or node:crypto
    const encoder = new TextEncoder();
    const keyBytes = Uint8Array.from(atob(this.key), c => c.charCodeAt(0));
    const cryptoKey = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const payload = `${verb.toLowerCase()}\n${resourceType.toLowerCase()}\n${resourceLink}\n${date.toLowerCase()}\n\n`;
    const signature = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(payload));
    const sig = btoa(String.fromCharCode(...new Uint8Array(signature)));
    return encodeURIComponent(`type=master&ver=1.0&sig=${sig}`);
  }

  async request<T>(path: string, options: { method?: string; body?: Record<string, unknown>; resourceType?: string; resourceLink?: string; params?: Record<string, string | undefined> } = {}): Promise<T> {
    const { method = 'GET', body, resourceType = '', resourceLink = '', params } = options;
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, v); });
    const date = new Date().toUTCString();
    const auth = await this.generateAuthToken(method, resourceType, resourceLink, date);
    const headers: Record<string, string> = { Authorization: auth, 'x-ms-date': date, 'x-ms-version': '2018-12-31', 'Content-Type': 'application/json' };
    const fetchOptions: RequestInit = { method, headers };
    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) fetchOptions.body = JSON.stringify(body);
    const response = await fetch(url.toString(), fetchOptions);
    if (response.status === 204) return {} as T;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new AzureCosmosDBApiError((data as { message?: string })?.message || response.statusText, response.status);
    return data as T;
  }
}
