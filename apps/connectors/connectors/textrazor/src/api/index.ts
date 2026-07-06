import { TextRazorClient } from './client';
import type { TextRazorAnalyzeOptions, TextRazorConfig, TextRazorRawRequestOptions, TextRazorResponse } from '../types';

export { TextRazorClient } from './client';

export class TextRazor {
  private readonly client: TextRazorClient;

  constructor(config: TextRazorConfig) {
    this.client = new TextRazorClient(config);
  }

  static fromEnv(): TextRazor {
    const apiKey = process.env.TEXTRAZOR_API_KEY;
    if (!apiKey) throw new Error('TEXTRAZOR_API_KEY is required');
    return new TextRazor({ apiKey, baseUrl: process.env.TEXTRAZOR_BASE_URL });
  }

  async analyze(options: TextRazorAnalyzeOptions): Promise<TextRazorResponse> {
    return this.client.analyze(options) as Promise<TextRazorResponse>;
  }

  async extractEntities(
    text: string,
    options?: Omit<TextRazorAnalyzeOptions, 'text' | 'extractors'>,
  ): Promise<TextRazorResponse> {
    return this.client.extractEntities(text, options) as Promise<TextRazorResponse>;
  }

  async extractTopics(
    text: string,
    options?: Omit<TextRazorAnalyzeOptions, 'text' | 'extractors'>,
  ): Promise<TextRazorResponse> {
    return this.client.extractTopics(text, options) as Promise<TextRazorResponse>;
  }

  async extractSentiment(
    text: string,
    options?: Omit<TextRazorAnalyzeOptions, 'text' | 'extractors'>,
  ): Promise<TextRazorResponse> {
    return this.client.extractSentiment(text, options) as Promise<TextRazorResponse>;
  }

  async rawRequest<T = unknown>(options: TextRazorRawRequestOptions = {}): Promise<T> {
    return this.client.rawRequest<T>(options);
  }

  getClient(): TextRazorClient {
    return this.client;
  }
}
