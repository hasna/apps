import type { ConnectorClient } from './client';
import type { Document, DocumentListResponse, ListParams } from '../types';

export class DocumentsApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(params?: ListParams): Promise<DocumentListResponse> {
    return this.client.get<DocumentListResponse>('/documents', params);
  }

  async get(id: string): Promise<Document> {
    return this.client.get<Document>(`/documents/${encodeURIComponent(id)}`);
  }

  async create(body: Record<string, unknown>): Promise<Document> {
    return this.client.post<Document>('/documents', body);
  }
}
