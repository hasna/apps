import type { ConnectorClient } from './client';
import type { IntegrationListResponse, IntegrationResponse, ListParams } from '../types';

export class IntegrationsApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(params?: ListParams): Promise<IntegrationListResponse> {
    return this.client.get<IntegrationListResponse>('/integrations', params as Record<string, string | number>);
  }

  async connect(body: Record<string, unknown>): Promise<IntegrationResponse> {
    return this.client.post<IntegrationResponse>('/integrations/connect', body);
  }
}
