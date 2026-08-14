import type { ConnectorClient } from './client';
import type { DocumentListResponse, DocumentResponse, ListParams } from '../types';

export class DocumentsApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(params?: ListParams): Promise<DocumentListResponse> {
    return this.client.get<DocumentListResponse>('/documents', params as Record<string, string | number>);
  }

  async get(id: string): Promise<DocumentResponse> {
    return this.client.get<DocumentResponse>(`/documents/${id}`);
  }

  async upload(params: { name: string; file_type: string; model_id?: string }): Promise<DocumentResponse> {
    return this.client.post<DocumentResponse>('/documents', params);
  }

  async delete(id: string): Promise<void> {
    await this.client.delete(`/documents/${id}`);
  }
}
