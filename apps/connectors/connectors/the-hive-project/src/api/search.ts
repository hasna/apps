import type { TheHiveProjectClient } from './client';
import type { SearchBody } from '../types';

export class SearchApi {
  constructor(private readonly client: TheHiveProjectClient) {}

  async search(body: SearchBody): Promise<unknown> {
    return this.client.post<unknown>('/search', body);
  }
}
