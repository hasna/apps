import type { MixpanelConfig } from '../types';
import { MixpanelApiError } from '../types';

// Mixpanel API Endpoints by region
const ENDPOINTS = {
  US: {
    track: 'https://api.mixpanel.com',
    engage: 'https://api.mixpanel.com',
    data: 'https://data.mixpanel.com',
    export: 'https://data.mixpanel.com',
    insights: 'https://mixpanel.com',
  },
  EU: {
    track: 'https://api-eu.mixpanel.com',
    engage: 'https://api-eu.mixpanel.com',
    data: 'https://data-eu.mixpanel.com',
    export: 'https://data-eu.mixpanel.com',
    insights: 'https://eu.mixpanel.com',
  },
  IN: {
    track: 'https://api-in.mixpanel.com',
    engage: 'https://api-in.mixpanel.com',
    data: 'https://data-in.mixpanel.com',
    export: 'https://data-in.mixpanel.com',
    insights: 'https://in.mixpanel.com',
  },
};

export interface MixpanelRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  params?: Record<string, string | number | boolean | undefined>;
  body?: string | Record<string, unknown> | unknown[];
  headers?: Record<string, string>;
  endpoint?: 'track' | 'engage' | 'data' | 'export' | 'insights';
  authType?: 'basic' | 'token' | 'service-account' | 'none';
}

/**
 * Mixpanel API Client
 * Handles authentication and requests to various Mixpanel APIs
 */
export class MixpanelClient {
  private readonly projectToken?: string;
  private readonly apiSecret?: string;
  private readonly serviceAccountUsername?: string;
  private readonly serviceAccountSecret?: string;
  private readonly projectId?: string;
  private readonly region: 'US' | 'EU' | 'IN';

  constructor(config: MixpanelConfig) {
    this.projectToken = config.projectToken;
    this.apiSecret = config.apiSecret;
    this.serviceAccountUsername = config.serviceAccountUsername;
    this.serviceAccountSecret = config.serviceAccountSecret;
    this.projectId = config.projectId;
    this.region = config.region || 'US';
  }

  /**
   * Get the base URL for an endpoint type
   */
  getBaseUrl(endpoint: 'track' | 'engage' | 'data' | 'export' | 'insights'): string {
    return ENDPOINTS[this.region][endpoint];
  }

  /**
   * Get project token (required for tracking)
   */
  getProjectToken(): string | undefined {
    return this.projectToken;
  }

  /**
   * Get project ID
   */
  getProjectId(): string | undefined {
    return this.projectId;
  }

  /**
   * Get region
   */
  getRegion(): 'US' | 'EU' | 'IN' {
    return this.region;
  }

  /**
   * Create Basic Auth header from API secret
   */
  private getBasicAuthHeader(): string {
    if (!this.apiSecret) {
      throw new Error('API secret is required for this operation');
    }
    const credentials = Buffer.from(`${this.apiSecret}:`).toString('base64');
    return `Basic ${credentials}`;
  }

  /**
   * Create Service Account Auth header
   */
  private getServiceAccountAuthHeader(): string {
    if (!this.serviceAccountUsername || !this.serviceAccountSecret) {
      throw new Error('Service account credentials are required for this operation');
    }
    const credentials = Buffer.from(`${this.serviceAccountUsername}:${this.serviceAccountSecret}`).toString('base64');
    return `Basic ${credentials}`;
  }

