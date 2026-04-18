import type { GitHubClient } from './client';

// ============================================
// Bulk Operation Types
// ============================================

export interface BulkOperationOptions {
  /** Owner of the repository */
  owner: string;
  /** Repository name */
  repo: string;
  /** Maximum concurrent API calls (default: 10) */
  concurrency?: number;
  /** Dry run - don't actually modify */
  dryRun?: boolean;
  /** Progress callback */
  onProgress?: (current: number, total: number, item: unknown) => void;
  /** Error callback */
  onError?: (error: Error, item: unknown) => void;
}

// --- Issue Bulk Operations ---

export interface BulkIssueOptions extends BulkOperationOptions {
  issueNumbers: number[];
  /** Action to perform */
  action: 'close' | 'reopen' | 'lock' | 'unlock';
  /** Lock reason (for lock action only) */
  lockReason?: 'off-topic' | 'too_heated' | 'resolved' | 'spam';
}

export interface BulkIssueResult {
  total: number;
  success: number;
  failed: number;
  errors: Array<{ issueNumber: number; error: string }>;
  results: Array<{ issueNumber: number; response: unknown }>;
}

// --- Label Bulk Operations ---

export interface BulkLabelOptions extends BulkOperationOptions {
  issueNumber: number;
  /** Labels to add or remove */
  labels: string[];
  /** Action to perform */
  action: 'add' | 'remove';
}

export interface BulkLabelResult {
  total: number;
  success: number;
  failed: number;
  errors: Array<{ label: string; error: string }>;
  results: Array<{ label: string; response: unknown }>;
}

// --- Pull Request Bulk Operations ---

export interface BulkPullRequestOptions extends BulkOperationOptions {
  pullNumbers: number[];
  /** Action to perform */
  action: 'merge' | 'close' | 'update_branch';
  /** Merge method (for merge action) */
  mergeMethod?: 'merge' | 'squash' | 'rebase';
}

export interface BulkPullRequestResult {
  total: number;
  success: number;
  failed: number;
  errors: Array<{ pullNumber: number; error: string }>;
  results: Array<{ pullNumber: number; response: unknown }>;
}

// --- Comment Bulk Operations ---

export interface BulkCommentOptions extends BulkOperationOptions {
  /** Comment IDs to operate on */
  commentIds: number[];
  /** Action to perform */
  action: 'delete';
}

export interface BulkCommentResult {
  total: number;
  success: number;
  failed: number;
  errors: Array<{ commentId: number; error: string }>;
  results: Array<{ commentId: number; response: unknown }>;
}

// ============================================
// Bulk Operations API
// ============================================

export class BulkApi {
  private readonly client: GitHubClient;

  constructor(client: GitHubClient) {
    this.client = client;
  }

  // ============================================
  // Bulk Issue Operations
  // ============================================

  async issues(options: BulkIssueOptions): Promise<BulkIssueResult> {
    const { owner, repo, issueNumbers, action, lockReason, concurrency = 10, dryRun = false, onProgress, onError } = options;

    const result: BulkIssueResult = {
      total: issueNumbers.length,
      success: 0,
      failed: 0,
      errors: [],
      results: [],
    };

    if (issueNumbers.length === 0) return result;

    const chunks = this.chunkArray(issueNumbers, concurrency);

    for (const chunk of chunks) {
      await Promise.all(
        chunk.map(async (issueNumber) => {
          try {
            if (dryRun) {
              result.success++;
            } else {
              let response: unknown;
              if (action === 'close') {
                response = await this.client.patch(`/repos/${owner}/${repo}/issues/${issueNumber}`, { state: 'closed' });
              } else if (action === 'reopen') {
                response = await this.client.patch(`/repos/${owner}/${repo}/issues/${issueNumber}`, { state: 'open' });
              } else if (action === 'lock') {
                await this.client.put(`/repos/${owner}/${repo}/issues/${issueNumber}/lock`, {
                  lock_reason: lockReason,
                });
                response = { locked: true };
              } else {
                await this.client.delete(`/repos/${owner}/${repo}/issues/${issueNumber}/lock`);
                response = { locked: false };
              }
              result.success++;
              result.results.push({ issueNumber, response });
            }

            if (onProgress) onProgress(result.success + result.failed, result.total, issueNumber);
          } catch (err) {
            result.failed++;
            const errorMessage = err instanceof Error ? err.message : String(err);
            result.errors.push({ issueNumber, error: errorMessage });
            if (onError) onError(err instanceof Error ? err : new Error(errorMessage), issueNumber);
          }
        })
      );
    }

    return result;
  }

