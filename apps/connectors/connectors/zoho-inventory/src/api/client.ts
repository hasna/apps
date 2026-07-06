import type { ZohoInventoryConfig } from '../types';
import { ZohoInventoryApiError } from '../types';

export class ZohoInventoryClient {
  private readonly token: string;
  private readonly organizationId: string;
  private readonly baseUrl: string;

  constructor(config: ZohoInventoryConfig) {
    if (!config.token || !config.organizationId) {
      throw new Error('Zoho Inventory token and organizationId are required');
    }
    this.token = config.token;
    this.organizationId = config.organizationId;
    this.baseUrl = (config.baseUrl || 'https://www.zohoapis.com/inventory/v1').replace(/\/$/, '');
  }

  async request<T>(
    path: string,
    options: {
      method?: string;
      body?: Record<string, unknown>;
      params?: Record<string, string | number | undefined>;
    } = {},
  ): Promise<T> {
    const { method = 'GET', body, params } = options;
    const url = new URL(`${this.baseUrl}${path}`);
    url.searchParams.append('organization_id', this.organizationId);
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined) url.searchParams.append(k, String(v));
      });
    }
    const headers: Record<string, string> = {
      Authorization: `Zoho-oauthtoken ${this.token}`,
      'Content-Type': 'application/json',
    };
    const fetchOptions: RequestInit = { method, headers };
    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
      fetchOptions.body = JSON.stringify(body);
    }
    const response = await fetch(url.toString(), fetchOptions);
    const data = (await response.json().catch(() => ({}))) as {
      code?: number;
      message?: string;
      [key: string]: unknown;
    };
    if (!response.ok || (data.code !== undefined && data.code !== 0)) {
      throw new ZohoInventoryApiError(data.message || response.statusText, response.status, data.code);
    }
    return data as T;
  }

  async rawRequest<T>(
    path: string,
    options: {
      method?: string;
      body?: Record<string, unknown>;
      params?: Record<string, string | number | undefined>;
    } = {},
  ): Promise<T> {
    return this.request<T>(path, options);
  }
}
