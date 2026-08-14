import type { TisaneConfig } from '../types';
import { TisaneClient } from './client';
import { NlpApi } from './nlp';

export class Tisane {
  private readonly client: TisaneClient;
  public readonly nlp: NlpApi;

  constructor(config: TisaneConfig) {
    this.client = new TisaneClient(config);
    this.nlp = new NlpApi(this.client);
  }

  static fromEnv(): Tisane {
    const apiKey = process.env.TISANE_API_KEY;
    if (!apiKey) {
      throw new Error('TISANE_API_KEY environment variable is required');
    }
    return new Tisane({
      apiKey,
      baseUrl: process.env.TISANE_BASE_URL,
    });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): TisaneClient {
    return this.client;
  }

  listLanguages(): Promise<unknown> {
    return this.nlp.listLanguages();
  }

  parse(body: Record<string, unknown>): Promise<unknown> {
    return this.nlp.parse(body);
  }

  extractText(body: Record<string, unknown>): Promise<unknown> {
    return this.nlp.extractText(body);
  }

  compareEntities(body: Record<string, unknown>): Promise<unknown> {
    return this.nlp.compareEntities(body);
  }

  similarity(body: Record<string, unknown>): Promise<unknown> {
    return this.nlp.similarity(body);
  }

  detectLanguage(body: Record<string, unknown>): Promise<unknown> {
    return this.nlp.detectLanguage(body);
  }

  transform(body: Record<string, unknown>): Promise<unknown> {
    return this.nlp.transform(body);
  }

  rawRequest(
    path: string,
    options: {
      method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
      body?: Record<string, unknown> | unknown[] | string;
      params?: Record<string, string | number | boolean | undefined>;
    } = {},
  ): Promise<unknown> {
    return this.client.request(path, options);
  }
}

export const Connector = Tisane;

export { TisaneClient } from './client';
export { NlpApi } from './nlp';
