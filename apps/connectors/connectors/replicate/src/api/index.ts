import type {
  ReplicateConfig,
  ReplicateModel,
  ModelsListResponse,
  Prediction,
  PredictionsListResponse,
  CreatePredictionRequest
} from '../types';
import { ReplicateClient } from './client';

export class Replicate {
  private readonly client: ReplicateClient;

  constructor(config: ReplicateConfig) {
    this.client = new ReplicateClient(config);
  }

  static fromEnv(): Replicate {
    const apiKey = process.env.REPLICATE_API_TOKEN;
    if (!apiKey) {
      throw new Error('REPLICATE_API_TOKEN environment variable is required');
    }
    return new Replicate({ apiKey });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  async getModel(owner: string, name: string): Promise<ReplicateModel> {
    return this.client.get<ReplicateModel>(`/models/${owner}/${name}`);
  }

  async listModels(cursor?: string): Promise<ModelsListResponse> {
    return this.client.get<ModelsListResponse>('/models', { cursor });
  }

  async createPrediction(request: CreatePredictionRequest): Promise<Prediction> {
    return this.client.post<Prediction>('/predictions', request);
  }

  async getPrediction(id: string): Promise<Prediction> {
    return this.client.get<Prediction>(`/predictions/${id}`);
  }

  async listPredictions(cursor?: string): Promise<PredictionsListResponse> {
    return this.client.get<PredictionsListResponse>('/predictions', { cursor });
  }

  async cancelPrediction(id: string): Promise<Prediction> {
    return this.client.post<Prediction>(`/predictions/${id}/cancel`);
  }

  async waitForPrediction(id: string, maxWaitMs = 300000, pollIntervalMs = 1000): Promise<Prediction> {
    const startTime = Date.now();
    while (Date.now() - startTime < maxWaitMs) {
      const prediction = await this.getPrediction(id);
      if (['succeeded', 'failed', 'canceled'].includes(prediction.status)) {
        return prediction;
      }
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }
    throw new Error(`Prediction ${id} did not complete within ${maxWaitMs}ms`);
  }

  getClient(): ReplicateClient {
    return this.client;
  }
}

export { ReplicateClient } from './client';
