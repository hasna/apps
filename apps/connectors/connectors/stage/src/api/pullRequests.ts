import type { StageClient } from './client';
import type { PullRequest, StageList } from '../types';

export interface ListPullRequestsOptions {
  status?: string;
  repository?: string;
  author?: string;
  limit?: number;
  cursor?: string;
}

/**
 * Stage Pull Requests API
 */
export class PullRequestsApi {
  constructor(private readonly client: StageClient) {}

  /**
   * List pull requests.
   * GET /pull-requests
   */
  async list(options: ListPullRequestsOptions = {}): Promise<StageList<PullRequest>> {
    return this.client.request<StageList<PullRequest>>('/pull-requests', {
      method: 'GET',
      query: {
        status: options.status,
        repository: options.repository,
        author: options.author,
        limit: options.limit,
        cursor: options.cursor,
      },
    });
  }
}
