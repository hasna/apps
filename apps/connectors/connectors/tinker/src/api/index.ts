import type { TinkerConfig } from '../types';
import { TinkerClient } from './client';
import { TrainingApi } from './training';
import { SamplingApi } from './sampling';
import { StateApi } from './state';

/**
 * Main Tinker Connector class
 * Provides access to training, sampling, and state management APIs
 */
export class Tinker {
  private readonly client: TinkerClient;

  // Service APIs
  public readonly training: TrainingApi;
  public readonly sampling: SamplingApi;
  public readonly state: StateApi;

  constructor(config: TinkerConfig) {
    this.client = new TinkerClient(config);
    this.training = new TrainingApi(this.client);
    this.sampling = new SamplingApi(this.client);
    this.state = new StateApi(this.client);
  }

  /**
   * Create a client from environment variables
   * Looks for TINKER_API_KEY and optionally TINKER_BASE_URL
   */
  static fromEnv(): Tinker {
    const apiKey = process.env.TINKER_API_KEY;
    const baseUrl = process.env.TINKER_BASE_URL;

    if (!apiKey) {
      throw new Error('TINKER_API_KEY environment variable is required');
    }

    return new Tinker({ apiKey, baseUrl });
  }

  /**
   * Get a preview of the API key (for debugging)
   */
  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  /**
   * Get the base URL
   */
  getBaseUrl(): string {
    return this.client.getBaseUrl();
  }

  /**
   * Get the underlying client for direct API access
   */
  getClient(): TinkerClient {
    return this.client;
  }

  /**
   * Convenience method: Create a LoRA training client and return it
   */
  async createTrainingSession(options: {
    baseModel: string;
    rank?: number;
    alpha?: number;
  }): Promise<{
    clientId: string;
    training: TrainingApi;
    state: StateApi;
  }> {
    const response = await this.training.createLoRATrainingClient(options);
    return {
      clientId: response.clientId,
      training: this.training,
      state: this.state,
    };
  }

  /**
   * Convenience method: Load a saved model for sampling
   */
  async loadModelForSampling(modelPath: string): Promise<{
    clientId: string;
    sampling: SamplingApi;
  }> {
    const response = await this.sampling.createSamplingClient(modelPath);
    return {
      clientId: response.clientId,
      sampling: this.sampling,
    };
  }
}

export { TinkerClient } from './client';
export { TrainingApi } from './training';
export { SamplingApi } from './sampling';
export { StateApi } from './state';
