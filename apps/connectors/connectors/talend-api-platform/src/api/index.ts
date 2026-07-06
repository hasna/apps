// Talend API Platform Connector — Talend Cloud Management Console Public API
import { TalendClient } from './client';
import type {
  TalendConfig,
  Executable,
  Plan,
  Promotion,
  Execution,
  ExecutionRef,
  ExecutionRequest,
  Paginated,
} from '../types';

export { TalendClient } from './client';

/**
 * High-level client for the Talend Cloud Management Console Public API.
 * Groups the executables (tasks/plans/promotions) and executions endpoints.
 */
export class TalendApiPlatform {
  private readonly client: TalendClient;

  constructor(config: TalendConfig) {
    this.client = new TalendClient(config);
  }

  /**
   * Build a connector from environment variables.
   * Reads TALEND_API_TOKEN, TALEND_REGION (default 'us'), TALEND_BASE_URL.
   */
  static fromEnv(): TalendApiPlatform {
    const token = process.env.TALEND_API_TOKEN;
    if (!token) {
      throw new Error('TALEND_API_TOKEN environment variable is required');
    }
    const region = process.env.TALEND_REGION as TalendConfig['region'] | undefined;
    const baseUrl = process.env.TALEND_BASE_URL;
    return new TalendApiPlatform({ token, region, baseUrl });
  }

  // ============================================
  // Executables — tasks
  // ============================================

  /** List tasks (executables). GET /executables */
  async listTasks(options?: { limit?: number; offset?: number; environmentId?: string; workspaceId?: string }): Promise<Executable[]> {
    const data = await this.client.request<Paginated<Executable> | Executable[]>('/executables', {
      params: {
        limit: options?.limit,
        offset: options?.offset,
        environmentId: options?.environmentId,
        workspaceId: options?.workspaceId,
      },
    });
    return unwrap(data);
  }

  /** Get a single task by executable id. GET /executables/{id} */
  async getTask(id: string): Promise<Executable> {
    return this.client.request<Executable>(`/executables/${encodeURIComponent(id)}`);
  }

  // ============================================
  // Executables — plans
  // ============================================

  /** List plans. GET /executables/plans */
  async listPlans(options?: { limit?: number; offset?: number }): Promise<Plan[]> {
    const data = await this.client.request<Paginated<Plan> | Plan[]>('/executables/plans', {
      params: { limit: options?.limit, offset: options?.offset },
    });
    return unwrap(data);
  }

  /** Get a plan by id. GET /executables/plans/{id} */
  async getPlan(id: string): Promise<Plan> {
    return this.client.request<Plan>(`/executables/plans/${encodeURIComponent(id)}`);
  }

  // ============================================
  // Executables — promotions
  // ============================================

  /** List promotions. GET /executables/promotions */
  async listPromotions(options?: { limit?: number; offset?: number }): Promise<Promotion[]> {
    const data = await this.client.request<Paginated<Promotion> | Promotion[]>('/executables/promotions', {
      params: { limit: options?.limit, offset: options?.offset },
    });
    return unwrap(data);
  }

  /** Get a promotion by id. GET /executables/promotions/{id} */
  async getPromotion(id: string): Promise<Promotion> {
    return this.client.request<Promotion>(`/executables/promotions/${encodeURIComponent(id)}`);
  }

  // ============================================
  // Executions
  // ============================================

  /** Execute a task. POST /executions */
  async runTask(request: ExecutionRequest): Promise<ExecutionRef> {
    return this.client.request<ExecutionRef>('/executions', {
      method: 'POST',
      body: request as unknown as Record<string, unknown>,
    });
  }

  /** Get task execution status. GET /executions/{id} */
  async getExecution(executionId: string): Promise<Execution> {
    return this.client.request<Execution>(`/executions/${encodeURIComponent(executionId)}`);
  }

  /** Terminate a running task execution. DELETE /executions/{id} */
  async stopExecution(executionId: string): Promise<void> {
    await this.client.request(`/executions/${encodeURIComponent(executionId)}`, { method: 'DELETE' });
  }

  /** Execute a plan. POST /executions/plans */
  async runPlan(planId: string): Promise<ExecutionRef> {
    return this.client.request<ExecutionRef>('/executions/plans', {
      method: 'POST',
      body: { executable: planId },
    });
  }

  /** Get plan execution status. GET /executions/plans/{id} */
  async getPlanExecution(executionId: string): Promise<Execution> {
    return this.client.request<Execution>(`/executions/plans/${encodeURIComponent(executionId)}`);
  }

  /** Token preview for display/debugging. */
  getTokenPreview(): string {
    return this.client.getTokenPreview();
  }

  /** Access the underlying HTTP client for advanced/direct calls. */
  getClient(): TalendClient {
    return this.client;
  }
}

/** Normalize list responses that may be a bare array or a paginated envelope. */
function unwrap<T>(data: Paginated<T> | T[]): T[] {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.items)) return data.items;
  return [];
}