  // ============================================
  // Bulk Label Operations
  // ============================================

  async labels(options: BulkLabelOptions): Promise<BulkLabelResult> {
    const { owner, repo, issueNumber, labels, action, concurrency = 10, dryRun = false, onProgress, onError } = options;

    const result: BulkLabelResult = {
      total: labels.length,
      success: 0,
      failed: 0,
      errors: [],
      results: [],
    };

    if (labels.length === 0) return result;

    const chunks = this.chunkArray(labels, concurrency);

    for (const chunk of chunks) {
      await Promise.all(
        chunk.map(async (label) => {
          try {
            if (dryRun) {
              result.success++;
            } else {
              let response: unknown;
              if (action === 'add') {
                await this.client.post(`/repos/${owner}/${repo}/issues/${issueNumber}/labels`, {
                  labels: [label],
                });
                response = { added: label };
              } else {
                await this.client.delete(`/repos/${owner}/${repo}/issues/${issueNumber}/labels/${encodeURIComponent(label)}`);
                response = { removed: label };
              }
              result.success++;
              result.results.push({ label, response });
            }

            if (onProgress) onProgress(result.success + result.failed, result.total, label);
          } catch (err) {
            result.failed++;
            const errorMessage = err instanceof Error ? err.message : String(err);
            result.errors.push({ label, error: errorMessage });
            if (onError) onError(err instanceof Error ? err : new Error(errorMessage), label);
          }
        })
      );
    }

    return result;
  }

  // ============================================
  // Bulk Pull Request Operations
  // ============================================

  async pullRequests(options: BulkPullRequestOptions): Promise<BulkPullRequestResult> {
    const { owner, repo, pullNumbers, action, mergeMethod = 'merge', concurrency = 10, dryRun = false, onProgress, onError } = options;

    const result: BulkPullRequestResult = {
      total: pullNumbers.length,
      success: 0,
      failed: 0,
      errors: [],
      results: [],
    };

    if (pullNumbers.length === 0) return result;

    const chunks = this.chunkArray(pullNumbers, concurrency);

    for (const chunk of chunks) {
      await Promise.all(
        chunk.map(async (pullNumber) => {
          try {
            if (dryRun) {
              result.success++;
            } else {
              let response: unknown;
              if (action === 'merge') {
                response = await this.client.put(`/repos/${owner}/${repo}/pulls/${pullNumber}/merge`, {
                  merge_method: mergeMethod,
                });
              } else if (action === 'close') {
                response = await this.client.patch(`/repos/${owner}/${repo}/pulls/${pullNumber}`, { state: 'closed' });
              } else {
                response = await this.client.put(`/repos/${owner}/${repo}/pulls/${pullNumber}/update-branch`);
              }
              result.success++;
              result.results.push({ pullNumber, response });
            }

            if (onProgress) onProgress(result.success + result.failed, result.total, pullNumber);
          } catch (err) {
            result.failed++;
            const errorMessage = err instanceof Error ? err.message : String(err);
            result.errors.push({ pullNumber, error: errorMessage });
            if (onError) onError(err instanceof Error ? err : new Error(errorMessage), pullNumber);
          }
        })
      );
    }

    return result;
  }

  // ============================================
  // Bulk Comment Operations
  // ============================================

  async comments(options: BulkCommentOptions): Promise<BulkCommentResult> {
    const { owner, repo, commentIds, action, concurrency = 10, dryRun = false, onProgress, onError } = options;

    const result: BulkCommentResult = {
      total: commentIds.length,
      success: 0,
      failed: 0,
      errors: [],
      results: [],
    };

    if (commentIds.length === 0) return result;

    const chunks = this.chunkArray(commentIds, concurrency);

    for (const chunk of chunks) {
      await Promise.all(
        chunk.map(async (commentId) => {
          try {
            if (dryRun) {
              result.success++;
            } else {
              if (action === 'delete') {
                await this.client.delete(`/repos/${owner}/${repo}/issues/comments/${commentId}`);
              }
              result.success++;
              result.results.push({ commentId, response: { deleted: commentId } });
            }

            if (onProgress) onProgress(result.success + result.failed, result.total, commentId);
          } catch (err) {
            result.failed++;
            const errorMessage = err instanceof Error ? err.message : String(err);
            result.errors.push({ commentId, error: errorMessage });
            if (onError) onError(err instanceof Error ? err : new Error(errorMessage), commentId);
          }
        })
      );
    }

    return result;
  }

  // ============================================
  // Helper Methods
  // ============================================

  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
}
