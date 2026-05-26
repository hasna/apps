import type { ZoomConfig, ZoomTokenResponse } from '../types';
import { ZoomApiError } from '../types';
import {
  getAccessToken,
  setAccessToken,
  getTokenExpiry,
  setTokenExpiry,
} from '../utils/config';

const ZOOM_API_BASE = 'https://api.zoom.us/v2';
const ZOOM_OAUTH_URL = 'https://zoom.us/oauth/token';

export interface ZoomRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  params?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
}

/**
 * Zoom API Client with Server-to-Server OAuth
 */
export class ZoomClient {
  private readonly accountId: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private accessToken: string | undefined;
  private tokenExpiry: number | undefined;

  constructor(config: ZoomConfig) {
    if (!config.accountId) {
      throw new Error('Zoom Account ID is required');
    }
    if (!config.clientId) {
      throw new Error('Zoom Client ID is required');
    }
    if (!config.clientSecret) {
      throw new Error('Zoom Client Secret is required');
    }
    this.accountId = config.accountId;
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;

    // Load cached token
    this.accessToken = getAccessToken();
    this.tokenExpiry = getTokenExpiry();
  }

  /**
   * Get a valid access token, refreshing if necessary
   */
  private async getValidToken(): Promise<string> {
    // Check if we have a valid cached token (with 5 min buffer)
    if (this.accessToken && this.tokenExpiry && Date.now() < this.tokenExpiry - 300000) {
      return this.accessToken;
    }

    // Get new token using Server-to-Server OAuth
    const credentials = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');

    const response = await fetch(ZOOM_OAUTH_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: `grant_type=account_credentials&account_id=${encodeURIComponent(this.accountId)}`,
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = `OAuth Error: ${response.status} ${response.statusText}`;
      try {
        const errorJson = JSON.parse(errorText);
        errorMessage = errorJson.reason || errorJson.error_description || errorMessage;
      } catch {
        // Use default message
      }
      throw new ZoomApiError(errorMessage, response.status);
    }

    const tokenData = await response.json() as ZoomTokenResponse;
    this.accessToken = tokenData.access_token;
    this.tokenExpiry = Date.now() + tokenData.expires_in * 1000;

    // Cache the token
    setAccessToken(this.accessToken);
    setTokenExpiry(this.tokenExpiry);

    return this.accessToken;
  }

  /**
   * Make a request to the Zoom API
   */
  async request<T>(path: string, options: ZoomRequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body, headers = {} } = options;

    const token = await this.getValidToken();

    const url = new URL(`${ZOOM_API_BASE}${path}`);

    // Add query params
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.append(key, String(value));
        }
      });
    }

    const requestHeaders: Record<string, string> = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...headers,
    };

    const response = await fetch(url.toString(), {
      method,
      headers: requestHeaders,
      body: body ? JSON.stringify(body) : undefined,
    });

    // Handle no content responses
    if (response.status === 204) {
      return {} as T;
    }

    const contentType = response.headers.get('content-type') || '';
    let data: unknown;

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
      let errorMessage = `Zoom API Error: ${response.status} ${response.statusText}`;
      let errorCode: number | undefined;

      if (typeof data === 'object' && data !== null) {
        const errData = data as Record<string, unknown>;
        errorCode = errData.code as number;
        errorMessage = (errData.message || errorMessage) as string;
      }

      throw new ZoomApiError(errorMessage, response.status, errorCode);
    }

    return data as T;
  }

  /**
   * Get the account ID
   */
  getAccountId(): string {
    return this.accountId;
  }

  /**
   * Get a preview of the client ID (for display/debugging)
   */
  getClientIdPreview(): string {
    if (this.clientId.length > 8) {
      return `${this.clientId.substring(0, 4)}...${this.clientId.substring(this.clientId.length - 4)}`;
    }
    return '***';
  }
}
