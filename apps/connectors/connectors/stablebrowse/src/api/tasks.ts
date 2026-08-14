import type { StableBrowseClient } from './client';
import type {
  Task,
  SubmitTaskParams,
  SubmitTaskResponse,
  ListTasksParams,
  ListTasksResponse,
} from '../types';

const TERMINAL_STATUSES: ReadonlyArray<Task['status']> = ['completed', 'failed', 'cancelled'];

/**
 * Tasks API
 */
export class TasksApi {
  constructor(private client: StableBrowseClient) {}

  /**
   * Submit a new background task. Returns immediately with a taskId to poll.
   */
  async submit(params: SubmitTaskParams): Promise<SubmitTaskResponse> {
    return this.client.post<SubmitTaskResponse>('/tasks', {
      endUserId: params.endUserId,
      task: params.task,
      sessionId: params.sessionId,
      startUrl: params.startUrl,
      schema: params.schema,
      maxSteps: params.maxSteps,
      include_html_dump: params.include_html_dump,
    });
  }

  /**
   * Get a task by ID, including status and results.
   */
  async get(taskId: string): Promise<Task> {
    return this.client.get<Task>(`/tasks/${encodeURIComponent(taskId)}`);
  }

  /**
   * List tasks, grouped by conversation session (most recent first).
   */
  async list(params?: ListTasksParams): Promise<ListTasksResponse> {
    return this.client.get<ListTasksResponse>('/tasks', {
      limit: params?.limit,
    });
  }

  /**
   * Poll a task until it reaches a terminal status or the timeout elapses.
   */
  async waitForCompletion(taskId: string, pollIntervalMs = 2000, timeoutMs = 300000): Promise<Task> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const task = await this.get(taskId);

      if (TERMINAL_STATUSES.includes(task.status)) {
        return task;
      }

      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }

    throw new Error(`Task ${taskId} did not complete within ${timeoutMs}ms`);
  }

  /**
   * Submit a task and wait for completion.
   */
  async run(params: SubmitTaskParams, pollIntervalMs = 2000, timeoutMs = 300000): Promise<Task> {
    const submitted = await this.submit(params);
    return this.waitForCompletion(submitted.taskId, pollIntervalMs, timeoutMs);
  }
}
