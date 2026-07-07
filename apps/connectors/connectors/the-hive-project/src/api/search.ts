import type { TheHiveProjectClient } from './client';
import type { QueryBody } from '../types';

export class SearchApi {
  constructor(private readonly client: TheHiveProjectClient) {}

  async search(body: QueryBody): Promise<unknown> {
    return this.client.post<unknown>('/query', body);
  }
}
