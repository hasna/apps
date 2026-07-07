import type { SonarQubeClient } from './client';
import type { ComponentMeasures } from '../types';

export class MeasuresApi {
  constructor(private readonly client: SonarQubeClient) {}

  async component(options: {
    component: string;
    metricKeys: string | string[];
    branch?: string;
    additionalFields?: string | string[];
  }): Promise<ComponentMeasures> {
    return this.client.get<ComponentMeasures>('/api/measures/component', options);
  }

  async search(options: {
    projectKeys: string | string[];
    metricKeys: string | string[];
    p?: number;
    ps?: number;
  }): Promise<{ measures: ComponentMeasures[]; paging?: { pageIndex: number; pageSize: number; total: number } }> {
    return this.client.get('/api/measures/search', options);
  }
}
