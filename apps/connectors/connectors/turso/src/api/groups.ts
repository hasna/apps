import type { TursoClient } from './client';
import type { Group, GroupListResponse } from '../types';

export class GroupsApi {
  constructor(private readonly client: TursoClient) {}

  list(): Promise<GroupListResponse> {
    return this.client.get<GroupListResponse>(this.client.orgPath('/groups'));
  }

  get(groupName: string): Promise<{ group: Group }> {
    const encoded = encodeURIComponent(groupName);
    return this.client.get<{ group: Group }>(this.client.orgPath(`/groups/${encoded}`));
  }
}
