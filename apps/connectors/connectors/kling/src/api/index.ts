import type { KlingConfig, GenerationRequest, ImageToVideoRequest, Generation, GenerationsListResponse } from '../types';
import { KlingClient } from './client';

export class Kling {
  private readonly client: KlingClient;

  constructor(config: KlingConfig) {
    this.client = new KlingClient(config);
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

  static fromEnv(): Kling {
    const apiKey = process.env.KLING_API_KEY;
    if (!apiKey) {
      throw new Error('KLING_API_KEY environment variable is required');
    }
    return new Kling({ apiKey });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }
}

export { KlingClient } from './client';
