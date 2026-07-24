import type { UsereframeClient } from './client';
import { encodePathSegment } from './client';
import type { QueryParams } from '../types';

export class BomsApi {
  constructor(private readonly client: UsereframeClient) {}

  list(params?: QueryParams): Promise<unknown> {
    return this.client.get('/boms', params);
  }

  get(bomId: string): Promise<unknown> {
    return this.client.get(`/boms/${encodePathSegment(bomId)}`);
  }

  upload(body: Record<string, unknown>): Promise<unknown> {
    return this.client.post('/boms', body);
  }

  requestQuotes(bomId: string, body: Record<string, unknown> = {}): Promise<unknown> {
    return this.client.post(`/boms/${encodePathSegment(bomId)}/quotes`, body);
  }
}
