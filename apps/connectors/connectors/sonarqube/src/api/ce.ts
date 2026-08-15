import type { SonarQubeClient } from './client';
import type { CeActivityResponse, CeAnalysisStatus } from '../types';

export class CeApi {
  constructor(private readonly client: SonarQubeClient) {}

  async activity(options?: {
    component?: string;
    status?: string | string[];
    type?: string | string[];
    onlyCurrents?: boolean;
    p?: number;
    ps?: number;
  }): Promise<CeActivityResponse> {
    return this.client.get<CeActivityResponse>('/api/ce/activity', options);
  }

  async analysisStatus(options: {
    component: string;
    branch?: string;
    pullRequest?: string;
  }): Promise<CeAnalysisStatus> {
    return this.client.get<CeAnalysisStatus>('/api/ce/analysis_status', options);
  }
}
