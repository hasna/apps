import type { ConnectorClient } from './client';
import type { PredictionListResponse, PredictionResponse, ListParams } from '../types';

export class PredictionsApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(params?: ListParams & { document_id?: string; status?: string }): Promise<PredictionListResponse> {
    return this.client.get<PredictionListResponse>('/predictions', params as Record<string, string | number>);
  }

  async get(id: string): Promise<PredictionResponse> {
    return this.client.get<PredictionResponse>(`/predictions/${id}`);
  }

  async create(params: { document_id: string; model_id?: string }): Promise<PredictionResponse> {
    return this.client.post<PredictionResponse>('/predictions', params);
  }
}