  /**
   * Make a request to the Mixpanel API
   */
  async request<T>(
    path: string,
    options: MixpanelRequestOptions = {}
  ): Promise<T> {
    const {
      method = 'GET',
      params,
      body,
      headers = {},
      endpoint = 'data',
      authType = 'basic',
    } = options;

    const baseUrl = this.getBaseUrl(endpoint);
    const url = new URL(path, baseUrl);

    // Add query params
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.append(key, String(value));
        }
      });
    }

    // Build headers
    const requestHeaders: Record<string, string> = {
      'Accept': 'application/json',
      ...headers,
    };

    // Add auth header
    if (authType === 'basic' && this.apiSecret) {
      requestHeaders['Authorization'] = this.getBasicAuthHeader();
    } else if (authType === 'service-account') {
      requestHeaders['Authorization'] = this.getServiceAccountAuthHeader();
    }

    // Prepare body
    let fetchBody: string | undefined;
    if (body) {
      if (typeof body === 'string') {
        fetchBody = body;
      } else {
        fetchBody = JSON.stringify(body);
        requestHeaders['Content-Type'] = 'application/json';
      }
    }

    const response = await fetch(url.toString(), {
      method,
      headers: requestHeaders,
      body: fetchBody,
    });

    // Handle response
    const contentType = response.headers.get('content-type') || '';
    let data: unknown;

    if (response.status === 204) {
      return {} as T;
    }

    const text = await response.text();

    if (contentType.includes('application/json') || text.startsWith('{') || text.startsWith('[')) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    } else {
      data = text;
    }

    if (!response.ok) {
      let errorMessage = `Mixpanel Error: ${response.status} ${response.statusText}`;
      let errorCode: string | undefined;

      if (typeof data === 'object' && data !== null) {
        const errData = data as Record<string, unknown>;
        errorCode = errData.error as string;
        errorMessage = (errData.error || errData.message || errorMessage) as string;
      } else if (typeof data === 'string') {
        errorMessage = data || errorMessage;
      }

      throw new MixpanelApiError(errorMessage, response.status, errorCode);
    }

    return data as T;
  }

  /**
   * Make a request for tracking (uses different content type)
   */
  async trackRequest<T>(
    path: string,
    data: unknown
  ): Promise<T> {
    const baseUrl = this.getBaseUrl('track');
    const url = new URL(path, baseUrl);

    // Encode data as base64
    const dataStr = typeof data === 'string' ? data : JSON.stringify(data);
    const encodedData = Buffer.from(dataStr).toString('base64');

    // Build form data
    const formData = new URLSearchParams();
    formData.append('data', encodedData);

    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'text/plain',
      },
      body: formData.toString(),
    });

    const text = await response.text();

    if (!response.ok) {
      throw new MixpanelApiError(text || `HTTP ${response.status}`, response.status);
    }

    // Track endpoint returns 1 for success, 0 for failure
    if (text === '1') {
      return { status: 1 } as T;
    } else if (text === '0') {
      return { status: 0, error: 'Invalid request' } as T;
    }

    // Try to parse JSON response
    try {
      return JSON.parse(text) as T;
    } catch {
      return { status: text === '1' ? 1 : 0, response: text } as T;
    }
  }

  /**
   * Make a request to import/batch endpoint (JSON body)
   * The import endpoint requires project_id and uses Basic Auth (service account or API secret)
   */
  async importRequest<T>(
    path: string,
    data: unknown[]
  ): Promise<T> {
    const baseUrl = this.getBaseUrl('track');
    const url = new URL(path, baseUrl);

    // Import endpoint requires authentication via Basic Auth header
    if (!this.serviceAccountUsername && !this.serviceAccountSecret && !this.apiSecret) {
      throw new Error('Service account credentials or API secret is required for import');
    }

    // Add project_id to query if available (required for service account auth)
    if (this.projectId) {
      url.searchParams.append('project_id', this.projectId);
    }

    // Enable strict mode for better error reporting
    url.searchParams.append('strict', '1');

    const requestHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    // Use service account auth for import if available, otherwise basic auth with API secret
    if (this.serviceAccountUsername && this.serviceAccountSecret) {
      requestHeaders['Authorization'] = this.getServiceAccountAuthHeader();
    } else if (this.apiSecret) {
      requestHeaders['Authorization'] = this.getBasicAuthHeader();
    }

    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify(data),
    });

    const text = await response.text();
    let result: unknown;

    try {
      result = JSON.parse(text);
    } catch {
      result = { response: text };
    }

    if (!response.ok) {
      const errData = result as Record<string, unknown>;
      throw new MixpanelApiError(
        (errData.error || text || `HTTP ${response.status}`) as string,
        response.status
      );
    }

    return result as T;
  }

  /**
   * Make a raw export request (returns NDJSON)
   */
  async exportRequest(
    path: string,
    params: Record<string, string | number | boolean | undefined>
  ): Promise<string> {
    const baseUrl = this.getBaseUrl('export');
    const url = new URL(path, baseUrl);

    // Add query params
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.append(key, String(value));
      }
    });

    const requestHeaders: Record<string, string> = {
      'Accept': 'text/plain',
    };

    if (this.apiSecret) {
      requestHeaders['Authorization'] = this.getBasicAuthHeader();
    }

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: requestHeaders,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new MixpanelApiError(text || `HTTP ${response.status}`, response.status);
    }

    return response.text();
  }
}
