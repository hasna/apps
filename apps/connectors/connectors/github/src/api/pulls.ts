import type { GitHubClient } from './client';
import type {
  PullRequest,
  ListPullsOptions,
  MergePullOptions,
  MergeResult,
  PullRequestReview,
  Commit,
  IssueComment,
} from '../types';

/**
 * GitHub Pull Requests API
 */
export class PullsApi {
  constructor(private readonly client: GitHubClient) {}

  /**
   * List pull requests in a repository
   */
  async list(owner: string, repo: string, options?: ListPullsOptions): Promise<PullRequest[]> {
    return this.client.get<PullRequest[]>(`/repos/${owner}/${repo}/pulls`, options as Record<string, string | number | boolean | undefined>);
  }

  /**
   * Get a single pull request
   */
  async get(owner: string, repo: string, prNumber: number): Promise<PullRequest> {
    return this.client.get<PullRequest>(`/repos/${owner}/${repo}/pulls/${prNumber}`);
  }

  /**
   * Create a pull request
   */
  async create(
    owner: string,
    repo: string,
    title: string,
    head: string,
    base: string,
    body?: string,
    options?: {
      draft?: boolean;
      maintainer_can_modify?: boolean;
    }
  ): Promise<PullRequest> {
    return this.client.post<PullRequest>(`/repos/${owner}/${repo}/pulls`, {
      title,
      head,
      base,
      body,
      ...options,
    });
  }

  /**
   * Update a pull request
   */
  async update(
    owner: string,
    repo: string,
    prNumber: number,
    options: {
      title?: string;
      body?: string;
      state?: 'open' | 'closed';
      base?: string;
      maintainer_can_modify?: boolean;
    }
  ): Promise<PullRequest> {
    return this.client.patch<PullRequest>(`/repos/${owner}/${repo}/pulls/${prNumber}`, options);
  }

  /**
   * Merge a pull request
   */
  async merge(
    owner: string,
    repo: string,
    prNumber: number,
    options?: MergePullOptions
  ): Promise<MergeResult> {
    return this.client.put<MergeResult>(`/repos/${owner}/${repo}/pulls/${prNumber}/merge`, options || {});
  }

  /**
   * Check if a pull request has been merged
   */
  async isMerged(owner: string, repo: string, prNumber: number): Promise<boolean> {
    try {
      await this.client.get(`/repos/${owner}/${repo}/pulls/${prNumber}/merge`);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * List commits on a pull request
   */
  async listCommits(
    owner: string,
    repo: string,
    prNumber: number,
    options?: { per_page?: number; page?: number }
  ): Promise<Commit[]> {
    return this.client.get<Commit[]>(`/repos/${owner}/${repo}/pulls/${prNumber}/commits`, options);
  }

  /**
   * List files in a pull request
   */
  async listFiles(
    owner: string,
    repo: string,
    prNumber: number,
    options?: { per_page?: number; page?: number }
  ): Promise<
    Array<{
      sha: string;
      filename: string;
      status: string;
      additions: number;
      deletions: number;
      changes: number;
      blob_url: string;
      raw_url: string;
      contents_url: string;
      patch?: string;
    }>
  > {
    return this.client.get(`/repos/${owner}/${repo}/pulls/${prNumber}/files`, options);
  }

  /**
   * List reviews on a pull request
   */
  async listReviews(
    owner: string,
    repo: string,
    prNumber: number,
    options?: { per_page?: number; page?: number }
  ): Promise<PullRequestReview[]> {
    return this.client.get<PullRequestReview[]>(
      `/repos/${owner}/${repo}/pulls/${prNumber}/reviews`,
      options
    );
  }

  /**
   * Get a single review
   */
  async getReview(
    owner: string,
    repo: string,
    prNumber: number,
    reviewId: number
  ): Promise<PullRequestReview> {
    return this.client.get<PullRequestReview>(
      `/repos/${owner}/${repo}/pulls/${prNumber}/reviews/${reviewId}`
    );
  }

  /**
   * Create a review on a pull request
   */
  async createReview(
    owner: string,
    repo: string,
    prNumber: number,
    body?: string,
    event?: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT',
    options?: {
      commit_id?: string;
      comments?: Array<{
        path: string;
        position?: number;
        body: string;
        line?: number;
        side?: 'LEFT' | 'RIGHT';
        start_line?: number;
        start_side?: 'LEFT' | 'RIGHT';
      }>;
    }
  ): Promise<PullRequestReview> {
    return this.client.post<PullRequestReview>(
      `/repos/${owner}/${repo}/pulls/${prNumber}/reviews`,
      {
        body,
        event,
        ...options,
      }
    );
  }

  /**
   * Submit a pending review
   */
  async submitReview(
    owner: string,
    repo: string,
    prNumber: number,
    reviewId: number,
    event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT',
    body?: string
  ): Promise<PullRequestReview> {
    return this.client.post<PullRequestReview>(
      `/repos/${owner}/${repo}/pulls/${prNumber}/reviews/${reviewId}/events`,
      { event, body }
    );
  }

  /**
   * Dismiss a review
   */
  async dismissReview(
    owner: string,
    repo: string,
    prNumber: number,
    reviewId: number,
    message: string
  ): Promise<PullRequestReview> {
    return this.client.put<PullRequestReview>(
      `/repos/${owner}/${repo}/pulls/${prNumber}/reviews/${reviewId}/dismissals`,
      { message }
    );
  }

  /**
   * List review comments on a pull request
   */
  async listReviewComments(
    owner: string,
    repo: string,
    prNumber: number,
    options?: {
      sort?: 'created' | 'updated';
      direction?: 'asc' | 'desc';
      since?: string;
      per_page?: number;
      page?: number;
    }
  ): Promise<IssueComment[]> {
    return this.client.get<IssueComment[]>(
      `/repos/${owner}/${repo}/pulls/${prNumber}/comments`,
      options
    );
  }

  /**
   * Request reviewers for a pull request
   */
  async requestReviewers(
    owner: string,
    repo: string,
    prNumber: number,
    reviewers?: string[],
    teamReviewers?: string[]
  ): Promise<PullRequest> {
    return this.client.post<PullRequest>(
      `/repos/${owner}/${repo}/pulls/${prNumber}/requested_reviewers`,
      {
        reviewers,
        team_reviewers: teamReviewers,
      }
    );
  }

  /**
   * Remove requested reviewers from a pull request
   */
  async removeRequestedReviewers(
    owner: string,
    repo: string,
    prNumber: number,
    reviewers?: string[],
    teamReviewers?: string[]
  ): Promise<void> {
    await this.client.request(
      `/repos/${owner}/${repo}/pulls/${prNumber}/requested_reviewers`,
      { method: 'DELETE', body: { reviewers, team_reviewers: teamReviewers } }
    );
  }
}
