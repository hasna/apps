// Lingvanex Connector — Machine translation and language detection
import { LingvanexClient } from './client';
import type { LingvanexConfig, LVTranslation, LVDetection, LVLanguage, LVTranslateOptions } from '../types';
export { LingvanexClient } from './client';

export class Lingvanex {
  private readonly client: LingvanexClient;
  constructor(config: LingvanexConfig) { this.client = new LingvanexClient(config); }
  static fromEnv(): Lingvanex {
    const apiKey = process.env.LINGVANEX_API_KEY;
    if (!apiKey) throw new Error('LINGVANEX_API_KEY is required');
    return new Lingvanex({ apiKey });
  }

  async translate(options: LVTranslateOptions): Promise<LVTranslation> {
    return this.client.request<LVTranslation>('/translate', { body: { from: options.from || 'en_GB', to: options.to, data: options.data, platform: options.platform || 'api' } });
  }

  async translateBatch(texts: string[], to: string, from?: string): Promise<{ result: string[] }> {
    return this.client.request('/translate', { body: { from: from || 'en_GB', to, data: texts, platform: 'api' } as Record<string, unknown> });
  }

  async detect(text: string): Promise<LVDetection[]> {
    const result = await this.client.request<{ result: LVDetection[] }>('/detect', { body: { data: text } });
    return result.result;
  }

  async listLanguages(options?: { platform?: string; code?: string }): Promise<{ result: LVLanguage[] }> {
    return this.client.request('/getLanguages', { body: { platform: options?.platform || 'api', code: options?.code || 'en_GB' } });
  }

  getClient(): LingvanexClient { return this.client; }
}
