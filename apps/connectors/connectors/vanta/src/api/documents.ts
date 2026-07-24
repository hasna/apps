import type { VantaClient } from './client';
import type { Document, PaginatedResponse, SearchDocumentsParams } from '../types';

/**
 * Document listing/search. Vanta has no global /search endpoint; filter documents instead.
 */
export class DocumentsApi {
  constructor(private readonly client: VantaClient) {}

  search(params: SearchDocumentsParams = {}): Promise<PaginatedResponse<Document>> {
    return this.client.get<PaginatedResponse<Document>>('/documents', {
      pageSize: params.pageSize,
      pageCursor: params.pageCursor,
      frameworkMatchesAny: params.frameworkMatchesAny,
      statusMatchesAny: params.statusMatchesAny,
    });
  }

  list(params: SearchDocumentsParams = {}): Promise<PaginatedResponse<Document>> {
    return this.search(params);
  }
}
