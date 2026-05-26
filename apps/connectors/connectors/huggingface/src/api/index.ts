import type { HuggingFaceConfig } from '../types';
import { HuggingFaceClient } from './client';
import { ModelsApi } from './models';
import { InferenceApi } from './inference';
import { DatasetsApi } from './datasets';
import { SpacesApi } from './spaces';

/**
 * Main HuggingFace API class
 */
export class HuggingFace {
  private readonly client: HuggingFaceClient;

  public readonly models: ModelsApi;
  public readonly inference: InferenceApi;
  public readonly datasets: DatasetsApi;
  public readonly spaces: SpacesApi;

  constructor(config: HuggingFaceConfig) {
    this.client = new HuggingFaceClient(config);
    this.models = new ModelsApi(this.client);
    this.inference = new InferenceApi(this.client);
    this.datasets = new DatasetsApi(this.client);
    this.spaces = new SpacesApi(this.client);
  }

  static fromEnv(): HuggingFace {
    const apiKey = process.env.HUGGINGFACE_API_KEY || process.env.HF_TOKEN;
    const apiSecret = process.env.HUGGINGFACE_API_SECRET;
    if (!apiKey) throw new Error('HUGGINGFACE_API_KEY or HF_TOKEN environment variable is required');
    return new HuggingFace({ apiKey, apiSecret });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): HuggingFaceClient {
    return this.client;
  }
}

export { HuggingFaceClient } from './client';
export { ModelsApi } from './models';
export { InferenceApi } from './inference';
export { DatasetsApi } from './datasets';
export { SpacesApi } from './spaces';
