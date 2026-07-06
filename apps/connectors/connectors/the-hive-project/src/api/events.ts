import type { TheHiveProjectClient } from './client';
import type { ListQueryParams } from '../types';

export class EventsApi {
  constructor(private readonly client: TheHiveProjectClient) {}

  async list(params?: ListQueryParams): Promise<unknown> {
    return this.client.get<unknown>('/events', params);
  }
}
