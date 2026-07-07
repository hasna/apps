import type { ConnectorClient } from './client';
import type { Metric, MetricCreateParams } from '../types';

export class MetricsApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(): Promise<unknown> {
    return this.client.get('/metrics');
  }

  async create(data: MetricCreateParams): Promise<Metric> {
    return this.client.post<Metric>('/metrics', data);
  }

  async delete(id: string | number): Promise<unknown> {
    return this.client.delete(`/metrics/${encodeURIComponent(String(id))}`);
  }
}
