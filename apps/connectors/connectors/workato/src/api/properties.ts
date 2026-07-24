import type { WorkatoClient } from './client';
import type { PaginatedListOptions, UpsertPropertyInput } from '../types';

export class PropertiesApi {
  constructor(private readonly client: WorkatoClient) {}

  list(options: PaginatedListOptions = {}) {
    return this.client.get('/properties', {
      per_page: options.perPage,
      page: options.page,
    });
  }

  upsert(input: UpsertPropertyInput) {
    if (!input.name?.trim()) {
      throw new Error('Workato: name is required');
    }
    if (!input.value?.trim()) {
      throw new Error('Workato: value is required');
    }
    return this.client.post('/properties', {
      name: input.name.trim(),
      value: input.value.trim(),
    });
  }
}
