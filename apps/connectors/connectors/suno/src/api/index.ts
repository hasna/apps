import type { SunoConfig, GenerationRequest, ExtendRequest, Generation, GenerationsListResponse } from '../types';
import { SunoClient } from './client';

export class Suno {
  private readonly client: SunoClient;

  constructor(config: SunoConfig) {
    this.client = new SunoClient(config);
  }

  async createGeneration(params: GenerationRequest): Promise<Generation> {
    return this.client.createGeneration(params);
  }

  async extendGeneration(params: ExtendRequest): Promise<Generation> {
    return this.client.extendGeneration(params);
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

  static fromEnv(): Suno {
    const apiKey = process.env.SUNO_API_KEY;
    if (!apiKey) {
      throw new Error('SUNO_API_KEY environment variable is required');
    }
    return new Suno({ apiKey });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }
}

export { SunoClient } from './client';
