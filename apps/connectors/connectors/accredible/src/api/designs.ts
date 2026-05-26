import type { ConnectorClient } from './client';
import type { DesignListResponse, ListParams } from '../types';

export class DesignsApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(params?: ListParams): Promise<DesignListResponse> {
    return this.client.get<DesignListResponse>('/issuer/all_designs', params as Record<string, string | number | boolean | undefined>);
  }
}
