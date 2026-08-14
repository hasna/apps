import type { ConnectorClient } from './client';
import { encodePathSegment } from './client';
import type { ListParams } from '../types';

export class SimulationsApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(params?: ListParams): Promise<unknown> {
    return this.client.get('/simulations', params);
  }

  async get(simulationId: string): Promise<unknown> {
    return this.client.get(`/simulations/${encodePathSegment(simulationId)}`);
  }

  async create(body: Record<string, unknown>): Promise<unknown> {
    return this.client.post('/simulations', body);
  }

  async getLossEstimate(simulationId: string): Promise<unknown> {
    return this.client.get(`/simulations/${encodePathSegment(simulationId)}/loss-estimate`);
  }
}
