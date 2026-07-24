import type { TokenResponse, VantaConfig } from '../types';
import { VantaApiError } from '../types';

export const DEFAULT_BASE_URL = 'https://api.vanta.com/v1';
const TOKEN_BUFFER_MS = 60_000;

export interface VantaClientConfig extends VantaConfig {}

export class VantaClient {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly scope: string;
  private readonly baseUrl: string;
  private readonly tokenUrl: string;
  private accessToken: string | null = null;
  private tokenExpiry = 0;

  constructor(config: VantaClientConfig) {
    if (!config.clientId || !config.clientSecret) {
      throw new Error('clientId and clientSecret are required');
    }
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.scope = config.scope || 'vanta-api.all:read';
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
    this.tokenUrl = this.baseUrl.replace(/\/v1$/, '') + '/oauth/token';
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiry - TOKEN_BUFFER_MS) {
      return this.accessToken;
    }

    const response = await fetch(this.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        scope: this.scope,
        grant_type: 'client_credentials',
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new VantaApiError('Authentication failed: ' + errorText, response.status);
    }

    const data = (await response.json()) as TokenResponse;
    this.accessToken = data.access_token;
    this.tokenExpiry = Date.now() + data.expires_in * 1000;
    return this.accessToken;
  }

  private buildUrl(
    path: string,
    params?: Record<string, string | number | boolean | string[] | undefined>,
  ): string {
    const normalizedPath = path.startsWith('/') ? path : '/' + path;
    const url = new URL(this.baseUrl + normalizedPath);

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null || value === '') continue;
        if (Array.isArray(value)) {
          for (const item of value) {
            url.searchParams.append(key, String(item));
          }
        } else {
          url.searchParams.append(key, String(value));
        }
      }
    }

    return url.toString();
  }

  private async handleResponse<T>(response: Response): Promise<T> {
    const text = await response.text();

    if (!response.ok) {
      throw new VantaApiError(text || 'API request failed: ' + response.status, response.status);
    }

    if (!text) return {} as T;
    return JSON.parse(text) as T;
  }

  async request<T>(
    path: string,
    options: {
      method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
      params?: Record<string, string | number | boolean | string[] | undefined>;
      body?: Record<string, unknown> | unknown[];
    } = {},
  ): Promise<T> {
    const { method = 'GET', params, body } = options;
    const token = await this.getAccessToken();
    const url = this.buildUrl(path, params);

    const headers: Record<string, string> = {
      Authorization: 'Bearer ' + token,
      Accept: 'application/json',
    };

    const fetchOptions: RequestInit = { method, headers };

    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
      headers['Content-Type'] = 'application/json';
      fetchOptions.body = JSON.stringify(body);
    }

    const response = await fetch(url, fetchOptions);
    return this.handleResponse<T>(response);
  }

  async get<T>(
    path: string,
    params?: Record<string, string | number | boolean | string[] | undefined>,
  ): Promise<T> {
    return this.request<T>(path, { method: 'GET', params });
  }

  async post<T>(
    path: string,
    body?: Record<string, unknown> | unknown[],
    params?: Record<string, string | number | boolean | string[] | undefined>,
  ): Promise<T> {
    return this.request<T>(path, { method: 'POST', body, params });
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  getTokenUrl(): string {
    return this.tokenUrl;
  }
}
