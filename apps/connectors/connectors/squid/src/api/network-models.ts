import type { ListParams, ModelVersion, NetworkModel } from '../types';
import type { ConnectorClient } from './client';

export class NetworkModelsApi {
  constructor(private readonly client: ConnectorClient) {}

  list(params?: ListParams): Promise<NetworkModel[] | { data: NetworkModel[] }> {
    return this.client.get('/network-models', params);
  }

  get(modelId: string): Promise<NetworkModel> {
    return this.client.get(`/network-models/${encodeURIComponent(modelId)}`);
  }

  listVersions(modelId: string, params?: ListParams): Promise<ModelVersion[] | { data: ModelVersion[] }> {
    return this.client.get(`/network-models/${encodeURIComponent(modelId)}/versions`, params);
  }
}
