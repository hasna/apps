// Predis AI Connector — AI-powered social media content creation and scheduling
import { PredisAIClient } from './client';
import type { PredisAIConfig, PAPost, PAPostList, PAGeneration, PABrand } from '../types';
export { PredisAIClient } from './client';

export class PredisAI {
  private readonly client: PredisAIClient;
  constructor(config: PredisAIConfig) { this.client = new PredisAIClient(config); }
  static fromEnv(): PredisAI {
    const apiKey = process.env.PREDISAI_API_KEY;
    if (!apiKey) throw new Error('PREDISAI_API_KEY is required');
    return new PredisAI({ apiKey });
  }

  async generatePost(data: { text: string; platform: string; brand_id?: string; media_type?: string }): Promise<PAGeneration> {
    return this.client.request<PAGeneration>('/create_content', { method: 'POST', body: data as Record<string, unknown> });
  }
  async getGeneration(generationId: string): Promise<PAGeneration> { return this.client.request<PAGeneration>(`/creatives/${generationId}`); }

  async listPosts(options?: { page?: number; platform?: string }): Promise<PAPostList> {
    return this.client.request<PAPostList>('/posts', { params: { page: options?.page, platform: options?.platform } });
  }
  async schedulePost(data: { creative_id: string; platform: string; scheduled_at: string; caption?: string }): Promise<PAPost> {
    return this.client.request<PAPost>('/schedule', { method: 'POST', body: data as Record<string, unknown> });
  }

  async listBrands(): Promise<PABrand[]> { return this.client.request<PABrand[]>('/brands'); }
  async createBrand(data: { name: string; description?: string; colors?: string[]; website?: string }): Promise<PABrand> {
    return this.client.request<PABrand>('/brands', { method: 'POST', body: data as Record<string, unknown> });
  }

  getClient(): PredisAIClient { return this.client; }
}
