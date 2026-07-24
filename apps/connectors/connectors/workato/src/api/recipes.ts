import type { WorkatoClient } from './client';
import type { RecipeListOptions } from '../types';

export class RecipesApi {
  constructor(private readonly client: WorkatoClient) {}

  list(options: RecipeListOptions = {}) {
    return this.client.get('/recipes', {
      folder_id: options.folderId,
      running: options.running,
      per_page: options.perPage,
      page: options.page,
      updated_after: options.updatedAfter,
      order: options.order,
    });
  }

  get(id: number) {
    return this.client.get(`/recipes/${id}`);
  }

  start(id: number) {
    return this.client.put(`/recipes/${id}/start`);
  }

  stop(id: number) {
    return this.client.put(`/recipes/${id}/stop`);
  }
}
