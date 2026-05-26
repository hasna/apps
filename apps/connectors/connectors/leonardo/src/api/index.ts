import type {
  LeonardoConfig,
  GenerateRequest,
  GenerateResponse,
  GetGenerationResponse,
  ListGenerationsResponse,
  ListPlatformModelsResponse,
  ListModelsResponse,
  VariationRequest,
  VariationResponse,
  UserInfo,
} from '../types';
import { LeonardoClient } from './client';

export class Leonardo {
  private readonly client: LeonardoClient;

  constructor(config: LeonardoConfig) {
    this.client = new LeonardoClient(config);
  }

  async generate(params: GenerateRequest): Promise<GenerateResponse> {
    return this.client.generate(params);
  }

  async getGeneration(generationId: string): Promise<GetGenerationResponse> {
    return this.client.getGeneration(generationId);
  }

  async listGenerations(userId: string, limit?: number, offset?: number): Promise<ListGenerationsResponse> {
    return this.client.listGenerations(userId, limit, offset);
  }

  async listModels(): Promise<ListPlatformModelsResponse> {
    return this.client.listModels();
  }

  async listCustomModels(userId: string): Promise<ListModelsResponse> {
    return this.client.listCustomModels(userId);
  }

  async createVariation(params: VariationRequest): Promise<VariationResponse> {
    return this.client.createVariation(params);
  }

  async getUser(): Promise<UserInfo> {
    return this.client.getUser();
  }

  static fromEnv(): Leonardo {
    const apiKey = process.env.LEONARDO_API_KEY;
    if (!apiKey) {
      throw new Error('LEONARDO_API_KEY environment variable is required');
    }
    return new Leonardo({ apiKey });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }
}

export { LeonardoClient } from './client';
