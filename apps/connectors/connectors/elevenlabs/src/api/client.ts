import type { ElevenLabsConfig, OutputFormat, AudioFormat } from '../types';
import { ElevenLabsApiError, DEFAULT_AUDIO_FORMAT } from '../types';

const DEFAULT_BASE_URL = 'https://api.elevenlabs.io';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  params?: Record<string, string | number | boolean | undefined>;
  body?: object | unknown[] | string | FormData;
  headers?: Record<string, string>;
  format?: OutputFormat;
  responseType?: 'json' | 'arraybuffer' | 'text';
}

export class ElevenLabsClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: ElevenLabsConfig) {
    if (!config.apiKey) {
      throw new Error('API key is required');
    }
    this.apiKey = config.apiKey;
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

    return url.toString();
  }

  /**
   * Make an authenticated request to the ElevenLabs API
   */
  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body, headers = {}, responseType = 'json' } = options;

    const url = this.buildUrl(path, params);

    const requestHeaders: Record<string, string> = {
      'xi-api-key': this.apiKey,
      ...headers,
    };

    // Don't set Accept for audio responses
    if (responseType === 'json') {
      requestHeaders['Accept'] = 'application/json';
    }

    const fetchOptions: RequestInit = {
      method,
      headers: requestHeaders,
    };

    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
      if (body instanceof FormData) {
        // Let fetch set Content-Type for FormData (includes boundary)
        fetchOptions.body = body;
      } else if (typeof body === 'string') {
        fetchOptions.body = body;
        requestHeaders['Content-Type'] = 'application/json';
      } else {
        fetchOptions.body = JSON.stringify(body);
        requestHeaders['Content-Type'] = 'application/json';
      }
    }

    const response = await fetch(url, fetchOptions);

    // Handle 204 No Content
    if (response.status === 204) {
      return {} as T;
    }

    // Handle different response types
    if (responseType === 'arraybuffer') {
      if (!response.ok) {
        const errorText = await response.text();
        throw new ElevenLabsApiError(errorText, response.status);
      }
      return (await response.arrayBuffer()) as unknown as T;
    }

    if (responseType === 'text') {
      if (!response.ok) {
        const errorText = await response.text();
        throw new ElevenLabsApiError(errorText, response.status);
      }
      return (await response.text()) as unknown as T;
    }

    // Parse JSON response
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
    } else if (contentType.includes('audio/')) {
      // Return audio as ArrayBuffer
      return (await response.arrayBuffer()) as unknown as T;
    } else {
      data = await response.text();
    }

    // Handle errors
    if (!response.ok) {
      const errorMessage = typeof data === 'object' && data !== null
        ? JSON.stringify(data)
        : String(data || response.statusText);
      throw new ElevenLabsApiError(errorMessage, response.status);
    }

    return data as T;
  }

  async get<T>(path: string, params?: Record<string, string | number | boolean | undefined>, options?: Partial<RequestOptions>): Promise<T> {
    return this.request<T>(path, { method: 'GET', params, ...options });
  }

  async post<T>(path: string, body?: object | unknown[] | string | FormData, params?: Record<string, string | number | boolean | undefined>, options?: Partial<RequestOptions>): Promise<T> {
    return this.request<T>(path, { method: 'POST', body, params, ...options });
  }

  async put<T>(path: string, body?: Record<string, unknown>, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'PUT', body, params });
  }

  async patch<T>(path: string, body?: Record<string, unknown>, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'PATCH', body, params });
  }

  async delete<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'DELETE', params });
  }

  /**
   * Get audio from TTS endpoint
   */
  async getAudio(path: string, body: Record<string, unknown>, outputFormat: AudioFormat = DEFAULT_AUDIO_FORMAT): Promise<ArrayBuffer> {
    return this.post<ArrayBuffer>(path, body, { output_format: outputFormat }, { responseType: 'arraybuffer' });
  }

  /**
   * Upload file via FormData
   */
  async uploadFile<T>(path: string, formData: FormData, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.post<T>(path, formData, params);
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
}
