import type { MetadataSearchRequest, SearchDataRequest } from '../types';
import type { ConnectorClient } from './client';

export class SearchApi {
  constructor(private readonly client: ConnectorClient) {}

  /** Search metadata objects (liveboards, answers, worksheets, etc.). */
  async metadata(body: MetadataSearchRequest): Promise<unknown> {
    return this.client.post('/metadata/search', body);
  }

  /** Run an analytics search query (natural language / structured). */
  async data(body: SearchDataRequest): Promise<unknown> {
    return this.client.post('/searchdata', body);
  }

  /**
   * Generic search — routes to /searchdata when query_string is present,
   * otherwise POST /metadata/search.
   */
  async search(body: MetadataSearchRequest & SearchDataRequest): Promise<unknown> {
    if (body.query_string) {
      return this.data(body);
    }
    return this.metadata(body);
  }
}
