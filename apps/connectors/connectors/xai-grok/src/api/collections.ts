import type { XAIGrokClient } from './client';
import type { ListQuery } from '../types';

export class CollectionsApi {
  constructor(private readonly client: XAIGrokClient) {}

  list(query: ListQuery = {}): Promise<unknown> {
    return this.client.get('/collections', query as Record<string, string | number | boolean | undefined>);
  }

  create(body: Record<string, unknown>): Promise<unknown> {
    return this.client.post('/collections', body);
  }

  get(collectionId: string): Promise<unknown> {
    return this.client.get(`/collections/${encodeURIComponent(collectionId)}`);
  }

  delete(collectionId: string): Promise<unknown> {
    return this.client.delete(`/collections/${encodeURIComponent(collectionId)}`);
  }

  search(collectionId: string, body: Record<string, unknown>): Promise<unknown> {
    return this.client.post(`/collections/${encodeURIComponent(collectionId)}/search`, body);
  }

  addFile(collectionId: string, body: Record<string, unknown>): Promise<unknown> {
    return this.client.post(`/collections/${encodeURIComponent(collectionId)}/files`, body);
  }

  listFiles(collectionId: string, query: ListQuery = {}): Promise<unknown> {
    return this.client.get(
      `/collections/${encodeURIComponent(collectionId)}/files`,
      query as Record<string, string | number | boolean | undefined>,
    );
  }

  deleteFile(collectionId: string, fileId: string): Promise<unknown> {
    return this.client.delete(
      `/collections/${encodeURIComponent(collectionId)}/files/${encodeURIComponent(fileId)}`,
    );
  }
}
