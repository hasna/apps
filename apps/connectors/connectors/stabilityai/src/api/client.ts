import { readFileSync, existsSync } from 'fs';
import type { StabilityConfig, OutputFormat } from '../types';
import { StabilityApiError } from '../types';

const DEFAULT_BASE_URL = 'https://api.stability.ai';
const V1_BASE_URL = 'https://api.stability.ai/v1';
const V2_BASE_URL = 'https://api.stability.ai/v2beta';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | FormData | string;
  headers?: Record<string, string>;
  format?: OutputFormat;
  version?: 'v1' | 'v2';
  responseType?: 'json' | 'binary' | 'arraybuffer';
}

export class StabilityClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: StabilityConfig) {
    if (!config.apiKey) {
      throw new Error('API key is required');
    }
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  }

  private getVersionedUrl(version: 'v1' | 'v2' = 'v2'): string {
    if (version === 'v1') {
      return V1_BASE_URL;
    }
    return V2_BASE_URL;
  }

  private buildUrl(path: string, params?: Record<string, string | number | boolean | undefined>, version: 'v1' | 'v2' = 'v2'): string {
    const baseUrl = this.getVersionedUrl(version);
    const url = new URL(`${baseUrl}${path}`);

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
   * Make an authenticated request to Stability AI API
   * Uses Bearer token authentication
   */
  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body, headers = {}, version = 'v2', responseType = 'json' } = options;

    const url = this.buildUrl(path, params, version);

    const requestHeaders: Record<string, string> = {
      'Authorization': `Bearer ${this.apiKey}`,
      'Accept': responseType === 'binary' || responseType === 'arraybuffer' ? 'image/*' : 'application/json',
      ...headers,
    };

    // Don't set Content-Type for FormData - let the browser set it with boundary
    if (body && ['POST', 'PUT', 'PATCH'].includes(method) && !(body instanceof FormData)) {
      requestHeaders['Content-Type'] = 'application/json';
    }

    const fetchOptions: RequestInit = {
      method,
      headers: requestHeaders,
    };

    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
      if (body instanceof FormData) {
        fetchOptions.body = body;
      } else if (typeof body === 'string') {
        fetchOptions.body = body;
      } else {
        fetchOptions.body = JSON.stringify(body);
      }
    }

    const response = await fetch(url, fetchOptions);

    // Handle 204 No Content
    if (response.status === 204) {
      return {} as T;
    }

    // Handle binary response (images)
    if (responseType === 'binary' || responseType === 'arraybuffer') {
      if (!response.ok) {
        const errorText = await response.text();
        throw new StabilityApiError(errorText || response.statusText, response.status);
      }
      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer) as unknown as T;
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
    } else if (contentType.includes('image/')) {
      // Return base64 encoded image
      const arrayBuffer = await response.arrayBuffer();
      const base64 = Buffer.from(arrayBuffer).toString('base64');
      return { image: base64 } as T;
    } else {
      data = await response.text();
    }

    // Handle errors
    if (!response.ok) {
      const errorMessage = typeof data === 'object' && data !== null
        ? JSON.stringify(data)
        : String(data || response.statusText);
      throw new StabilityApiError(errorMessage, response.status);
    }

    return data as T;
  }

  /**
   * Make a multipart form request (for image uploads)
   */
  async requestMultipart<T>(path: string, formData: FormData, options: RequestOptions = {}): Promise<T> {
    const { version = 'v2', responseType = 'json' } = options;
    const url = this.buildUrl(path, undefined, version);

    const acceptHeader = responseType === 'json' ? 'application/json' : 'image/*';

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Accept': acceptHeader,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorData: unknown;
      try {
        errorData = JSON.parse(errorText);
      } catch {
        errorData = errorText;
      }
      const errorMessage = typeof errorData === 'object' && errorData !== null
        ? JSON.stringify(errorData)
        : String(errorData || response.statusText);
      throw new StabilityApiError(errorMessage, response.status);
    }

    const contentType = response.headers.get('content-type') || '';

    if (contentType.includes('image/')) {
      const arrayBuffer = await response.arrayBuffer();
      const base64 = Buffer.from(arrayBuffer).toString('base64');
      return { image: base64, finish_reason: 'SUCCESS' } as T;
    }

    const text = await response.text();
    if (text) {
      try {
        return JSON.parse(text) as T;
      } catch {
        return { image: text } as T;
      }
    }

    return {} as T;
  }

  async get<T>(path: string, params?: Record<string, string | number | boolean | undefined>, version: 'v1' | 'v2' = 'v2'): Promise<T> {
    return this.request<T>(path, { method: 'GET', params, version });
  }

  async post<T>(path: string, body?: Record<string, unknown> | FormData | string, params?: Record<string, string | number | boolean | undefined>, version: 'v1' | 'v2' = 'v2'): Promise<T> {
    return this.request<T>(path, { method: 'POST', body, params, version });
  }

  async put<T>(path: string, body?: Record<string, unknown> | FormData, params?: Record<string, string | number | boolean | undefined>, version: 'v1' | 'v2' = 'v2'): Promise<T> {
    return this.request<T>(path, { method: 'PUT', body, params, version });
  }

  async delete<T>(path: string, params?: Record<string, string | number | boolean | undefined>, version: 'v1' | 'v2' = 'v2'): Promise<T> {
    return this.request<T>(path, { method: 'DELETE', params, version });
  }

  /**
   * Get a preview of the API key (for display/debugging)
   */
  getApiKeyPreview(): string {
    if (this.apiKey.length > 10) {
      return `${this.apiKey.substring(0, 6)}...${this.apiKey.substring(this.apiKey.length - 4)}`;
    }
    return '***';
  }

  /**
   * Helper to load image file and convert to appropriate format
   */
  static loadImage(imagePath: string): Buffer {
    if (!existsSync(imagePath)) {
      throw new Error(`Image file not found: ${imagePath}`);
    }
    return readFileSync(imagePath);
  }

  /**
   * Create a File/Blob from a path or buffer for multipart uploads
   */
  static createImageBlob(image: string | Buffer): Blob {
    if (typeof image === 'string') {
      // It's a file path
      const buffer = StabilityClient.loadImage(image);
      return new Blob([buffer], { type: 'image/png' });
    }
    // It's already a buffer
    return new Blob([image], { type: 'image/png' });
  }
}
