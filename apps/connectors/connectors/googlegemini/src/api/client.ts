import type { GeminiConfig } from '../types';

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com';
const API_VERSION = 'v1beta';

export interface GeminiClientConfig {
  apiKey: string;
  baseUrl?: string;
}

export class GeminiClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: GeminiClientConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  }

  // Make authenticated request
  async request<T>(
    method: string,
    endpoint: string,
    options: {
      params?: Record<string, string | number | boolean | undefined>;
      body?: Record<string, unknown>;
      stream?: boolean;
    } = {}
  ): Promise<T> {
    // Build URL with version
    const urlPath = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    const versionedPath = urlPath.startsWith(`/${API_VERSION}`) ? urlPath : `/${API_VERSION}${urlPath}`;
    let url = `${this.baseUrl}${versionedPath}`;

    // Add API key to URL
    const urlParams = new URLSearchParams();
    urlParams.set('key', this.apiKey);

    // Add other params
    if (options.params) {
      for (const [key, value] of Object.entries(options.params)) {
        if (value !== undefined) {
          urlParams.set(key, String(value));
        }
      }
    }

    url = `${url}?${urlParams.toString()}`;

    // Make request
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    const fetchOptions: RequestInit = {
      method: method.toUpperCase(),
      headers,
    };

    if (options.body && ['POST', 'PUT', 'PATCH'].includes(method.toUpperCase())) {
      fetchOptions.body = JSON.stringify(options.body);
    }

    const response = await fetch(url, fetchOptions);

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = `API Error: ${response.status} ${response.statusText}`;
      try {
        const errorJson = JSON.parse(errorText);
        if (errorJson.error?.message) {
          errorMessage = errorJson.error.message;
        }
      } catch {
        if (errorText) {
          errorMessage = errorText;
        }
      }
      throw new Error(errorMessage);
    }

    const data = await response.json();
    return data as T;
  }

  // Stream request (returns async generator)
  async *streamRequest(
    endpoint: string,
    body: Record<string, unknown>
  ): AsyncGenerator<string, void, unknown> {
    const urlPath = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    const versionedPath = urlPath.startsWith(`/${API_VERSION}`) ? urlPath : `/${API_VERSION}${urlPath}`;
    const url = `${this.baseUrl}${versionedPath}?key=${this.apiKey}&alt=sse`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Stream Error: ${response.status} - ${errorText}`);
    }

    if (!response.body) {
      throw new Error('No response body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') return;
          try {
            const parsed = JSON.parse(data);
            const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
            if (text) {
              yield text;
            }
          } catch {
            // Skip invalid JSON
          }
        }
      }
    }
  }

  // HTTP method shortcuts
  async get<T>(endpoint: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>('GET', endpoint, { params });
  }

  async post<T>(endpoint: string, body?: Record<string, unknown>, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>('POST', endpoint, { body, params });
  }

  async delete<T>(endpoint: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>('DELETE', endpoint, { params });
  }

  // File upload (multipart)
  async uploadFile(
    filePath: string,
    mimeType: string,
    displayName?: string
  ): Promise<{ file: { name: string; uri: string } }> {
    const fs = await import('fs');
    const path = await import('path');

    const fileContent = fs.readFileSync(filePath);
    const fileName = displayName || path.basename(filePath);

    // Step 1: Start resumable upload
    const startUrl = `${this.baseUrl}/upload/${API_VERSION}/files?key=${this.apiKey}`;
    const startResponse = await fetch(startUrl, {
      method: 'POST',
      headers: {
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': String(fileContent.length),
        'X-Goog-Upload-Header-Content-Type': mimeType,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        file: { displayName: fileName },
      }),
    });

    if (!startResponse.ok) {
      throw new Error(`Upload start failed: ${startResponse.statusText}`);
    }

    const uploadUrl = startResponse.headers.get('X-Goog-Upload-URL');
    if (!uploadUrl) {
      throw new Error('No upload URL returned');
    }

    // Step 2: Upload file content
    const uploadResponse = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'X-Goog-Upload-Command': 'upload, finalize',
        'X-Goog-Upload-Offset': '0',
        'Content-Type': mimeType,
      },
      body: fileContent,
    });

    if (!uploadResponse.ok) {
      throw new Error(`Upload failed: ${uploadResponse.statusText}`);
    }

    return uploadResponse.json();
  }

  // Getters
  getBaseUrl(): string {
    return this.baseUrl;
  }

  getApiKeyPreview(): string {
    if (!this.apiKey) return 'not set';
    return this.apiKey.slice(0, 8) + '...';
  }
}
