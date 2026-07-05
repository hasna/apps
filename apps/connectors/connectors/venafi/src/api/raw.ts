import type { ConnectorClient, RequestOptions } from './client';

export interface RawRequestParams {
  path: string;
  method?: RequestOptions['method'];
  query?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | unknown[] | string;
  headers?: Record<string, string>;
}

export class RawApi {
  constructor(private readonly client: ConnectorClient) {}

  /** Arbitrary Venafi API request */
  async request(params: RawRequestParams): Promise<unknown> {
    const { path, method = 'GET', query, body, headers } = params;
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return this.client.request(normalizedPath, { method, params: query, body, headers });
  }
}
