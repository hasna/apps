import { encodePathSegment, type TesterArmyClient } from './client';
import type { JsonBody, QueryParams } from '../types';

export class GroupsApi {
  constructor(private readonly client: TesterArmyClient) {}

  list(params?: QueryParams): Promise<unknown> {
    return this.client.get('/v1/groups', params);
  }

  create(body: JsonBody): Promise<unknown> {
    return this.client.post('/v1/groups', body);
  }

  get(groupId: string, params?: QueryParams): Promise<unknown> {
    return this.client.get(`/v1/groups/${encodePathSegment(groupId)}`, params);
  }

  update(groupId: string, body: JsonBody): Promise<unknown> {
    return this.client.patch(`/v1/groups/${encodePathSegment(groupId)}`, body);
  }

  delete(groupId: string): Promise<unknown> {
    return this.client.delete(`/v1/groups/${encodePathSegment(groupId)}`);
  }

  addTest(groupId: string, body: JsonBody): Promise<unknown> {
    return this.client.post(`/v1/groups/${encodePathSegment(groupId)}/tests`, body);
  }

  removeTest(groupId: string, testId: string): Promise<unknown> {
    return this.client.delete(
      `/v1/groups/${encodePathSegment(groupId)}/tests/${encodePathSegment(testId)}`,
    );
  }

  triggerRun(groupId: string, body: JsonBody = {}): Promise<unknown> {
    return this.client.post(`/v1/groups/${encodePathSegment(groupId)}/runs`, body);
  }
}
