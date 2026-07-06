import type { ConnectorClient } from './client';
import type { PullRequest, PullRequestListResult } from '../types';

// ============================================
// Stub Data Generators
// ============================================

function stubPullRequests(): PullRequest[] {
  const now = new Date().toISOString();
  return [
    {
      id: 'pr_stub_001',
      build_id: 'build_stub_001',
      title: 'Add OAuth login flow',
      url: 'https://github.com/example/repo/pull/42',
      status: 'open',
      created_at: now,
    },
    {
      id: 'pr_stub_002',
      build_id: 'build_stub_003',
      title: 'Fix pagination bug',
      url: 'https://github.com/example/repo/pull/43',
      status: 'merged',
      created_at: now,
    },
  ];
}

/**
 * Syntropy Pull Requests API
 * Endpoint: GET /pull-requests
 */
export class PullRequestsApi {
  constructor(private readonly client: ConnectorClient) {}

  /**
   * List pull requests opened by Syntropy builds.
   */
  async list(): Promise<PullRequestListResult> {
    const result = await this.client.request<{ pull_requests: PullRequest[] }>('/pull-requests');
    if (result.stub) {
      return { pull_requests: stubPullRequests(), stub: true };
    }
    return { pull_requests: result.data?.pull_requests ?? [], stub: false };
  }
}
