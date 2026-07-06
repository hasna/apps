import type { TheHiveProjectClient } from './client';
import type { QueryBody } from '../types';

export class QueryApi {
  constructor(private readonly client: TheHiveProjectClient) {}

  async execute(body: QueryBody): Promise<unknown> {
    return this.client.post<unknown>('/query', body);
  }
}
