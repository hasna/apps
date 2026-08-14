import { encodePathSegment, type TesterArmyClient } from './client';
import type { JsonBody, QueryParams } from '../types';

export class RunsApi {
  constructor(private readonly client: TesterArmyClient) {}

  list(params?: QueryParams): Promise<unknown> {
    return this.client.get('/v1/runs', params);
  }

  get(runId: string, params?: QueryParams): Promise<unknown> {
    return this.client.get(`/v1/runs/${encodePathSegment(runId)}`, params);
  }

  cancel(runId: string, body: JsonBody = {}): Promise<unknown> {
    return this.client.post(`/v1/runs/${encodePathSegment(runId)}/cancel`, body);
  }
}
