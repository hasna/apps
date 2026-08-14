import { encodePathSegment, type TesterArmyClient } from './client';
import type { JsonBody, QueryParams } from '../types';

export class TestsApi {
  constructor(private readonly client: TesterArmyClient) {}

  list(params?: QueryParams): Promise<unknown> {
    return this.client.get('/v1/tests', params);
  }

  create(body: JsonBody): Promise<unknown> {
    return this.client.post('/v1/tests', body);
  }

  get(testId: string, params?: QueryParams): Promise<unknown> {
    return this.client.get(`/v1/tests/${encodePathSegment(testId)}`, params);
  }

  update(testId: string, body: JsonBody): Promise<unknown> {
    return this.client.patch(`/v1/tests/${encodePathSegment(testId)}`, body);
  }

  delete(testId: string): Promise<unknown> {
    return this.client.delete(`/v1/tests/${encodePathSegment(testId)}`);
  }

  triggerRun(testId: string, body: JsonBody = {}): Promise<unknown> {
    return this.client.post(`/v1/tests/${encodePathSegment(testId)}/runs`, body);
  }
}
