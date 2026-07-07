import type { TextRazorAnalyzeOptions, TextRazorConfig, TextRazorRawRequestOptions } from '../types';
import { TextRazorApiError } from '../types';

const DEFAULT_BASE_URL = 'https://api.textrazor.com';

export class TextRazorClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: TextRazorConfig) {
    if (!config.apiKey) throw new Error('TextRazor apiKey is required');
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || process.env.TEXTRAZOR_BASE_URL || DEFAULT_BASE_URL;
  }

  private buildFormBody(
    args: Record<string, string | number | boolean | undefined>,
    defaultExtractors?: string,
  ): URLSearchParams {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(args)) {
      if (value === undefined || value === null) continue;
      params.set(key, String(value));
    }
    if (defaultExtractors && !params.has('extractors')) {
      params.set('extractors', defaultExtractors);
    }
    return params;
  }

  private analyzeParams(options: TextRazorAnalyzeOptions): Record<string, string | number | boolean | undefined> {
    const { text, extractors, ...rest } = options;
    return { text, extractors, ...rest };
  }

  async analyze(options: TextRazorAnalyzeOptions): Promise<unknown> {
    if (!options.text) throw new Error('text is required');
    return this.postForm('/', this.analyzeParams(options));
  }

  async extractEntities(text: string, options?: Omit<TextRazorAnalyzeOptions, 'text' | 'extractors'>): Promise<unknown> {
    return this.analyze({ text, extractors: 'entities', ...options });
  }

  async extractTopics(text: string, options?: Omit<TextRazorAnalyzeOptions, 'text' | 'extractors'>): Promise<unknown> {
    return this.analyze({ text, extractors: 'topics', ...options });
  }

  async extractSentiment(text: string, options?: Omit<TextRazorAnalyzeOptions, 'text' | 'extractors'>): Promise<unknown> {
    return this.analyze({ text, extractors: 'sentiment', ...options });
  }

  async rawRequest<T = unknown>(options: TextRazorRawRequestOptions = {}): Promise<T> {
    const method = options.method ?? 'POST';
    const path = options.path ?? '/';
    const url = new URL(`${this.baseUrl.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`);

    if (options.query) {
      for (const [key, value] of Object.entries(options.query)) {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.set(key, String(value));
        }
      }
    }

    const headers: Record<string, string> = {
      Accept: 'application/json',
      'X-TextRazor-Key': this.apiKey,
      ...options.headers,
    };

    let body: string | undefined;
    if (method !== 'GET' && method !== 'DELETE' && options.body) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      body = this.buildFormBody(options.body).toString();
    }

    const response = await fetch(url.toString(), { method, headers, body });
    const text = await response.text();
    let data: unknown = {};
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }

    if (!response.ok) {
      const message =
        typeof data === 'object' && data !== null && 'error' in data
          ? String((data as { error?: string }).error)
          : typeof data === 'object' && data !== null && 'message' in data
            ? String((data as { message?: string }).message)
            : response.statusText;
      throw new TextRazorApiError(message || 'TextRazor request failed', response.status);
    }

    return data as T;
  }

  private async postForm(
    path: string,
    body: Record<string, string | number | boolean | undefined>,
    defaultExtractors?: string,
  ): Promise<unknown> {
    const url = `${this.baseUrl.replace(/\/$/, '')}${path}`;
    const form = this.buildFormBody(body, defaultExtractors);
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-TextRazor-Key': this.apiKey,
      },
      body: form.toString(),
    });

    const text = await response.text();
    let data: unknown = {};
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }

    if (!response.ok) {
      const message =
        typeof data === 'object' && data !== null && 'error' in data
          ? String((data as { error?: string }).error)
          : typeof data === 'object' && data !== null && 'message' in data
            ? String((data as { message?: string }).message)
            : response.statusText;
      throw new TextRazorApiError(message || 'TextRazor request failed', response.status);
    }

    return data;
  }
}
