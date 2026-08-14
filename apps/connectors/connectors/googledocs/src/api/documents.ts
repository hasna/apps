import type { GoogleDocsClient } from './client';
import type { Document, BatchUpdateRequest, BatchUpdateResponse, Request } from '../types';

/**
 * Documents API - Core document operations
 * https://developers.google.com/docs/api/reference/rest/v1/documents
 */
export class DocumentsApi {
  constructor(private readonly client: GoogleDocsClient) {}

  /**
   * Get a document by ID
   * @param documentId The ID of the document to retrieve
   * @param suggestionsViewMode How suggestions should be presented
   */
  async get(
    documentId: string,
    suggestionsViewMode?: 'DEFAULT_FOR_CURRENT_ACCESS' | 'SUGGESTIONS_INLINE' | 'PREVIEW_SUGGESTIONS_ACCEPTED' | 'PREVIEW_WITHOUT_SUGGESTIONS'
  ): Promise<Document> {
    const params: Record<string, string | undefined> = {};
    if (suggestionsViewMode) {
      params.suggestionsViewMode = suggestionsViewMode;
    }
    return this.client.get<Document>(`/documents/${documentId}`, params);
  }

  /**
   * Create a new document
   * @param title The title of the new document
   */
  async create(title: string): Promise<Document> {
    return this.client.post<Document>('/documents', { title });
  }

  /**
   * Apply batch updates to a document
   * @param documentId The ID of the document to update
   * @param requests Array of update requests
   * @param writeControl Optional write control settings
   */
  async batchUpdate(
    documentId: string,
    requests: Request[],
    writeControl?: { requiredRevisionId?: string; targetRevisionId?: string }
  ): Promise<BatchUpdateResponse> {
    const body: BatchUpdateRequest = { requests };
    if (writeControl) {
      body.writeControl = writeControl;
    }
    return this.client.post<BatchUpdateResponse>(`/documents/${documentId}:batchUpdate`, body);
  }
}
