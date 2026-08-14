import type { TokenResponse, AmadeusError } from '../types';
import { AmadeusApiError } from '../types';

const BASE_URLS = {
  test: 'https://test.api.amadeus.com',
  production: 'https://api.amadeus.com',
};

export interface AmadeusClientConfig {
  apiKey: string;
  apiSecret: string;
  environment?: 'test' | 'production';
}

export class AmadeusClient {
  private apiKey: string;
  private apiSecret: string;
  private baseUrl: string;
  private accessToken: string | null = null;
  private tokenExpiry: number = 0;

  constructor(config: AmadeusClientConfig) {
    this.apiKey = config.apiKey;
    this.apiSecret = config.apiSecret;
    this.baseUrl = BASE_URLS[config.environment || 'test'];
  }

  private async getAccessToken(): Promise<string> {
    // Return cached token if still valid (with 60s buffer)
    if (this.accessToken && Date.now() < this.tokenExpiry - 60000) {
      return this.accessToken;
    }

    const response = await fetch(this.baseUrl + '/v1/security/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: this.apiKey,
        client_secret: this.apiSecret,
      }).toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new AmadeusApiError('Authentication failed: ' + errorText, response.status);
    }

    const data: TokenResponse = await response.json();
    this.accessToken = data.access_token;
    this.tokenExpiry = Date.now() + (data.expires_in * 1000);
    return this.accessToken;
  }

  async get<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    const token = await this.getAccessToken();

    let url = this.baseUrl + path;
    if (params) {
      const searchParams = new URLSearchParams();
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          searchParams.append(key, String(value));
        }
      });
      const queryString = searchParams.toString();
      if (queryString) url += '?' + queryString;
    }

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Accept': 'application/json',
      },
    });

    return this.handleResponse<T>(response);
  }

  async post<T>(path: string, body: Record<string, unknown> | unknown[], params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    const token = await this.getAccessToken();

    let url = this.baseUrl + path;
    if (params) {
      const searchParams = new URLSearchParams();
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          searchParams.append(key, String(value));
        }
      });
      const queryString = searchParams.toString();
      if (queryString) url += '?' + queryString;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(body),
    });

    return this.handleResponse<T>(response);
  }

  private async handleResponse<T>(response: Response): Promise<T> {
    const text = await response.text();

    if (!response.ok) {
      let errors: AmadeusError[] = [];
      try {
        const errorData = JSON.parse(text);
        errors = errorData.errors || [];
      } catch { /* ignore parse errors */ }

      const message = errors.length > 0
        ? errors.map(e => e.detail || e.title).join('; ')
        : 'API request failed: ' + response.status;

      throw new AmadeusApiError(message, response.status, errors);
    }

    if (!text) return {} as T;
    return JSON.parse(text) as T;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }
}
