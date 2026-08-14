import type { SearchParams, ZipkinTrace } from '../types';
import type { ZipkinClient } from './client';

export class SearchApi {
  constructor(private readonly client: ZipkinClient) {}

  async search(params: SearchParams): Promise<ZipkinTrace[]> {
    return this.client.post<ZipkinTrace[]>('/search', params);
  }
}
