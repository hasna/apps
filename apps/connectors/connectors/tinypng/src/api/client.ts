import type { ShrinkRequest, ShrinkResult, TinypngConfig } from '../types';
import { TinypngApiError } from '../types';

const DEFAULT_BASE_URL = 'https://api.tinify.com';

export class TinypngClient {
  private readonly apiKey: string;
  private readonly authHeader: string;
  private readonly baseUrl: string;

  constructor(config: TinypngConfig) {
    if (!config.apiKey) {
      throw new Error('TinyPNG API key is required');
    }
    this.apiKey = config.apiKey;
    this.authHeader = `Basic ${btoa(`api:${config.apiKey}`)}`;
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  }

  async shrink(body: ShrinkRequest): Promise<ShrinkResult> {
    const response = await fetch(`${this.baseUrl}/shrink`, {
      method: 'POST',
      headers: {
        Authorization: this.authHeader,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    });

    const text = await response.text();
    let data: ShrinkResult = {};
    if (text) {
      try {
        data = JSON.parse(text) as ShrinkResult;
      } catch {
        data = { message: text };
      }
    }

    if (!response.ok) {
      const message = data.error || data.message || response.statusText || 'TinyPNG API request failed';
      throw new TinypngApiError(message, response.status);
    }

    return {
      ...data,
      location: response.headers.get('Location') ?? undefined,
      compressionCount: response.headers.get('Compression-Count') ?? undefined,
    };
  }

  getApiKeyPreview(): string {
    if (this.apiKey.length > 10) {
      return `${this.apiKey.substring(0, 6)}...${this.apiKey.substring(this.apiKey.length - 4)}`;
    }
    return '***';
  }
}
