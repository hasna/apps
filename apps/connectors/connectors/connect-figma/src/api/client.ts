import type { FigmaConfig } from '../types';
import { FigmaApiError } from '../types';

const FIGMA_API_BASE = 'https://api.figma.com/v1';

export interface FigmaRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  params?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
}

/**
 * Figma API Client
 */
export class FigmaClient {
  private readonly accessToken: string;

  constructor(config: FigmaConfig) {
    if (!config.accessToken) {
      throw new Error('Figma Access Token is required');
    }
    this.accessToken = config.accessToken;
  }

  /**
   * Make a request to the Figma API
   */
  async request<T>(
    path: string,
    options: FigmaRequestOptions = {}
  ): Promise<T> {
    const { method = 'GET', params, body, headers = {} } = options;

    const url = new URL(`${FIGMA_API_BASE}${path}`);

    // Add query params
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.append(key, String(value));
        }
      });
    }

    const requestHeaders: Record<string, string> = {
      'X-Figma-Token': this.accessToken,
      ...headers,
    };

    if (body) {
      requestHeaders['Content-Type'] = 'application/json';
    }

    const response = await fetch(url.toString(), {
      method,
      headers: requestHeaders,
      body: body ? JSON.stringify(body) : undefined,
    });

    // Handle response
    let data: unknown;

    if (response.status === 204) {
      return {} as T;
    }

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

    if (!response.ok) {
      let errorMessage = `Figma API Error: ${response.status} ${response.statusText}`;
      let errorCode: string | undefined;

      if (typeof data === 'object' && data !== null) {
        const errData = data as Record<string, unknown>;
        errorCode = errData.err as string;
        if (errData.message) {
          errorMessage = errData.message as string;
        } else if (errData.err) {
          errorMessage = errData.err as string;
        }
      }

      throw new FigmaApiError(errorMessage, response.status, errorCode);
    }

    return data as T;
  }

  /**
   * Get a preview of the access token (for display/debugging)
   */
  getAccessTokenPreview(): string {
    if (this.accessToken.length > 8) {
      return `${this.accessToken.substring(0, 8)}...`;
    }
    return '***';
  }
}
