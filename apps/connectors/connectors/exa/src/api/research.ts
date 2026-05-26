import type { ExaClient } from './client';
import type {
  ResearchTask,
  ResearchCreateOptions,
  ResearchListParams,
  ResearchListResponse,
} from '../types';

/**
 * Research API - Async research tasks for comprehensive investigations
 */
export class ResearchApi {
  constructor(private readonly client: ExaClient) {}

  /**
   * Create a new research task
   */
  async create(options: ResearchCreateOptions): Promise<ResearchTask> {
    const body: Record<string, unknown> = {
      query: options.query,
    };

    if (options.depth) {
      body.depth = options.depth;
    }

    return this.client.post<ResearchTask>('/research', body);
  }

  /**
   * Get a research task by ID
   */
  async get(taskId: string): Promise<ResearchTask> {
    return this.client.get<ResearchTask>(`/research/${taskId}`);
  }

  /**
   * List research tasks
   */
  async list(params: ResearchListParams = {}): Promise<ResearchListResponse> {
    const queryParams: Record<string, string | number | boolean | undefined> = {};

    if (params.limit !== undefined) {
      queryParams.limit = params.limit;
    }
    if (params.offset !== undefined) {
      queryParams.offset = params.offset;
    }
    if (params.status) {
      queryParams.status = params.status;
    }

    return this.client.get<ResearchListResponse>('/research', queryParams);
  }

  /**
   * Cancel a research task
   */
  async cancel(taskId: string): Promise<ResearchTask> {
    return this.client.post<ResearchTask>(`/research/${taskId}/cancel`);
  }

  /**
   * Create a basic research task
   */
  async createBasic(query: string): Promise<ResearchTask> {
    return this.create({ query, depth: 'basic' });
  }

  /**
   * Create a thorough research task
   */
  async createThorough(query: string): Promise<ResearchTask> {
    return this.create({ query, depth: 'thorough' });
  }

  /**
   * Create a comprehensive research task
   */
  async createComprehensive(query: string): Promise<ResearchTask> {
    return this.create({ query, depth: 'comprehensive' });
  }

  /**
   * Wait for a research task to complete
   * Polls the task status until it's completed, failed, or timeout
   */
  async waitForCompletion(
    taskId: string,
    options: {
      pollIntervalMs?: number;
      timeoutMs?: number;
    } = {}
  ): Promise<ResearchTask> {
    const { pollIntervalMs = 5000, timeoutMs = 300000 } = options;
    const startTime = Date.now();

    while (true) {
      const task = await this.get(taskId);

      if (task.status === 'completed' || task.status === 'failed') {
        return task;
      }

      if (Date.now() - startTime > timeoutMs) {
        throw new Error(`Research task ${taskId} timed out after ${timeoutMs}ms`);
      }

      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }
  }

  /**
   * Create and wait for a research task to complete
   */
  async createAndWait(
    options: ResearchCreateOptions,
    waitOptions: {
      pollIntervalMs?: number;
      timeoutMs?: number;
    } = {}
  ): Promise<ResearchTask> {
    const task = await this.create(options);
    return this.waitForCompletion(task.id, waitOptions);
  }

  /**
   * List pending tasks
   */
  async listPending(limit?: number): Promise<ResearchListResponse> {
    return this.list({ status: 'pending', limit });
  }

  /**
   * List running tasks
   */
  async listRunning(limit?: number): Promise<ResearchListResponse> {
    return this.list({ status: 'running', limit });
  }

  /**
   * List completed tasks
   */
  async listCompleted(limit?: number): Promise<ResearchListResponse> {
    return this.list({ status: 'completed', limit });
  }

  /**
   * List failed tasks
   */
  async listFailed(limit?: number): Promise<ResearchListResponse> {
    return this.list({ status: 'failed', limit });
  }
}
