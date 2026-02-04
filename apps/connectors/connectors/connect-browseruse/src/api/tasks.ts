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
   * @param params Task parameters including optional sensitive_data for secure credential handling
   */
  async create(params: CreateTaskParams): Promise<Task> {
    const body: Record<string, unknown> = {
      task: params.task,
    };

    // Add optional parameters only if provided
    if (params.sessionId) body.session_id = params.sessionId;
    if (params.schema) body.schema = params.schema;
    if (params.save_browser_data !== undefined) body.save_browser_data = params.save_browser_data;

    // Security-related parameters
    if (params.sensitive_data) body.sensitive_data = params.sensitive_data;
    if (params.use_vision !== undefined) body.use_vision = params.use_vision;
    if (params.allowed_domains) body.allowed_domains = params.allowed_domains;

    return this.client.post<Task>('/tasks', body);
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
