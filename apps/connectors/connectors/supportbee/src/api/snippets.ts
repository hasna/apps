import type { ConnectorClient } from './client';
import type { Snippet, SnippetCreateParams, SnippetUpdateParams } from '../types';

export interface SnippetListResponse {
  snippets: Snippet[];
}

export interface SnippetResponse {
  snippet: Snippet;
}

export class SnippetsApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(): Promise<SnippetListResponse> {
    return this.client.get<SnippetListResponse>('/snippets');
  }

  async get(snippetId: number | string): Promise<SnippetResponse> {
    return this.client.get<SnippetResponse>(`/snippets/${snippetId}`);
  }

  async create(params: SnippetCreateParams): Promise<SnippetResponse> {
    return this.client.post<SnippetResponse>('/snippets', { snippet: params });
  }

  async update(snippetId: number | string, params: SnippetUpdateParams): Promise<SnippetResponse> {
    return this.client.put<SnippetResponse>(`/snippets/${snippetId}`, { snippet: params });
  }

  async delete(snippetId: number | string): Promise<void> {
    await this.client.delete(`/snippets/${snippetId}`);
  }
}
