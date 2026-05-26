import type { UdioConfig, GenerationRequest, ExtendRequest, Generation, GenerationsListResponse } from '../types';
import { UdioClient } from './client';

export class Udio {
  private readonly client: UdioClient;

  constructor(config: UdioConfig) {
    this.client = new UdioClient(config);
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

  static fromEnv(): Udio {
    const apiKey = process.env.UDIO_API_KEY;
    if (!apiKey) {
      throw new Error('UDIO_API_KEY environment variable is required');
    }
    return new Udio({ apiKey });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }
}

export { UdioClient } from './client';
