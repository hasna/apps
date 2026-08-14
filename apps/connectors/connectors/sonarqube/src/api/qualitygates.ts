import type { SonarQubeClient } from './client';
import type { QualityGate, QualityGatesListResponse } from '../types';

export class QualityGatesApi {
  constructor(private readonly client: SonarQubeClient) {}

  async list(): Promise<QualityGatesListResponse> {
    return this.client.get<QualityGatesListResponse>('/api/qualitygates/list');
  }

  async show(id: string): Promise<{ qualityGate: QualityGate }> {
    return this.client.get<{ qualityGate: QualityGate }>('/api/qualitygates/show', { id });
  }
}
