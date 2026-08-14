import type { WorkatoClient } from './client';
import type { ExportProjectInput, PaginatedListOptions } from '../types';

export class ProjectsApi {
  constructor(private readonly client: WorkatoClient) {}

  list(options: PaginatedListOptions = {}) {
    return this.client.get('/projects', {
      per_page: options.perPage,
      page: options.page,
    });
  }

  get(id: number) {
    return this.client.get(`/projects/${id}`);
  }

  export(input: ExportProjectInput) {
    return this.client.post(`/projects/${input.projectId}/export`, {
      include_data: input.includeData,
    });
  }
}
