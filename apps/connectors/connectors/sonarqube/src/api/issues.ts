import type { SonarQubeClient } from './client';
import type { IssuesSearchResponse } from '../types';

export class IssuesApi {
  constructor(private readonly client: SonarQubeClient) {}

  async search(options?: {
    componentKeys?: string | string[];
    branch?: string;
    severities?: string | string[];
    statuses?: string | string[];
    types?: string | string[];
    rules?: string | string[];
    tags?: string | string[];
    resolved?: boolean;
    p?: number;
    ps?: number;
    facets?: string | string[];
    additionalFields?: string | string[];
    s?: string;
    asc?: boolean;
    createdAfter?: string;
    createdBefore?: string;
    projectKeys?: string | string[];
  }): Promise<IssuesSearchResponse> {
    return this.client.get<IssuesSearchResponse>('/api/issues/search', options);
  }
}
