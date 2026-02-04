import type { GoogleConfig, OutputFormat } from '../types';
import { GoogleApiError } from '../types';

// Google API base URLs
const BASE_URLS = {
  gmail: 'https://gmail.googleapis.com',
  drive: 'https://www.googleapis.com/drive/v3',
  calendar: 'https://www.googleapis.com/calendar/v3',
  docs: 'https://docs.googleapis.com/v1',
  sheets: 'https://sheets.googleapis.com/v4',
};

export type GoogleService = 'gmail' | 'drive' | 'calendar' | 'docs' | 'sheets';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | unknown[] | string;
  headers?: Record<string, string>;
  format?: OutputFormat;
}

export class GoogleClient {
  private readonly accessToken: string;
  private readonly baseUrls: Record<GoogleService, string>;

  constructor(config: GoogleConfig) {
    if (!config.accessToken) {
      throw new Error('Access token is required');
    }
    this.accessToken = config.accessToken;
    this.baseUrls = {
      gmail: config.baseUrls?.gmail || BASE_URLS.gmail,
      drive: config.baseUrls?.drive || BASE_URLS.drive,
      calendar: config.baseUrls?.calendar || BASE_URLS.calendar,
      docs: config.baseUrls?.docs || BASE_URLS.docs,
      sheets: config.baseUrls?.sheets || BASE_URLS.sheets,
    };
  }

  private buildUrl(service: GoogleService, path: string, params?: Record<string, string | number | boolean | undefined>): string {
    const url = new URL(`${this.baseUrls[service]}${path}`);

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
   * Make an authenticated request to a Google API
   */
  async request<T>(service: GoogleService, path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body, headers = {} } = options;

    const url = this.buildUrl(service, path, params);

    const requestHeaders: Record<string, string> = {
      'Authorization': `Bearer ${this.accessToken}`,
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
      throw new GoogleApiError(errorMessage, response.status);
    }

    return data as T;
  }

  // Convenience methods for each service

  // Gmail
  async gmailGet<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>('gmail', path, { method: 'GET', params });
  }

  async gmailPost<T>(path: string, body?: Record<string, unknown> | string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>('gmail', path, { method: 'POST', body: body as Record<string, unknown>, params });
  }

  async gmailDelete<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>('gmail', path, { method: 'DELETE', params });
  }

  // Drive
  async driveGet<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>('drive', path, { method: 'GET', params });
  }

  async drivePost<T>(path: string, body?: Record<string, unknown>, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>('drive', path, { method: 'POST', body, params });
  }

  async drivePatch<T>(path: string, body?: Record<string, unknown>, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>('drive', path, { method: 'PATCH', body, params });
  }

  async driveDelete<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>('drive', path, { method: 'DELETE', params });
  }

  // Calendar
  async calendarGet<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>('calendar', path, { method: 'GET', params });
  }

  async calendarPost<T>(path: string, body?: Record<string, unknown>, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>('calendar', path, { method: 'POST', body, params });
  }

  async calendarPatch<T>(path: string, body?: Record<string, unknown>, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>('calendar', path, { method: 'PATCH', body, params });
  }

  async calendarPut<T>(path: string, body?: Record<string, unknown>, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>('calendar', path, { method: 'PUT', body, params });
  }

  async calendarDelete<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>('calendar', path, { method: 'DELETE', params });
  }

  // Docs
  async docsGet<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>('docs', path, { method: 'GET', params });
  }

  async docsPost<T>(path: string, body?: Record<string, unknown>, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>('docs', path, { method: 'POST', body, params });
  }

  // Sheets
  async sheetsGet<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>('sheets', path, { method: 'GET', params });
  }

  async sheetsPost<T>(path: string, body?: Record<string, unknown>, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>('sheets', path, { method: 'POST', body, params });
  }

  async sheetsPut<T>(path: string, body?: Record<string, unknown>, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>('sheets', path, { method: 'PUT', body, params });
  }

  /**
   * Get a preview of the access token (for display/debugging)
   */
  getAccessTokenPreview(): string {
    if (this.accessToken.length > 10) {
      return `${this.accessToken.substring(0, 6)}...${this.accessToken.substring(this.accessToken.length - 4)}`;
    }
    return '***';
  }
}
