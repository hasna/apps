import type { SonarQubeClient } from './client';
import type { UserGroupsSearchResponse } from '../types';

export class GroupsApi {
  constructor(private readonly client: SonarQubeClient) {}

  async search(options?: {
    q?: string;
    p?: number;
    ps?: number;
  }): Promise<UserGroupsSearchResponse> {
    return this.client.get<UserGroupsSearchResponse>('/api/user_groups/search', options);
  }
}
