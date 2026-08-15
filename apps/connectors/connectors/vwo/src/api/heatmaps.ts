import type { ConnectorClient } from './client';
import type { Heatmap, HeatmapListParams } from '../types';

export class HeatmapsApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(params?: HeatmapListParams): Promise<unknown> {
    return this.client.get('/heatmaps', params);
  }

  async get(id: string | number): Promise<Heatmap> {
    return this.client.get<Heatmap>(`/heatmaps/${encodeURIComponent(String(id))}`);
  }
}
