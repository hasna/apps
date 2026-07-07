import type { SonarQubeClient } from './client';
import type { RulesSearchResponse } from '../types';

export class RulesApi {
  constructor(private readonly client: SonarQubeClient) {}

  async search(options?: {
    q?: string;
    languages?: string | string[];
    repositories?: string | string[];
    tags?: string | string[];
    severities?: string | string[];
    statuses?: string | string[];
    types?: string | string[];
    activation?: boolean;
    p?: number;
    ps?: number;
  }): Promise<RulesSearchResponse> {
    return this.client.get<RulesSearchResponse>('/api/rules/search', options);
  }
}
