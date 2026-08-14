import type {
  LeonardoConfig,
  GenerateRequest,
  GenerateResponse,
  GetGenerationResponse,
  ListGenerationsResponse,
  ListModelsResponse,
  ListPlatformModelsResponse,
  VariationRequest,
  VariationResponse,
  UserInfo,
} from '../types';
import { LeonardoApiError } from '../types';

const DEFAULT_BASE_URL = 'https://cloud.leonardo.ai/api/rest/v1';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | unknown[] | string;
  headers?: Record<string, string>;
}

export class LeonardoClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: LeonardoConfig) {
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

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body, headers = {} } = options;

    const url = this.buildUrl(path, params);

    const requestHeaders: Record<string, string> = {
      'Authorization': `Bearer ${this.apiKey}`,
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
      throw new LeonardoApiError(errorMessage, response.status);
    }

    return data as T;
  }

  async get<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'GET', params });
  }

  async post<T>(path: string, body?: Record<string, unknown> | unknown[] | string | object): Promise<T> {
    return this.request<T>(path, { method: 'POST', body: body as Record<string, unknown> });
  }

  // ============================================
  // Generation Methods
  // ============================================

  async generate(params: GenerateRequest): Promise<GenerateResponse> {
    return this.post<GenerateResponse>('/generations', params);
  }

  async getGeneration(generationId: string): Promise<GetGenerationResponse> {
    return this.get<GetGenerationResponse>(`/generations/${generationId}`);
  }

  async listGenerations(userId: string, limit?: number, offset?: number): Promise<ListGenerationsResponse> {
    return this.get<ListGenerationsResponse>(`/generations/user/${userId}`, { limit, offset });
  }

  // ============================================
  // Model Methods
  // ============================================

  async listModels(): Promise<ListPlatformModelsResponse> {
    return this.get<ListPlatformModelsResponse>('/platformModels');
  }

  async listCustomModels(userId: string): Promise<ListModelsResponse> {
    return this.get<ListModelsResponse>(`/models?userId=${userId}`);
  }

  // ============================================
  // Variation Methods
  // ============================================

  async createVariation(params: VariationRequest): Promise<VariationResponse> {
    return this.post<VariationResponse>('/variations', params);
  }

  // ============================================
  // User Methods
  // ============================================

  async getUser(): Promise<UserInfo> {
    return this.get<UserInfo>('/me');
  }

  getApiKeyPreview(): string {
    if (this.apiKey.length > 10) {
      return `${this.apiKey.substring(0, 6)}...${this.apiKey.substring(this.apiKey.length - 4)}`;
    }
    return '***';
  }
}
