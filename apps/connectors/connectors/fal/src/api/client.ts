import type {
  FalConfig,
  ImageGenerateRequest,
  ImageGenerateResponse,
  QueueSubmitResponse,
  QueueStatusResponse,
  QueueResultResponse,
  RunOptions,
} from '../types';
import { FalApiError, COMMON_MODELS, type CommonModelAlias } from '../types';

const DEFAULT_BASE_URL = 'https://fal.run';
const QUEUE_BASE_URL = 'https://queue.fal.run';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | unknown[] | string;
  headers?: Record<string, string>;
}

export class FalClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly queueUrl: string;

  constructor(config: FalConfig) {
    if (!config.apiKey) {
      throw new Error('API key is required');
    }
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
    this.queueUrl = QUEUE_BASE_URL;
  }

  private resolveModel(modelOrAlias: string): string {
    if (modelOrAlias in COMMON_MODELS) {
      return COMMON_MODELS[modelOrAlias as CommonModelAlias];
    }
    return modelOrAlias;
  }

  private buildUrl(baseUrl: string, path: string, params?: Record<string, string | number | boolean | undefined>): string {
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

  async request<T>(baseUrl: string, path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body, headers = {} } = options;

    const url = this.buildUrl(baseUrl, path, params);

    const requestHeaders: Record<string, string> = {
      'Authorization': `Key ${this.apiKey}`,
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

    if (response.status === 204) {
      return {} as T;
    }

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

    if (!response.ok) {
      const errorMessage = typeof data === 'object' && data !== null
        ? JSON.stringify(data)
        : String(data || response.statusText);
      throw new FalApiError(errorMessage, response.status);
    }

    return data as T;
  }

  // ============================================
  // Synchronous Run Methods
  // ============================================

  async run<T = ImageGenerateResponse>(model: string, input: Record<string, unknown>): Promise<T> {
    const resolvedModel = this.resolveModel(model);
    return this.request<T>(this.baseUrl, `/${resolvedModel}`, {
      method: 'POST',
      body: input,
    });
  }

  async generateImage(model: string, params: ImageGenerateRequest): Promise<ImageGenerateResponse> {
    return this.run<ImageGenerateResponse>(model, params as Record<string, unknown>);
  }

  // ============================================
  // Queue Methods
  // ============================================

  async submit(model: string, input: Record<string, unknown>, webhookUrl?: string): Promise<QueueSubmitResponse> {
    const resolvedModel = this.resolveModel(model);
    const body: Record<string, unknown> = { ...input };
    if (webhookUrl) {
      body.webhook_url = webhookUrl;
    }
    return this.request<QueueSubmitResponse>(this.queueUrl, `/${resolvedModel}`, {
      method: 'POST',
      body,
    });
  }

  async status(model: string, requestId: string): Promise<QueueStatusResponse> {
    const resolvedModel = this.resolveModel(model);
    return this.request<QueueStatusResponse>(this.queueUrl, `/${resolvedModel}/requests/${requestId}/status`, {
      method: 'GET',
    });
  }

  async result<T = ImageGenerateResponse>(model: string, requestId: string): Promise<QueueResultResponse<T>> {
    const resolvedModel = this.resolveModel(model);
    return this.request<QueueResultResponse<T>>(this.queueUrl, `/${resolvedModel}/requests/${requestId}`, {
      method: 'GET',
    });
  }

  async cancel(model: string, requestId: string): Promise<void> {
    const resolvedModel = this.resolveModel(model);
    await this.request<void>(this.queueUrl, `/${resolvedModel}/requests/${requestId}/cancel`, {
      method: 'PUT',
    });
  }

  getApiKeyPreview(): string {
    if (this.apiKey.length > 10) {
      return `${this.apiKey.substring(0, 6)}...${this.apiKey.substring(this.apiKey.length - 4)}`;
    }
    return '***';
  }
}
