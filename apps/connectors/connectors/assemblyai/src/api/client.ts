import type {
  AssemblyAIConfig,
  TranscriptRequest,
  Transcript,
  TranscriptListResponse,
  UploadResponse,
  LemurTaskRequest,
  LemurResponse,
  LemurSummaryRequest,
  LemurQuestionAnswerRequest,
  LemurQuestionAnswerResponse,
} from '../types';
import { AssemblyAIApiError } from '../types';

const DEFAULT_BASE_URL = 'https://api.assemblyai.com/v2';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | unknown[] | string;
  headers?: Record<string, string>;
}

export class AssemblyAIClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: AssemblyAIConfig) {
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

    // AssemblyAI uses plain API key in Authorization header
    const requestHeaders: Record<string, string> = {
      'Authorization': this.apiKey,
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
      throw new AssemblyAIApiError(errorMessage, response.status);
    }

    return data as T;
  }

  async get<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'GET', params });
  }

  async post<T>(path: string, body?: Record<string, unknown> | unknown[] | string | object): Promise<T> {
    return this.request<T>(path, { method: 'POST', body: body as Record<string, unknown> });
  }

  async delete<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'DELETE' });
  }

  // ============================================
  // Transcript Methods
  // ============================================

  async createTranscript(params: TranscriptRequest): Promise<Transcript> {
    return this.post<Transcript>('/transcript', params);
  }

  async getTranscript(transcriptId: string): Promise<Transcript> {
    return this.get<Transcript>(`/transcript/${transcriptId}`);
  }

  async listTranscripts(limit?: number, status?: string, created_on?: string): Promise<TranscriptListResponse> {
    return this.get<TranscriptListResponse>('/transcript', { limit, status, created_on });
  }

  async deleteTranscript(transcriptId: string): Promise<Transcript> {
    return this.delete<Transcript>(`/transcript/${transcriptId}`);
  }

  async waitForTranscript(transcriptId: string, pollIntervalMs = 3000): Promise<Transcript> {
    while (true) {
      const transcript = await this.getTranscript(transcriptId);
      if (transcript.status === 'completed' || transcript.status === 'error') {
        return transcript;
      }
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }
  }

  // ============================================
  // Upload Methods
  // ============================================

  async upload(audioData: Buffer | Uint8Array): Promise<UploadResponse> {
    const response = await fetch(`${this.baseUrl}/upload`, {
      method: 'POST',
      headers: {
        'Authorization': this.apiKey,
        'Content-Type': 'application/octet-stream',
      },
      body: audioData,
    });

    if (!response.ok) {
      throw new AssemblyAIApiError(await response.text(), response.status);
    }

    return response.json();
  }

  // ============================================
  // LeMUR Methods
  // ============================================

  async lemurTask(params: LemurTaskRequest): Promise<LemurResponse> {
    return this.post<LemurResponse>('/lemur/v3/generate/task', params);
  }

  async lemurSummary(params: LemurSummaryRequest): Promise<LemurResponse> {
    return this.post<LemurResponse>('/lemur/v3/generate/summary', params);
  }

  async lemurQuestionAnswer(params: LemurQuestionAnswerRequest): Promise<LemurQuestionAnswerResponse> {
    return this.post<LemurQuestionAnswerResponse>('/lemur/v3/generate/question-answer', params);
  }

  getApiKeyPreview(): string {
    if (this.apiKey.length > 10) {
      return `${this.apiKey.substring(0, 6)}...${this.apiKey.substring(this.apiKey.length - 4)}`;
    }
    return '***';
  }
}
