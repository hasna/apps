import type { ConnectorClient } from './client';
import type { HttpMethod, RawResult } from '../types';

export interface RawRequestParams {
  method?: HttpMethod;
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
}

/**
 * Syntropy Raw API access.
 * A thin escape hatch for calling arbitrary Syntropy endpoints not yet modeled
 * as first-class resources. Surfaces the HTTP status and body without throwing.
 */
export class RawApi {
  constructor(private readonly client: ConnectorClient) {}

  async request(params: RawRequestParams): Promise<RawResult> {
    const { method = 'GET', path, query, body } = params;
    const result = await this.client.rawRequest(method, path, { query, body });
    return {
      status: result.status,
      ok: result.ok,
      data: result.data,
      stub: result.stub,
    };
  }
}
