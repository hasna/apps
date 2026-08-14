import type { SonarQubeClient } from './client';
import type { QualityProfilesSearchResponse } from '../types';

export class QualityProfilesApi {
  constructor(private readonly client: SonarQubeClient) {}

  async search(options?: {
    language?: string;
    project?: string;
    qualityProfile?: string;
    defaults?: boolean;
  }): Promise<QualityProfilesSearchResponse> {
    return this.client.get<QualityProfilesSearchResponse>('/api/qualityprofiles/search', options);
  }
}
