import {
  getClientId,
  getClientSecret,
  getAccessToken,
  getRefreshToken,
  setTokens,
  isTokenExpired,
} from '../utils/config';
import type {
  Task,
  TasksResponse,
  GoogleTasksError,
  AuthenticationError,
} from '../types';

const TASKS_API_BASE = 'https://tasks.googleapis.com/tasks/v1';
const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';

export interface TaskSummary {
  id: string;
  title: string;
  status: string;
  due?: string;
  notes?: string;
}

export interface BulkOperationOptions {
  taskListId: string;
  /** Filter by completion status */
  showCompleted?: boolean;
  /** Filter by search (matches title) */
  query?: string;
  /** Maximum tasks to process (default: 100) */
  maxResults?: number;
  /** Maximum concurrent API calls (default: 10) */
  concurrency?: number;
  /** Dry run - don't actually modify */
  dryRun?: boolean;
  /** Progress callback */
  onProgress?: (current: number, total: number, task: TaskSummary) => void;
  /** Error callback */
  onError?: (error: Error, task: TaskSummary) => void;
}

export interface BulkOperationResult {
  total: number;
  success: number;
  failed: number;
  skipped: number;
  errors: Array<{ taskId: string; error: string }>;
  processedTasks: TaskSummary[];
}

export interface PreviewResult {
  tasks: TaskSummary[];
  total: number;
  taskListId: string;
}

export class BulkApi {
  private token: string | null = null;

  async #getValidToken(): Promise<string> {
    if (this.token) return this.token;

    let accessToken = getAccessToken();
    if (!accessToken) {
      throw new Error('Not authenticated. Run "connect-googletasks auth login" first.');
    }

