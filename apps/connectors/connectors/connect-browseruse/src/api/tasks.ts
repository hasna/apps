import type { BrowserUseClient } from './client';
import type {
  Task,
  CreateTaskParams,
  UpdateTaskParams,
  ListTasksParams,
  PaginatedResponse,
} from '../types';

/**
 * Tasks API
 */
export class TasksApi {
  constructor(private client: BrowserUseClient) {}

  /**
   * List all tasks
   */
  async list(params?: ListTasksParams): Promise<PaginatedResponse<Task>> {
    return this.client.get<PaginatedResponse<Task>>('/tasks', {
      limit: params?.limit,
      cursor: params?.cursor,
      session_id: params?.sessionId,
      status: params?.status,
    });
  }

  /**
   * Create a new task
   */
  async create(params: CreateTaskParams): Promise<Task> {
    return this.client.post<Task>('/tasks', {
      task: params.task,
      session_id: params.sessionId,
      schema: params.schema,
      save_browser_data: params.save_browser_data,
    });
  }

  /**
   * Get a task by ID
   */
  async get(taskId: string): Promise<Task> {
    return this.client.get<Task>(`/tasks/${taskId}`);
  }

  /**
   * Update a task (stop, pause, resume)
   */
  async update(taskId: string, params: UpdateTaskParams): Promise<Task> {
    return this.client.patch<Task>(`/tasks/${taskId}`, {
      action: params.action,
    });
  }

  /**
   * Stop a task
   */
  async stop(taskId: string): Promise<Task> {
    return this.update(taskId, { action: 'stop' });
  }

  /**
   * Pause a task
   */
  async pause(taskId: string): Promise<Task> {
    return this.update(taskId, { action: 'pause' });
  }

  /**
   * Resume a task
   */
  async resume(taskId: string): Promise<Task> {
    return this.update(taskId, { action: 'resume' });
  }

  /**
   * Stop task and close session
   */
  async stopAndCloseSession(taskId: string): Promise<Task> {
    return this.update(taskId, { action: 'stop-and-close-session' });
  }

  /**
   * Get task logs download URL
   */
  async getLogs(taskId: string): Promise<{ url: string; expiresAt: string }> {
    return this.client.get<{ url: string; expiresAt: string }>(`/tasks/${taskId}/logs`);
  }

  /**
   * Wait for task completion
   */
  async waitForCompletion(taskId: string, pollIntervalMs = 2000, timeoutMs = 300000): Promise<Task> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const task = await this.get(taskId);

      if (['completed', 'failed', 'stopped'].includes(task.status)) {
        return task;
      }

      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }

    throw new Error(`Task ${taskId} did not complete within ${timeoutMs}ms`);
  }

  /**
   * Run a task and wait for completion
   */
  async run(params: CreateTaskParams, pollIntervalMs = 2000, timeoutMs = 300000): Promise<Task> {
    const task = await this.create(params);
    return this.waitForCompletion(task.id, pollIntervalMs, timeoutMs);
  }
}
