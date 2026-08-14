// Google Translate Connector — Language translation and detection
import { GoogleTranslateClient } from './client';
import type { GoogleTranslateConfig, GTTranslateResponse, GTDetectResponse, GTLanguageResponse } from '../types';
export { GoogleTranslateClient } from './client';

export class GoogleTranslate {
  private readonly client: GoogleTranslateClient;
  constructor(config: GoogleTranslateConfig) { this.client = new GoogleTranslateClient(config); }
  static fromEnv(): GoogleTranslate {
    const apiKey = process.env.GOOGLE_TRANSLATE_API_KEY;
    if (!apiKey) throw new Error('GOOGLE_TRANSLATE_API_KEY is required');
    return new GoogleTranslate({ apiKey });
  }

  async translate(text: string | string[], target: string, options?: { source?: string; format?: 'text' | 'html'; model?: string }): Promise<GTTranslateResponse> {
    const q = Array.isArray(text) ? text : [text];
    return this.client.request<GTTranslateResponse>('', { method: 'POST', body: { q, target, source: options?.source, format: options?.format, model: options?.model } as Record<string, unknown> });
  }

  async detect(text: string | string[]): Promise<GTDetectResponse> {
    const q = Array.isArray(text) ? text : [text];
    return this.client.request<GTDetectResponse>('/detect', { method: 'POST', body: { q } as Record<string, unknown> });
  }

  async listLanguages(target?: string): Promise<GTLanguageResponse> {
    return this.client.request<GTLanguageResponse>('/languages', { params: { target } });
  }

  getClient(): GoogleTranslateClient { return this.client; }
}
