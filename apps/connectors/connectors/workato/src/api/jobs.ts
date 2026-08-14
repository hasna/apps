import type { WorkatoClient } from './client';
import type { JobListOptions } from '../types';

export class JobsApi {
  constructor(private readonly client: WorkatoClient) {}

  list(options: JobListOptions) {
    return this.client.get(`/recipes/${options.recipeId}/jobs`, {
      status: options.status,
      per_page: options.perPage,
      offset: options.offset,
      from_timestamp: options.fromTimestamp,
      to_timestamp: options.toTimestamp,
    });
  }

  get(recipeId: number, jobId: string) {
    if (!jobId.trim()) {
      throw new Error('Workato: jobId is required');
    }
    return this.client.get(`/recipes/${recipeId}/jobs/${encodeURIComponent(jobId)}`);
  }
}
