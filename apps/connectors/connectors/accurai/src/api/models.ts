import type { ConnectorClient } from './client';
import type { ModelListResponse, ModelResponse } from '../types';

export class ModelsApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(): Promise<ModelListResponse> {
    return this.client.get<ModelListResponse>('/models');
  }

  async get(id: string): Promise<ModelResponse> {
    return this.client.get<ModelResponse>(`/models/${id}`);
  }
}
