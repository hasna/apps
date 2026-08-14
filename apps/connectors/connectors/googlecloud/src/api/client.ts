import type { GoogleCloudConfig, OutputFormat } from '../types';
import { GoogleCloudApiError } from '../types';

// Google Cloud Resource Manager API base URL
const DEFAULT_BASE_URL = 'https://cloudresourcemanager.googleapis.com/v1';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | unknown[] | string;
  headers?: Record<string, string>;
  format?: OutputFormat;
}

export class GoogleCloudClient {
  private readonly apiKey?: string;
  private readonly credentialsPath?: string;
  private readonly baseUrl: string;
  private accessToken?: string;
  private tokenExpiry?: number;

  constructor(config: GoogleCloudConfig) {
    if (!config.apiKey && !config.credentialsPath) {
      throw new Error('Either API key or credentials path is required');
    }
    this.apiKey = config.apiKey;
    this.credentialsPath = config.credentialsPath;
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
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

    // If using API key authentication, append it to URL
    if (this.apiKey) {
      url.searchParams.append('key', this.apiKey);
    }

    return url.toString();
  }

  /**
   * Get OAuth2 access token from service account credentials
   */
  private async getAccessToken(): Promise<string> {
    if (this.accessToken && this.tokenExpiry && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

    if (!this.credentialsPath) {
      throw new Error('No credentials path configured');
    }

    // Read and parse the service account key file
    const { readFileSync } = await import('fs');
    const credentials = JSON.parse(readFileSync(this.credentialsPath, 'utf-8'));

    // Create JWT for token exchange
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'RS256', typ: 'JWT' };
    const claim = {
      iss: credentials.client_email,
      scope: 'https://www.googleapis.com/auth/cloud-platform',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    };

    // Encode header and claim
    const base64Header = Buffer.from(JSON.stringify(header)).toString('base64url');
    const base64Claim = Buffer.from(JSON.stringify(claim)).toString('base64url');
    const signatureInput = `${base64Header}.${base64Claim}`;

    // Sign with the private key
    const { createSign } = await import('crypto');
    const sign = createSign('RSA-SHA256');
    sign.update(signatureInput);
    const signature = sign.sign(credentials.private_key, 'base64url');

    const jwt = `${signatureInput}.${signature}`;

    // Exchange JWT for access token
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
    });

    if (!tokenResponse.ok) {
      const error = await tokenResponse.text();
      throw new Error(`Failed to get access token: ${error}`);
    }

    const tokenData = await tokenResponse.json() as { access_token: string; expires_in: number };
    this.accessToken = tokenData.access_token;
    this.tokenExpiry = Date.now() + (tokenData.expires_in - 60) * 1000; // Refresh 60s early

    return this.accessToken;
  }

  /**
   * Make an authenticated request to the Google Cloud API
   */
  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body, headers = {} } = options;

    const url = this.buildUrl(path, params);

    const requestHeaders: Record<string, string> = {
      'Accept': 'application/json',
      ...headers,
    };

    // Use Bearer token if credentials path is configured (service account auth)
    if (this.credentialsPath) {
      const token = await this.getAccessToken();
      requestHeaders['Authorization'] = `Bearer ${token}`;
    }

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

    const response = await fetch(url, fetchOptions);

    // Handle 204 No Content
    if (response.status === 204) {
      return {} as T;
    }

    // Parse response
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

    // Handle errors
    if (!response.ok) {
      const errorMessage = typeof data === 'object' && data !== null
        ? JSON.stringify(data)
        : String(data || response.statusText);
      throw new GoogleCloudApiError(errorMessage, response.status);
    }

    return data as T;
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

  /**
   * Get a preview of the API key (for display/debugging)
   */
  getApiKeyPreview(): string {
    if (this.apiKey && this.apiKey.length > 10) {
      return `${this.apiKey.substring(0, 6)}...${this.apiKey.substring(this.apiKey.length - 4)}`;
    }
    if (this.credentialsPath) {
      return `[Service Account: ${this.credentialsPath}]`;
    }
    return '***';
  }
}
