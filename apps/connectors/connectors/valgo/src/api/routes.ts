import type { ConnectorClient } from './client';
import { encodePathSegment } from './client';
import type { ListParams } from '../types';

export class RoutesApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(params?: ListParams): Promise<unknown> {
    return this.client.get('/routes', params);
  }

  async get(routeId: string): Promise<unknown> {
    return this.client.get(`/routes/${encodePathSegment(routeId)}`);
  }
}
