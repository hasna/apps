// RiteKit Connector — Social media hashtag suggestions and content optimization
import { RiteKitClient } from './client';
import type { RiteKitConfig, RKHashtagSuggestion, RKAutoHashtag, RKImageText } from '../types';
export { RiteKitClient } from './client';

export class RiteKit {
  private readonly client: RiteKitClient;
  constructor(config: RiteKitConfig) { this.client = new RiteKitClient(config); }
  static fromEnv(): RiteKit {
    const clientId = process.env.RITEKIT_CLIENT_ID;
    if (!clientId) throw new Error('RITEKIT_CLIENT_ID is required');
    return new RiteKit({ clientId });
  }

  async suggestHashtags(text: string): Promise<{ data: RKHashtagSuggestion[] }> {
    return this.client.request('/search/trending', { tag: text });
  }

  async getHashtagStats(hashtag: string): Promise<{ data: RKHashtagSuggestion }> {
    return this.client.request('/stats/hashtag-stats', { tags: hashtag });
  }

  async autoHashtag(text: string, options?: { maxHashtags?: number }): Promise<RKAutoHashtag> {
    return this.client.request<RKAutoHashtag>('/stats/auto-hashtag', { post: text, maxHashtags: options?.maxHashtags });
  }

  async getHistoryForHashtag(hashtag: string): Promise<{ data: { date: string; tweets: number; retweets: number }[] }> {
    return this.client.request('/stats/history', { tag: hashtag });
  }

  async textToImage(text: string, options?: { fontSize?: number; textColor?: string; bgColor?: string }): Promise<RKImageText> {
    return this.client.request<RKImageText>('/images/quote', { quote: text, fontSize: options?.fontSize, textColor: options?.textColor, backgroundColor: options?.bgColor });
  }

  async animateImage(url: string, type: string): Promise<{ url: string }> {
    return this.client.request('/images/animate', { url, type });
  }

  getClient(): RiteKitClient { return this.client; }
}
