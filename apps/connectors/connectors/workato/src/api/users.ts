import type { WorkatoClient } from './client';
import type { PaginatedListOptions } from '../types';

export class UsersApi {
  constructor(private readonly client: WorkatoClient) {}

  list(options: PaginatedListOptions = {}) {
    return this.client.get('/users', {
      per_page: options.perPage,
      page: options.page,
    });
  }
}
