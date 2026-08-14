import type { UploadcareClient } from './client';
import type { UploadcareGroup, UploadcareGroupList } from '../types';

function groupPath(uuid: string): string {
  return `/groups/${encodeURIComponent(uuid)}`;
}

export class GroupsApi {
  constructor(private readonly client: UploadcareClient) {}

  async list(params?: {
    limit?: number;
    from?: string;
    to?: string;
    ordering?: string;
  }): Promise<UploadcareGroupList> {
    return this.client.get<UploadcareGroupList>('/groups', params);
  }

  async get(uuid: string): Promise<UploadcareGroup> {
    return this.client.get<UploadcareGroup>(groupPath(uuid));
  }

  async delete(uuid: string): Promise<void> {
    await this.client.delete(groupPath(uuid));
  }
}
