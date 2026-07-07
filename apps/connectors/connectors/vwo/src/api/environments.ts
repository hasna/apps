import type { ConnectorClient } from './client';
import type { Environment, EnvironmentCreateParams } from '../types';

export class EnvironmentsApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(): Promise<unknown> {
    return this.client.get('/environments');
  }

  async get(id: string | number): Promise<Environment> {
    return this.client.get<Environment>(`/environments/${encodeURIComponent(String(id))}`);
  }

  async create(data: EnvironmentCreateParams): Promise<Environment> {
    return this.client.post<Environment>('/environments', data);
  }

  async delete(id: string | number): Promise<unknown> {
    return this.client.delete(`/environments/${encodeURIComponent(String(id))}`);
  }
}
