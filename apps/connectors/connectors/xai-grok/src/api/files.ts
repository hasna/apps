import type { XAIGrokClient } from './client';
import type { ListQuery } from '../types';

export class FilesApi {
  constructor(private readonly client: XAIGrokClient) {}

  list(query: ListQuery = {}): Promise<unknown> {
    return this.client.get('/files', query as Record<string, string | number | boolean | undefined>);
  }

  get(fileId: string): Promise<unknown> {
    return this.client.get(`/files/${encodeURIComponent(fileId)}`);
  }

  delete(fileId: string): Promise<unknown> {
    return this.client.delete(`/files/${encodeURIComponent(fileId)}`);
  }

  getContent(fileId: string): Promise<ArrayBuffer> {
    return this.client.getBinary(`/files/${encodeURIComponent(fileId)}/content`);
  }
}
