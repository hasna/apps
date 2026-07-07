import type { Asset, ListParams } from '../types';
import type { ConnectorClient } from './client';

export class AssetsApi {
  constructor(private readonly client: ConnectorClient) {}

  list(params?: ListParams): Promise<Asset[] | { data: Asset[] }> {
    return this.client.get('/assets', params);
  }
}