    if (isTokenExpired()) {
      const refreshToken = getRefreshToken();
      const clientId = getClientId();
      const clientSecret = getClientSecret();

      if (!refreshToken || !clientId || !clientSecret) {
        throw new Error('Token expired and cannot refresh. Run "connect-googletasks auth login"');
      }

      const response = await fetch(OAUTH_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          refresh_token: refreshToken,
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: 'refresh_token',
        }).toString(),
      });

      if (!response.ok) {
        throw new Error('Failed to refresh token');
      }

      const tokens = await response.json();
      setTokens(tokens.access_token, tokens.refresh_token, tokens.expires_in);
      accessToken = tokens.access_token;
    }

    this.token = accessToken;
    return accessToken;
  }

  async #request<T>(method: string, path: string, body?: unknown, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    const token = await this.#getValidToken();

    let url = `${TASKS_API_BASE}${path}`;
    if (params) {
      const searchParams = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) searchParams.append(key, String(value));
      }
      const qs = searchParams.toString();
      if (qs) url += `?${qs}`;
    }

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    };

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      const message = error.error?.message || response.statusText;
      throw new Error(message);
    }

    if (response.status === 204) return {} as T;
    return response.json();
  }

  // ============================================
  // Preview
  // ============================================

  async preview(taskListId: string, options?: { query?: string; showCompleted?: boolean; maxResults?: number }): Promise<PreviewResult> {
    const tasks = await this.#fetchTasks(taskListId, {
      q: options?.query,
      showCompleted: options?.showCompleted,
      maxResults: options?.maxResults || 50,
    });
    return { tasks, total: tasks.length, taskListId };
  }

  // ============================================
  // Complete
  // ============================================

  async complete(options: BulkOperationOptions): Promise<BulkOperationResult> {
    const tasks = await this.#fetchTasks(options.taskListId, {
      q: options.query,
      showCompleted: options.showCompleted ?? false,
      maxResults: options.maxResults || 100,
    });

    const pending = tasks.filter(t => t.status !== 'completed');

    return this.#executeBatch(pending, {
      dryRun: options.dryRun || false,
      concurrency: options.concurrency || 10,
      onProgress: options.onProgress,
      onError: options.onError,
      operation: async (task) => {
        await this.#request<Task>(
          'PATCH',
          `/lists/${options.taskListId}/tasks/${task.id}`,
          { status: 'completed', completed: new Date().toISOString() }
        );
      },
    });
  }

  // ============================================
  // Uncomplete
  // ============================================

  async uncomplete(options: BulkOperationOptions): Promise<BulkOperationResult> {
    const tasks = await this.#fetchTasks(options.taskListId, {
      showCompleted: true,
      maxResults: options.maxResults || 100,
    });

    const completed = tasks.filter(t => t.status === 'completed');

    return this.#executeBatch(completed, {
      dryRun: options.dryRun || false,
      concurrency: options.concurrency || 10,
      onProgress: options.onProgress,
      onError: options.onError,
      operation: async (task) => {
        await this.#request<Task>(
          'PATCH',
          `/lists/${options.taskListId}/tasks/${task.id}`,
          { status: 'needsAction' }
        );
      },
    });
  }

  // ============================================
  // Delete
  // ============================================

  async delete(options: BulkOperationOptions): Promise<BulkOperationResult> {
    const tasks = await this.#fetchTasks(options.taskListId, {
      q: options.query,
      showCompleted: options.showCompleted,
      maxResults: options.maxResults || 100,
    });

    return this.#executeBatch(tasks, {
      dryRun: options.dryRun || false,
      concurrency: options.concurrency || 10,
      onProgress: options.onProgress,
      onError: options.onError,
      operation: async (task) => {
        await this.#request<void>('DELETE', `/lists/${options.taskListId}/tasks/${task.id}`);
      },
    });
  }

  // ============================================
  // Update (batch update notes or due dates)
  // ============================================

  async update(taskListId: string, options: {
    query?: string;
    showCompleted?: boolean;
    maxResults?: number;
    concurrency?: number;
    dryRun?: boolean;
    onProgress?: (current: number, total: number, task: TaskSummary) => void;
    onError?: (error: Error, task: TaskSummary) => void;
    updates: { due?: string; notes?: string };
  }): Promise<BulkOperationResult> {
    const tasks = await this.#fetchTasks(taskListId, {
      q: options.query,
      showCompleted: options.showCompleted,
      maxResults: options.maxResults || 100,
    });

    return this.#executeBatch(tasks, {
      dryRun: options.dryRun || false,
      concurrency: options.concurrency || 10,
      onProgress: options.onProgress,
      onError: options.onError,
      operation: async (task) => {
        const patch: Record<string, string> = {};
        if (options.updates.due !== undefined) patch.due = options.updates.due;
        if (options.updates.notes !== undefined) patch.notes = options.updates.notes;
        await this.#request<Task>('PATCH', `/lists/${taskListId}/tasks/${task.id}`, patch);
      },
    });
  }

  // ============================================
  // Helpers
  // ============================================

  async #fetchTasks(taskListId: string, params: { q?: string; showCompleted?: boolean; maxResults?: number }): Promise<TaskSummary[]> {
    const tasks: TaskSummary[] = [];
    let pageToken: string | undefined;
    const max = params.maxResults || 100;

    while (tasks.length < max) {
      const requestParams: Record<string, string | number | boolean | undefined> = {
        maxResults: Math.min(100, max - tasks.length),
        pageToken,
        showCompleted: params.showCompleted ?? false,
      };
      if (params.q) requestParams.q = params.q;

      const response = await this.#request<TasksResponse>('GET', `/lists/${taskListId}/tasks`, undefined, requestParams);

      if (!response.items || response.items.length === 0) break;

      for (const t of response.items) {
        tasks.push({
          id: t.id,
          title: t.title || '(untitled)',
          status: t.status || 'needsAction',
          due: t.due,
          notes: t.notes,
        });
      }

      pageToken = response.nextPageToken;
      if (!pageToken) break;
    }

    return tasks;
  }

  async #executeBatch(
    tasks: TaskSummary[],
    options: {
      dryRun: boolean;
      concurrency: number;
      onProgress?: (current: number, total: number, task: TaskSummary) => void;
      onError?: (error: Error, task: TaskSummary) => void;
      operation: (task: TaskSummary) => Promise<void>;
    }
  ): Promise<BulkOperationResult> {
    const { dryRun, concurrency, onProgress, onError, operation } = options;

    const result: BulkOperationResult = {
      total: tasks.length,
      success: 0,
      failed: 0,
      skipped: 0,
      errors: [],
      processedTasks: [],
    };

    if (tasks.length === 0) return result;

    const chunks = this.#chunkArray(tasks, concurrency);

    for (const chunk of chunks) {
      await Promise.all(
        chunk.map(async (task) => {
          try {
            if (dryRun) {
              result.success++;
              result.processedTasks.push(task);
            } else {
              await operation(task);
              result.success++;
              result.processedTasks.push(task);
            }

            if (onProgress) onProgress(result.success + result.failed, result.total, task);
          } catch (err) {
            result.failed++;
            const errorMessage = err instanceof Error ? err.message : String(err);
            result.errors.push({ taskId: task.id, error: errorMessage });
            if (onError) onError(err instanceof Error ? err : new Error(errorMessage), task);
          }
        })
      );
    }

    return result;
  }

  #chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
}
