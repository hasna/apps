import type { TextCortexConfig } from '../types';
import { TextCortexClient } from './client';
import { HemingwaiApi } from './hemingwai';

export class TextCortex {
  private readonly client: TextCortexClient;
  public readonly hemingwai: HemingwaiApi;

  constructor(config: TextCortexConfig) {
    this.client = new TextCortexClient(config);
    this.hemingwai = new HemingwaiApi(this.client);
  }

  static fromEnv(): TextCortex {
    const apiKey = process.env.TEXTCORTEX_API_KEY;
    const baseUrl = process.env.TEXTCORTEX_BASE_URL;

    if (!apiKey) {
      throw new Error('TEXTCORTEX_API_KEY environment variable is required');
    }

    return new TextCortex({ apiKey, baseUrl });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): TextCortexClient {
    return this.client;
  }
}

export const Connector = TextCortex;

export { TextCortexClient, DEFAULT_BASE_URL } from './client';
export { HemingwaiApi, HEMINGWAI_PATHS } from './hemingwai';
