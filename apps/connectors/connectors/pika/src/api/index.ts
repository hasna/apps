import type { PikaConfig, GenerateVideoRequest, ImageToVideoRequest, VideoGeneration, GenerateResponse } from '../types';
import { PikaClient } from './client';

export class Pika {
  private readonly client: PikaClient;

  constructor(config: PikaConfig) {
    this.client = new PikaClient(config);
  }

  async generateVideo(params: GenerateVideoRequest): Promise<GenerateResponse> {
    return this.client.generateVideo(params);
  }

  async imageToVideo(params: ImageToVideoRequest): Promise<GenerateResponse> {
    return this.client.imageToVideo(params);
  }

  async getGeneration(generationId: string): Promise<VideoGeneration> {
    return this.client.getGeneration(generationId);
  }

  async cancelGeneration(generationId: string): Promise<void> {
    return this.client.cancelGeneration(generationId);
  }

  static fromEnv(): Pika {
    const apiKey = process.env.PIKA_API_KEY;
    if (!apiKey) {
      throw new Error('PIKA_API_KEY environment variable is required');
    }
    return new Pika({ apiKey });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }
}

export { PikaClient } from './client';
