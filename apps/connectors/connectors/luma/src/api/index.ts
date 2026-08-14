import type { LumaConfig, GenerationRequest, ImageToVideoRequest, Generation, GenerationsListResponse } from '../types';
import { LumaClient } from './client';

export class Luma {
  private readonly client: LumaClient;

  constructor(config: LumaConfig) {
    this.client = new LumaClient(config);
  }

  async createGeneration(params: GenerationRequest): Promise<Generation> {
    return this.client.createGeneration(params);
  }

  async imageToVideo(params: ImageToVideoRequest): Promise<Generation> {
    return this.client.imageToVideo(params);
  }

  async getGeneration(generationId: string): Promise<Generation> {
    return this.client.getGeneration(generationId);
  }

  async listGenerations(limit?: number, offset?: number): Promise<GenerationsListResponse> {
    return this.client.listGenerations(limit, offset);
  }

  async deleteGeneration(generationId: string): Promise<void> {
    return this.client.deleteGeneration(generationId);
  }

  static fromEnv(): Luma {
    const apiKey = process.env.LUMA_API_KEY || process.env.LUMAAI_API_KEY;
    if (!apiKey) {
      throw new Error('LUMA_API_KEY environment variable is required');
    }
    return new Luma({ apiKey });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }
}

export { LumaClient } from './client';
