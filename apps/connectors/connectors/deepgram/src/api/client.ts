import type {
  DeepgramConfig,
  TranscriptionOptions,
  TranscriptionResult,
  SpeakOptions,
  SpeakResponse,
  ProjectsResponse,
  BalanceResponse,
  UsageSummary,
} from '../types';
import { DeepgramApiError } from '../types';

const DEFAULT_BASE_URL = 'https://api.deepgram.com/v1';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | unknown[] | string | Buffer;
  headers?: Record<string, string>;
}

export class DeepgramClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: DeepgramConfig) {
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

    // Deepgram uses Token auth
    const requestHeaders: Record<string, string> = {
      'Authorization': `Token ${this.apiKey}`,
      'Accept': 'application/json',
      ...headers,
    };

    if (body && ['POST', 'PUT', 'PATCH'].includes(method) && !Buffer.isBuffer(body)) {
      requestHeaders['Content-Type'] = 'application/json';
    }

    const fetchOptions: RequestInit = {
      method,
      headers: requestHeaders,
    };

    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
      fetchOptions.body = Buffer.isBuffer(body) ? body : (typeof body === 'string' ? body : JSON.stringify(body));
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
    } else if (contentType.includes('audio/')) {
      data = await response.arrayBuffer();
    } else {
      data = await response.text();
    }

    if (!response.ok) {
      const errorMessage = typeof data === 'object' && data !== null
        ? JSON.stringify(data)
        : String(data || response.statusText);
      throw new DeepgramApiError(errorMessage, response.status);
    }

    return data as T;
  }

  async get<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'GET', params });
  }

  async post<T>(path: string, body?: Record<string, unknown> | unknown[] | string | Buffer, params?: Record<string, string | number | boolean | undefined>, headers?: Record<string, string>): Promise<T> {
    return this.request<T>(path, { method: 'POST', body: body as Record<string, unknown>, params, headers });
  }

  // ============================================
  // Transcription Methods
  // ============================================

  async transcribeUrl(audioUrl: string, options: TranscriptionOptions = {}): Promise<TranscriptionResult> {
    const params: Record<string, string | number | boolean | undefined> = {
      model: options.model,
      language: options.language,
      punctuate: options.punctuate,
      profanity_filter: options.profanity_filter,
      diarize: options.diarize,
      smart_format: options.smart_format,
      filler_words: options.filler_words,
      multichannel: options.multichannel,
      alternatives: options.alternatives,
      numerals: options.numerals,
      utterances: options.utterances,
      utt_split: options.utt_split,
      paragraphs: options.paragraphs,
      summarize: options.summarize === true ? 'true' : options.summarize === 'v2' ? 'v2' : undefined,
      topics: options.topics === true ? 'true' : options.topics === 'v2' ? 'v2' : undefined,
      intents: options.intents,
      sentiment: options.sentiment,
      detect_language: options.detect_language,
      detect_entities: options.detect_entities,
      detect_topics: options.detect_topics,
      callback: options.callback,
      callback_method: options.callback_method,
    };

    return this.post<TranscriptionResult>('/listen', { url: audioUrl }, params);
  }

  async transcribeBuffer(audioData: Buffer, options: TranscriptionOptions = {}, contentType = 'audio/wav'): Promise<TranscriptionResult> {
    const params: Record<string, string | number | boolean | undefined> = {
      model: options.model,
      language: options.language,
      punctuate: options.punctuate,
      profanity_filter: options.profanity_filter,
      diarize: options.diarize,
      smart_format: options.smart_format,
      filler_words: options.filler_words,
      multichannel: options.multichannel,
      alternatives: options.alternatives,
      numerals: options.numerals,
      utterances: options.utterances,
      utt_split: options.utt_split,
      paragraphs: options.paragraphs,
      summarize: options.summarize === true ? 'true' : options.summarize === 'v2' ? 'v2' : undefined,
      topics: options.topics === true ? 'true' : options.topics === 'v2' ? 'v2' : undefined,
      intents: options.intents,
      sentiment: options.sentiment,
      detect_language: options.detect_language,
      detect_entities: options.detect_entities,
      detect_topics: options.detect_topics,
    };

    return this.post<TranscriptionResult>('/listen', audioData, params, { 'Content-Type': contentType });
  }

  // ============================================
  // Text-to-Speech Methods
  // ============================================

  async speak(text: string, options: SpeakOptions = {}): Promise<SpeakResponse> {
    const params: Record<string, string | number | boolean | undefined> = {
      model: options.model || 'aura-asteria-en',
      encoding: options.encoding,
      container: options.container,
      sample_rate: options.sample_rate,
      bit_rate: options.bit_rate,
    };

    const response = await fetch(this.buildUrl('/speak', params), {
      method: 'POST',
      headers: {
        'Authorization': `Token ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new DeepgramApiError(errorText, response.status);
    }

    const audio = Buffer.from(await response.arrayBuffer());
    return {
      audio,
      contentType: response.headers.get('content-type') || 'audio/mpeg',
      requestId: response.headers.get('dg-request-id') || '',
      modelName: response.headers.get('dg-model-name') || '',
      modelUuid: response.headers.get('dg-model-uuid') || '',
      characters: parseInt(response.headers.get('dg-char-count') || '0'),
    };
  }

  // ============================================
  // Project Methods
  // ============================================

  async listProjects(): Promise<ProjectsResponse> {
    return this.get<ProjectsResponse>('/projects');
  }

  async getBalance(projectId: string): Promise<BalanceResponse> {
    return this.get<BalanceResponse>(`/projects/${projectId}/balances`);
  }

  async getUsage(projectId: string, start: string, end: string): Promise<UsageSummary> {
    return this.get<UsageSummary>(`/projects/${projectId}/usage`, { start, end });
  }

  getApiKeyPreview(): string {
    if (this.apiKey.length > 10) {
      return `${this.apiKey.substring(0, 6)}...${this.apiKey.substring(this.apiKey.length - 4)}`;
    }
    return '***';
  }
}
