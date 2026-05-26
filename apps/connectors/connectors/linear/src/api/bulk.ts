import type { LinearClient } from './client';

// ============================================
// Bulk Operation Types
// ============================================

export interface BulkOperationOptions {
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
  issueIds: string[];
  /** Action to perform */
  action: 'archive' | 'change_state' | 'assign' | 'set_priority' | 'add_to_project';
  /** State ID (for change_state) */
  stateId?: string;
  /** User ID (for assign) */
  assigneeId?: string;
  /** Priority 0-4 (for set_priority) */
  priority?: number;
  /** Project ID (for add_to_project) */
  projectId?: string;
}

export interface BulkIssueResult {
  total: number;
  success: number;
  failed: number;
  errors: Array<{ issueId: string; error: string }>;
  results: Array<{ issueId: string; response: unknown }>;
}

// --- Label Bulk Operations ---

export interface BulkLabelOptions extends BulkOperationOptions {
  /** Issues to apply/remove label from */
  issueIds: string[];
  /** Label ID to add or remove */
  labelId: string;
  /** Action: add or remove label */
  action: 'add' | 'remove';
}

export interface BulkLabelResult {
  total: number;
  success: number;
  failed: number;
  errors: Array<{ issueId: string; error: string }>;
  results: Array<{ issueId: string; response: unknown }>;
}

// ============================================
// Bulk Operations API
// ============================================

export class BulkApi {
  private readonly client: LinearClient;

  constructor(client: LinearClient) {
    this.client = client;
  }

  // ============================================
  // Bulk Issue Operations
  // ============================================

  async issues(options: BulkIssueOptions): Promise<BulkIssueResult> {
    const { issueIds, action, concurrency = 10, dryRun = false, onProgress, onError, stateId, assigneeId, priority, projectId } = options;

    const result: BulkIssueResult = {
      total: issueIds.length,
      success: 0,
      failed: 0,
      errors: [],
      results: [],
    };

    if (issueIds.length === 0) return result;

    const chunks = this.chunkArray(issueIds, concurrency);

    for (const chunk of chunks) {
      await Promise.all(
        chunk.map(async (issueId) => {
          try {
            if (dryRun) {
              result.success++;
            } else {
              let response: unknown;
              if (action === 'archive') {
                response = await this.archiveIssue(issueId);
              } else if (action === 'change_state') {
                if (!stateId) throw new Error('stateId is required for change_state');
                response = await this.updateIssue(issueId, { stateId });
              } else if (action === 'assign') {
                if (!assigneeId) throw new Error('assigneeId is required for assign');
                response = await this.updateIssue(issueId, { assigneeId });
              } else if (action === 'set_priority') {
                if (priority === undefined) throw new Error('priority is required for set_priority');
                response = await this.updateIssue(issueId, { priority });
              } else if (action === 'add_to_project') {
                if (!projectId) throw new Error('projectId is required for add_to_project');
                response = await this.updateIssue(issueId, { projectId });
              }
              result.success++;
              result.results.push({ issueId, response });
            }

            if (onProgress) onProgress(result.success + result.failed, result.total, issueId);
          } catch (err) {
            result.failed++;
            const errorMessage = err instanceof Error ? err.message : String(err);
            result.errors.push({ issueId, error: errorMessage });
            if (onError) onError(err instanceof Error ? err : new Error(errorMessage), issueId);
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
    const { issueIds, labelId, action, concurrency = 10, dryRun = false, onProgress, onError } = options;

    const result: BulkLabelResult = {
      total: issueIds.length,
      success: 0,
      failed: 0,
      errors: [],
      results: [],
    };

    if (issueIds.length === 0) return result;

    const chunks = this.chunkArray(issueIds, concurrency);

    for (const chunk of chunks) {
      await Promise.all(
        chunk.map(async (issueId) => {
          try {
            if (dryRun) {
              result.success++;
            } else {
              // Linear doesn't have a direct add/remove label mutation,
              // so we update the issue's labelIds
              const response = await this.updateIssue(issueId, {
                labelIds: action === 'add' ? [labelId] : undefined,
              });
              result.success++;
              result.results.push({ issueId, response });
            }

            if (onProgress) onProgress(result.success + result.failed, result.total, issueId);
          } catch (err) {
            result.failed++;
            const errorMessage = err instanceof Error ? err.message : String(err);
            result.errors.push({ issueId, error: errorMessage });
            if (onError) onError(err instanceof Error ? err : new Error(errorMessage), issueId);
          }
        })
      );
    }

    return result;
  }

  // ============================================
  // Private Helpers
  // ============================================

  private async updateIssue(id: string, input: Record<string, unknown>): Promise<unknown> {
    const mutation = `
      mutation IssueUpdate($id: String!, $input: IssueUpdateInput!) {
        issueUpdate(id: $id, input: $input) {
          success
          issue {
            id
            identifier
            title
          }
        }
      }
    `;
    return this.client.mutate(mutation, { id, input });
  }

  private async archiveIssue(id: string): Promise<unknown> {
    const mutation = `
      mutation IssueArchive($id: String!) {
        issueArchive(id: $id) {
          success
        }
      }
    `;
    return this.client.mutate(mutation, { id });
  }

  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
}
