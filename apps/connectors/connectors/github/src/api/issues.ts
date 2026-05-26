import type { GitHubClient } from './client';
import type {
  Issue,
  IssueComment,
  ListIssuesOptions,
  CreateIssueOptions,
  UpdateIssueOptions,
} from '../types';

/**
 * GitHub Issues API
 */
export class IssuesApi {
  constructor(private readonly client: GitHubClient) {}

  /**
   * List issues in a repository
   */
  async list(owner: string, repo: string, options?: ListIssuesOptions): Promise<Issue[]> {
    return this.client.get<Issue[]>(`/repos/${owner}/${repo}/issues`, options as Record<string, string | number | boolean | undefined>);
  }

  /**
   * Get a single issue
   */
  async get(owner: string, repo: string, issueNumber: number): Promise<Issue> {
    return this.client.get<Issue>(`/repos/${owner}/${repo}/issues/${issueNumber}`);
  }

  /**
   * Create an issue
   */
  async create(
    owner: string,
    repo: string,
    title: string,
    body?: string,
    options?: CreateIssueOptions
  ): Promise<Issue> {
    return this.client.post<Issue>(`/repos/${owner}/${repo}/issues`, {
      title,
      body,
      ...options,
    });
  }

  /**
   * Update an issue
   */
  async update(
    owner: string,
    repo: string,
    issueNumber: number,
    options: UpdateIssueOptions
  ): Promise<Issue> {
    return this.client.patch<Issue>(`/repos/${owner}/${repo}/issues/${issueNumber}`, options);
  }

  /**
   * Lock an issue
   */
  async lock(
    owner: string,
    repo: string,
    issueNumber: number,
    lockReason?: 'off-topic' | 'too heated' | 'resolved' | 'spam'
  ): Promise<void> {
    await this.client.put(`/repos/${owner}/${repo}/issues/${issueNumber}/lock`, {
      lock_reason: lockReason,
    });
  }

  /**
   * Unlock an issue
   */
  async unlock(owner: string, repo: string, issueNumber: number): Promise<void> {
    await this.client.delete(`/repos/${owner}/${repo}/issues/${issueNumber}/lock`);
  }

  /**
   * List comments on an issue
   */
  async listComments(
    owner: string,
    repo: string,
    issueNumber: number,
    options?: {
      since?: string;
      per_page?: number;
      page?: number;
    }
  ): Promise<IssueComment[]> {
    return this.client.get<IssueComment[]>(
      `/repos/${owner}/${repo}/issues/${issueNumber}/comments`,
      options
    );
  }

  /**
   * Get a single comment
   */
  async getComment(owner: string, repo: string, commentId: number): Promise<IssueComment> {
    return this.client.get<IssueComment>(`/repos/${owner}/${repo}/issues/comments/${commentId}`);
  }

  /**
   * Create a comment on an issue
   */
  async createComment(
    owner: string,
    repo: string,
    issueNumber: number,
    body: string
  ): Promise<IssueComment> {
    return this.client.post<IssueComment>(
      `/repos/${owner}/${repo}/issues/${issueNumber}/comments`,
      { body }
    );
  }

  /**
   * Update a comment
   */
  async updateComment(
    owner: string,
    repo: string,
    commentId: number,
    body: string
  ): Promise<IssueComment> {
    return this.client.patch<IssueComment>(
      `/repos/${owner}/${repo}/issues/comments/${commentId}`,
      { body }
    );
  }

  /**
   * Delete a comment
   */
  async deleteComment(owner: string, repo: string, commentId: number): Promise<void> {
    await this.client.delete(`/repos/${owner}/${repo}/issues/comments/${commentId}`);
  }

  /**
   * Add labels to an issue
   */
  async addLabels(owner: string, repo: string, issueNumber: number, labels: string[]): Promise<void> {
    await this.client.post(`/repos/${owner}/${repo}/issues/${issueNumber}/labels`, { labels });
  }

  /**
   * Remove a label from an issue
   */
  async removeLabel(owner: string, repo: string, issueNumber: number, label: string): Promise<void> {
    await this.client.delete(`/repos/${owner}/${repo}/issues/${issueNumber}/labels/${label}`);
  }

  /**
   * Add assignees to an issue
   */
  async addAssignees(
    owner: string,
    repo: string,
    issueNumber: number,
    assignees: string[]
  ): Promise<Issue> {
    return this.client.post<Issue>(
      `/repos/${owner}/${repo}/issues/${issueNumber}/assignees`,
      { assignees }
    );
  }

  /**
   * Remove assignees from an issue
   */
  async removeAssignees(
    owner: string,
    repo: string,
    issueNumber: number,
    assignees: string[]
  ): Promise<Issue> {
    return this.client.request<Issue>(
      `/repos/${owner}/${repo}/issues/${issueNumber}/assignees`,
      { method: 'DELETE', body: { assignees } }
    );
  }
}
