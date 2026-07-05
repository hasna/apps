import type { ConnectorClient } from './client';
import { encodePathSegment } from './client';
import type { JsonRecord, SnippetListParams, UpsertSnippetParams } from '../types';

export class SnippetsApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(params?: SnippetListParams): Promise<JsonRecord> {
    return this.client.get<JsonRecord>('/snippets', params as Record<string, string | number | boolean | undefined>);
  }

  async upsert(params: UpsertSnippetParams): Promise<JsonRecord> {
    const { snippetId, ...body } = params;
    if (snippetId?.trim()) {
      return this.client.patch<JsonRecord>(`/snippets/${encodePathSegment(snippetId.trim())}`, body);
    }
    return this.client.post<JsonRecord>('/snippets', body);
  }
}
