import type { ApiEnvelope } from '../types';
import type { TotalisClient } from './client';
import { encodePathSegment } from './client';

export interface ListParlaysParams {
  status?: string;
  include?: 'quotes';
  cursor?: string;
  limit?: number;
}

export class ParlaysApi {
  constructor(private readonly client: TotalisClient) {}

  list(params?: ListParlaysParams): Promise<ApiEnvelope<unknown>> {
    return this.client.get<ApiEnvelope<unknown>>(
      '/v1/rfqs',
      params as Record<string, string | number | boolean | undefined> | undefined,
    );
  }

  get(id: string): Promise<ApiEnvelope<unknown>> {
    return this.client.get<ApiEnvelope<unknown>>(`/v1/rfqs/${encodePathSegment(id)}`);
  }
}
