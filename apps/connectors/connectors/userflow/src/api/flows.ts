import type { UserflowClient } from './client';
import type { CursorListParams } from '../types';
import { encodeResourceId } from './helpers';

export class FlowsApi {
  constructor(private readonly client: UserflowClient) {}

  async listFlows(
    params: CursorListParams & { state?: string } = {},
  ): Promise<unknown> {
    return this.client.get('/v2/flows', params);
  }

  async getFlow(id: string): Promise<unknown> {
    return this.client.get(`/v2/flows/${encodeResourceId(id)}`);
  }

  async startFlowForUser(options: {
    flow_id: string;
    user_id: string;
    idempotency_key?: string;
  }): Promise<unknown> {
    const { flow_id, user_id, idempotency_key } = options;
    return this.client.post(`/v2/flows/${encodeResourceId(flow_id)}/start`, {
      user_id,
      idempotency_key,
    });
  }

  async listFlowProgress(
    flow_id: string,
    params: CursorListParams = {},
  ): Promise<unknown> {
    return this.client.get(`/v2/flows/${encodeResourceId(flow_id)}/progress`, params);
  }
}
