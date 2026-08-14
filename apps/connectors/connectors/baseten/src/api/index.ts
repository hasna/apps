import type { BasetenConfig, ModelsResponse, PredictionRequest, PredictionResponse } from '../types';
import { BasetenClient } from './client';

export class Baseten {
  private readonly client: BasetenClient;

  constructor(config: BasetenConfig) {
    this.client = new BasetenClient(config);
  }

  static fromEnv(): Baseten {
    const apiKey = process.env.BASETEN_API_KEY;
    if (!apiKey) {
      throw new Error('BASETEN_API_KEY environment variable is required');
    }
    return new Baseten({ apiKey });
  }

  async listModels(): Promise<ModelsResponse> {
    return this.client.listModels();
  }

  async getModel(modelId: string): Promise<{ model: unknown }> {
    return this.client.getModel(modelId);
  }

  async predict(request: PredictionRequest): Promise<PredictionResponse> {
    return this.client.predict(request);
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): BasetenClient {
    return this.client;
  }
}

export { BasetenClient } from './client';
