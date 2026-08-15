import type { TwilioConfig, OutputFormat } from '../types';
import { TwilioApiError } from '../types';

const DEFAULT_BASE_URL = 'https://api.twilio.com/2010-04-01';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | string;
  headers?: Record<string, string>;
  format?: OutputFormat;
  useFormData?: boolean;
}

export class TwilioClient {
  private readonly accountSid: string;
  private readonly authToken: string;
  private readonly baseUrl: string;

  constructor(config: TwilioConfig) {
    if (!config.accountSid) {
      throw new Error('Account SID is required');
    }
    if (!config.authToken) {
      throw new Error('Auth Token is required');
    }
    this.accountSid = config.accountSid;
    this.authToken = config.authToken;
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  }

  /**
   * Get the Account SID
   */
  getAccountSid(): string {
    return this.accountSid;
  }

  private buildUrl(path: string, params?: Record<string, string | number | boolean | undefined>): string {
    // Replace {AccountSid} placeholder in path
    const resolvedPath = path.replace('{AccountSid}', this.accountSid);
    const url = new URL(`${this.baseUrl}${resolvedPath}`);

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.append(key, String(value));
        }
      });
    }

    return url.toString();
  }

  /**
   * Create Basic auth header from Account SID and Auth Token
   */
  private getAuthHeader(): string {
    const credentials = Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64');
    return `Basic ${credentials}`;
  }

  /**
   * Convert body to URL-encoded form data
   * Twilio API uses application/x-www-form-urlencoded for POST requests
   */
  private toFormData(body: Record<string, unknown>): string {
    const params = new URLSearchParams();

    const addParam = (key: string, value: unknown) => {
      if (value === undefined || value === null) return;

      if (Array.isArray(value)) {
        value.forEach(v => params.append(key, String(v)));
      } else if (typeof value === 'object') {
        params.append(key, JSON.stringify(value));
      } else {
        params.append(key, String(value));
      }
    };

    Object.entries(body).forEach(([key, value]) => addParam(key, value));
    return params.toString();
  }

  /**
   * Make an authenticated request to the Twilio API
   */
  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body, headers = {}, useFormData = true } = options;

    const url = this.buildUrl(path, params);

    const requestHeaders: Record<string, string> = {
      'Authorization': this.getAuthHeader(),
      'Accept': 'application/json',
      ...headers,
    };

    const fetchOptions: RequestInit = {
      method,
      headers: requestHeaders,
    };

    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
      if (useFormData && typeof body === 'object') {
        requestHeaders['Content-Type'] = 'application/x-www-form-urlencoded';
        fetchOptions.body = this.toFormData(body as Record<string, unknown>);
      } else if (typeof body === 'string') {
        requestHeaders['Content-Type'] = 'application/x-www-form-urlencoded';
        fetchOptions.body = body;
      } else {
        requestHeaders['Content-Type'] = 'application/json';
        fetchOptions.body = JSON.stringify(body);
      }
    }

    fetchOptions.headers = requestHeaders;

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
      const errorData = data as { message?: string; code?: number; more_info?: string; status?: number } | undefined;
      const errorMessage = errorData?.message || response.statusText;
      const errorCode = errorData?.code || response.status;
      const moreInfo = errorData?.more_info || '';
      throw new TwilioApiError(errorMessage, response.status, errorCode, moreInfo);
    }

    return data as T;
  }

  async get<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'GET', params });
  }

  async post<T>(path: string, body?: Record<string, unknown> | string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'POST', body, params });
  }

  async put<T>(path: string, body?: Record<string, unknown>, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'PUT', body, params });
  }

  async delete<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'DELETE', params });
  }

  /**
   * Get a preview of the Account SID (for display/debugging)
   */
  getAccountSidPreview(): string {
    if (this.accountSid.length > 10) {
      return `${this.accountSid.substring(0, 6)}...${this.accountSid.substring(this.accountSid.length - 4)}`;
    }
    return '***';
  }
}
