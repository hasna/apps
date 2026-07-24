import type { ConnectorClient } from './client';
import type {
  CreateDocumentParams,
  DocumentListResponse,
  DocumentResponse,
  ListParams,
} from '../types';

export class DocumentsApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(params?: ListParams): Promise<DocumentListResponse> {
    return this.client.get<DocumentListResponse>('/documents', params);
  }

  async get(id: string): Promise<DocumentResponse> {
    return this.client.get<DocumentResponse>(`/documents/${encodeURIComponent(id)}`);
  }

  async create(params: CreateDocumentParams): Promise<DocumentResponse> {
    return this.client.post<DocumentResponse>('/documents', params);
  }
}
