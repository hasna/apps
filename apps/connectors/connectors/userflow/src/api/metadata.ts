import type { UserflowClient } from './client';
import type { CursorListParams, EntityType } from '../types';
import { assertEntity, encodeResourceId } from './helpers';

export class AttributesApi {
  constructor(private readonly client: UserflowClient) {}

  async listAttributes(
    params: CursorListParams & { entity?: EntityType } = {},
  ): Promise<unknown> {
    assertEntity(params.entity);
    return this.client.get('/v2/attributes', params);
  }
}

export class SegmentsApi {
  constructor(private readonly client: UserflowClient) {}

  async listSegments(
    params: CursorListParams & { entity?: EntityType } = {},
  ): Promise<unknown> {
    assertEntity(params.entity);
    return this.client.get('/v2/segments', params);
  }

  async getSegment(id: string): Promise<unknown> {
    return this.client.get(`/v2/segments/${encodeResourceId(id)}`);
  }

  async listSegmentMembers(
    id: string,
    params: CursorListParams = {},
  ): Promise<unknown> {
    return this.client.get(`/v2/segments/${encodeResourceId(id)}/members`, params);
  }
}
