import type { XAIGrokClient } from './client';
import type { ModelsResponse } from '../types';

export class ModelsApi {
  constructor(private readonly client: XAIGrokClient) {}

  list(): Promise<ModelsResponse> {
    return this.client.get<ModelsResponse>('/models');
  }

  get(model: string): Promise<unknown> {
    return this.client.get(`/models/${encodeURIComponent(model)}`);
  }
}
