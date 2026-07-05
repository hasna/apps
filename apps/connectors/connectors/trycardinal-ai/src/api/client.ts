import { readFileSync, existsSync } from 'fs';
import { basename } from 'path';
import type { ConnectorConfig, DocumentFormOptions, RawRequestOptions } from '../types';
import { ConnectorApiError, parseApiError } from '../types';

export const DEFAULT_BASE_URL = 'https://api.trycardinal.ai';

const FORM_OMIT_KEYS = new Set(['headers', 'query', 'method', 'path', 'file_url']);

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | unknown[] | string;
  headers?: Record<string, string>;
}

export class ConnectorClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: ConnectorConfig) {
    const key = config.apiKey || config.token;
    if (!key) {
      throw new Error('API key is required');
    }
    this.apiKey = key;
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  }

  private buildUrl(path: string, params?: Record<string, string | number | boolean | undefined>): string {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const url = new URL(`${this.baseUrl}${normalizedPath}`);

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.append(key, String(value));
        }
      }
    }

    return url.toString();
  }

  private authHeaders(extra?: Record<string, string>): Record<string, string> {
    return {
      'x-api-key': this.apiKey,
      ...extra,
    };
  }

  private async parseResponse<T>(response: Response): Promise<T> {
    if (response.status === 204) {
      return {} as T;
    }

    const text = await response.text();
    if (!text) {
      return {} as T;
    }

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      try {
        return JSON.parse(text) as T;
      } catch {
        return text as T;
      }
    }

    return text as T;
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body, headers = {} } = options;
    const url = this.buildUrl(path, params);

    const requestHeaders: Record<string, string> = {
      ...this.authHeaders(),
      Accept: 'application/json',
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
    const data = await this.parseResponse<unknown>(response);

    if (!response.ok) {
      throw parseApiError(data, response.status);
    }

    return data as T;
  }

  buildDocumentFormData(args: DocumentFormOptions): FormData {
    const fileUrl = args.fileUrl ?? args.file_url;
    const filePath = args.file;

    if (!filePath && !fileUrl) {
      throw new Error('Cardinal: file or fileUrl is required.');
    }

    const form = new FormData();

    for (const [key, value] of Object.entries(args)) {
      if (FORM_OMIT_KEYS.has(key) || value === undefined || value === null) {
        continue;
      }
      if (key === 'file_url') {
        continue;
      }
      if (key === 'file') {
        if (typeof value === 'string' && existsSync(value)) {
          const buffer = readFileSync(value);
          form.append('file', new Blob([buffer]), basename(value));
        }
        continue;
      }
      if (key === 'fileUrl') {
        form.append('fileUrl', String(value));
        continue;
      }
      if (Array.isArray(value)) {
        for (const entry of value) {
          form.append(key, String(entry));
        }
        continue;
      }
      if (typeof value === 'object') {
        form.append(key, JSON.stringify(value));
        continue;
      }
      form.append(key, String(value));
    }

    if (fileUrl && !form.has('fileUrl')) {
      form.append('fileUrl', String(fileUrl));
    }

    return form;
  }

  async requestMultipart<T>(path: string, formData: FormData, headers?: Record<string, string>): Promise<T> {
    const url = this.buildUrl(path);
    const response = await fetch(url, {
      method: 'POST',
      headers: this.authHeaders(headers),
      body: formData,
    });

    const data = await this.parseResponse<unknown>(response);

    if (!response.ok) {
      const message =
        typeof data === 'string'
          ? data.slice(0, 500)
          : typeof data === 'object' && data !== null
            ? JSON.stringify(data).slice(0, 500)
            : `HTTP ${response.status}`;
      throw new ConnectorApiError(`Cardinal: request failed (${response.status}): ${message}`, response.status);
    }

    return data as T;
  }

  async rawRequest<T = unknown>(options: RawRequestOptions): Promise<T> {
    const { path, method = 'GET', query, body, headers } = options;
    return this.request<T>(path, { method, params: query, body, headers });
  }

  async get<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'GET', params });
  }

  async post<T>(
    path: string,
    body?: Record<string, unknown> | unknown[] | string,
    params?: Record<string, string | number | boolean | undefined>,
  ): Promise<T> {
    return this.request<T>(path, { method: 'POST', body, params });
  }

  getApiKeyPreview(): string {
    if (this.apiKey.length > 10) {
      return `${this.apiKey.substring(0, 6)}...${this.apiKey.substring(this.apiKey.length - 4)}`;
    }
    return '***';
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }
}
