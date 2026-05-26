// AltText.ai Connector — AI-powered alt text generation for images
import { AltTextAiClient } from './client';
import type { AltTextAiConfig, AltTextResult, AltTextAccount, AltTextAsset, AltTextAssetList } from '../types';
export { AltTextAiClient } from './client';

export class AltTextAi {
  private readonly client: AltTextAiClient;
  constructor(config: AltTextAiConfig) { this.client = new AltTextAiClient(config); }
  static fromEnv(): AltTextAi {
    const apiKey = process.env.ALTTEXTAI_API_KEY;
    if (!apiKey) throw new Error('ALTTEXTAI_API_KEY is required');
    return new AltTextAi({ apiKey });
  }

  async generate(imageUrl: string, options?: { lang?: string; keywords?: string[]; keyword_limit?: number; ecommerce_mode?: boolean }): Promise<AltTextResult> {
    return this.client.request<AltTextResult>('/images', { method: 'POST', body: { image: { url: imageUrl }, ...options } as Record<string, unknown> });
  }

  async getAsset(assetId: string): Promise<AltTextAsset> { return this.client.request<AltTextAsset>(`/images/${assetId}`); }

  async listAssets(options?: { page?: number; per_page?: number }): Promise<AltTextAssetList> {
    return this.client.request<AltTextAssetList>('/images', { params: { page: options?.page, per_page: options?.per_page } });
  }

  async getAccount(): Promise<AltTextAccount> { return this.client.request<AltTextAccount>('/account'); }

  getClient(): AltTextAiClient { return this.client; }
}
