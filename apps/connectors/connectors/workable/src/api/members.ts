import type { ConnectorClient } from './client';
import type { Member, WorkableListResponse } from '../types';

export class MembersApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(): Promise<WorkableListResponse<Member>> {
    return this.client.get<WorkableListResponse<Member>>('/members');
  }

  async listRecruiters(): Promise<WorkableListResponse<Member>> {
    return this.client.get<WorkableListResponse<Member>>('/recruiters');
  }
}
