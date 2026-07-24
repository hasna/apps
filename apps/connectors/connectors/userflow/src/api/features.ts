import type { UserflowClient } from './client';
import type { CursorListParams } from '../types';
import { encodeResourceId } from './helpers';

export class FeaturesApi {
  constructor(private readonly client: UserflowClient) {}

  async listFeatures(params: CursorListParams = {}): Promise<unknown> {
    return this.client.get('/v2/features', params);
  }

  async getFeature(id: string): Promise<unknown> {
    return this.client.get(`/v2/features/${encodeResourceId(id)}`);
  }

  async getFeatureUsage(
    id: string,
    params: {
      user_id?: string;
      group_id?: string;
      created_after?: string;
      created_before?: string;
    } = {},
  ): Promise<unknown> {
    return this.client.get(`/v2/features/${encodeResourceId(id)}/usage`, params);
  }
}
