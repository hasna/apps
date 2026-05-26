import type { ConnectorConfig, TokenResponse } from '../types';
import { ConnectorApiError, parseApiError } from '../types';

const BASE_URLS: Record<string, string> = {
  us: 'https://pdf-services.adobe.io',
  eu: 'https://pdf-services-eu.adobe.io',
};

const TOKEN_URL = 'https://ims-na1.adobelogin.com/ims/token/v3';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | unknown[] | string;
  headers?: Record<string, string>;
  /** Number of retries for failed requests (default: 3) */
  retries?: number;
  /** Timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** If true, return raw Response instead of parsed JSON */
  rawResponse?: boolean;
}

export class ConnectorClient {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly baseUrl: string;
  private accessToken: string | undefined;
  private tokenExpiresAt: number = 0;

  constructor(config: ConnectorConfig) {
    const clientId = config.apiKey || config.token;
    if (!clientId) {
      throw new Error('API key (client_id) is required');
    }
    this.clientId = clientId;
    this.clientSecret = config.apiSecret || '';
    this.accessToken = config.accessToken;
    if (this.accessToken) {
      // If an access token is provided, assume it's valid for 23 hours
      this.tokenExpiresAt = Date.now() + 23 * 60 * 60 * 1000;
    }
    const region = config.region || 'us';
    this.baseUrl = config.baseUrl || BASE_URLS[region] || BASE_URLS.us;
  }

  /**
   * Get a valid access token, refreshing via client credentials if expired
   */
  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt) {
      return this.accessToken;
    }

    if (!this.clientSecret) {
      throw new Error('API secret (client_secret) is required for OAuth2 token exchange');
    }

    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.clientId,
      client_secret: this.clientSecret,
      scope: 'openid,AdobeID,DCAPI',
    });

    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!response.ok) {
      const data = await response.text();
      throw new ConnectorApiError(
        `Token exchange failed: ${data}`,
        response.status
      );
    }

    const token = (await response.json()) as TokenResponse;
    this.accessToken = token.access_token;
    // Expire 5 minutes early to avoid edge cases
    this.tokenExpiresAt = Date.now() + (token.expires_in - 300) * 1000;
    return this.accessToken;
  }

  private buildUrl(path: string, params?: Record<string, string | number | boolean | undefined>): string {
    const url = new URL(`${this.baseUrl}${path}`);

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.append(key, String(value));
        }
      });
    }

    return url.toString();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private getRetryDelay(attempt: number, baseDelay: number = 1000): number {
    return baseDelay * Math.pow(2, attempt) + Math.random() * 1000;
  }

  private isRetryableStatus(status: number): boolean {
    return status === 429 || (status >= 500 && status < 600);
  }

  /**
   * Make an authenticated request to Adobe PDF Services API
   * Includes both Authorization: Bearer and x-api-key headers
   */
  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body, headers = {}, retries = 3, timeout = 30000, rawResponse = false } = options;

    const url = this.buildUrl(path, params);
    const token = await this.getAccessToken();

    const requestHeaders: Record<string, string> = {
      'Authorization': `Bearer ${token}`,
      'x-api-key': this.clientId,
      'Accept': 'application/json',
      ...headers,
    };

    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
      requestHeaders['Content-Type'] = 'application/json';
    }

    const fetchOptions: RequestInit = {
      method,
      headers: requestHeaders,
    };

    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
      fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
    }

    let lastError: Error | null = null;
    let lastStatus: number = 0;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        const response = await fetch(url, {
          ...fetchOptions,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);
        lastStatus = response.status;

        if (rawResponse) {
          return response as unknown as T;
        }

        if (response.status === 204) {
          return {} as T;
        }

        // For 201 with Location header (job creation), return location
        if (response.status === 201) {
          const location = response.headers.get('location');
          if (location) {
            return { location } as T;
          }
        }

        let data: unknown;
        const contentType = response.headers.get('content-type') || '';

        if (contentType.includes('application/json')) {
          const text = await response.text();
          if (text) {
            try {
              data = JSON.parse(text);
            } catch {
              data = text;
            }
          }
        } else {
          data = await response.text();
        }

        if (!response.ok) {
          if (this.isRetryableStatus(response.status) && attempt < retries) {
            const retryAfter = response.headers.get('retry-after');
            const delay = retryAfter
              ? parseInt(retryAfter, 10) * 1000
              : this.getRetryDelay(attempt);
            await this.sleep(delay);
            continue;
          }
          throw parseApiError(data, response.status);
        }

        return (data || {}) as T;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        if (lastError.name === 'AbortError') {
          lastError = new Error(`Request timeout after ${timeout}ms`);
        }

        if (attempt < retries && !(err instanceof ConnectorApiError)) {
          await this.sleep(this.getRetryDelay(attempt));
          continue;
        }

        throw err;
      }
    }

    throw lastError || new ConnectorApiError('Request failed', lastStatus);
  }

  /**
   * Upload a file to a presigned URI (no auth headers needed)
   */
  async uploadToUri(uploadUri: string, fileData: Buffer | Uint8Array, contentType: string): Promise<void> {
    const response = await fetch(uploadUri, {
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      body: new Uint8Array(fileData),
    });

    if (!response.ok) {
      throw new ConnectorApiError(`Upload failed: ${response.statusText}`, response.status);
    }
  }

  /**
   * Download a file from a URI
   */
  async downloadFromUri(downloadUri: string): Promise<Buffer> {
    const response = await fetch(downloadUri);
    if (!response.ok) {
      throw new ConnectorApiError(`Download failed: ${response.statusText}`, response.status);
    }
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  async get<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'GET', params });
  }

  async post<T>(path: string, body?: Record<string, unknown> | unknown[] | string | object, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'POST', body: body as Record<string, unknown>, params });
  }

  async put<T>(path: string, body?: Record<string, unknown> | object, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'PUT', body: body as Record<string, unknown>, params });
  }

  async patch<T>(path: string, body?: Record<string, unknown> | object, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'PATCH', body: body as Record<string, unknown>, params });
  }

  async delete<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'DELETE', params });
  }

  getApiKeyPreview(): string {
    if (this.clientId.length > 10) {
      return `${this.clientId.substring(0, 6)}...${this.clientId.substring(this.clientId.length - 4)}`;
    }
    return '***';
  }
}
