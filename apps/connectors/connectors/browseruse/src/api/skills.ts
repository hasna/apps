import type { BrowserUseClient } from './client';
import type {
  Skill,
  CreateSkillParams,
  UpdateSkillParams,
  ExecuteSkillParams,
  RefineSkillParams,
  SkillExecution,
  ListSkillsParams,
  ListSkillExecutionsParams,
  PaginatedResponse,
  PresignedUrl,
  MarketplaceSkill,
  CloneSkillParams,
} from '../types';

/**
 * Skills API
 */
export class SkillsApi {
  constructor(private client: BrowserUseClient) {}

  /**
   * List all skills
   */
  async list(params?: ListSkillsParams): Promise<PaginatedResponse<Skill>> {
    return this.client.get<PaginatedResponse<Skill>>('/v2/skills', {
      limit: params?.limit,
      cursor: params?.cursor,
      status: params?.status,
    });
  }

  /**
   * Create a new skill
   */
  async create(params: CreateSkillParams): Promise<Skill> {
    return this.client.post<Skill>('/v2/skills', {
      name: params.name,
      description: params.description,
      task: params.task,
      example_inputs: params.exampleInputs,
    });
  }

  /**
   * Get a skill by ID
   */
  async get(skillId: string): Promise<Skill> {
    return this.client.get<Skill>(`/v2/skills/${skillId}`);
  }

  /**
   * Update a skill
   */
  async update(skillId: string, params: UpdateSkillParams): Promise<Skill> {
    return this.client.patch<Skill>(`/v2/skills/${skillId}`, {
      name: params.name,
      description: params.description,
      is_public: params.isPublic,
    });
  }

  /**
   * Delete a skill
   */
  async delete(skillId: string): Promise<void> {
    await this.client.delete(`/v2/skills/${skillId}`);
  }

  /**
   * Execute a skill
   */
  async execute(skillId: string, params: ExecuteSkillParams): Promise<SkillExecution> {
    return this.client.post<SkillExecution>(`/v2/skills/${skillId}/execute`, {
      parameters: params.parameters,
      session_id: params.sessionId,
    });
  }

  /**
   * Refine a skill
   */
  async refine(skillId: string, params: RefineSkillParams): Promise<Skill> {
    return this.client.post<Skill>(`/v2/skills/${skillId}/refine`, {
      feedback: params.feedback,
    });
  }

  /**
   * Cancel skill generation
   */
  async cancelGeneration(skillId: string): Promise<Skill> {
    return this.client.post<Skill>(`/v2/skills/${skillId}/cancel`);
  }

  /**
   * Rollback skill to previous version
   */
  async rollback(skillId: string, version?: number): Promise<Skill> {
    return this.client.post<Skill>(`/v2/skills/${skillId}/rollback`, {
      version,
    });
  }

  /**
   * List skill executions
   */
  async listExecutions(skillId: string, params?: ListSkillExecutionsParams): Promise<PaginatedResponse<SkillExecution>> {
    return this.client.get<PaginatedResponse<SkillExecution>>(`/v2/skills/${skillId}/executions`, {
      limit: params?.limit,
      cursor: params?.cursor,
    });
  }

  /**
   * Get skill execution output download URL
   */
  async getExecutionOutput(skillId: string, executionId: string): Promise<PresignedUrl> {
    return this.client.get<PresignedUrl>(`/v2/skills/${skillId}/executions/${executionId}/output`);
  }

  /**
   * Wait for skill execution completion
   */
  async waitForExecution(skillId: string, executionId: string, pollIntervalMs = 2000, timeoutMs = 300000): Promise<SkillExecution> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const executions = await this.listExecutions(skillId, { limit: 100 });
      const execution = executions.data.find(e => e.id === executionId);

      if (execution && ['completed', 'failed'].includes(execution.status)) {
        return execution;
      }

      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }

    throw new Error(`Skill execution ${executionId} did not complete within ${timeoutMs}ms`);
  }

  /**
   * Run a skill and wait for completion
   */
  async run(skillId: string, params: ExecuteSkillParams, pollIntervalMs = 2000, timeoutMs = 300000): Promise<SkillExecution> {
    const execution = await this.execute(skillId, params);
    return this.waitForExecution(skillId, execution.id, pollIntervalMs, timeoutMs);
  }
}

/**
 * Skills Marketplace API
 */
export class MarketplaceApi {
  constructor(private client: BrowserUseClient) {}

  /**
   * List marketplace skills
   */
  async list(params?: { limit?: number; cursor?: string; search?: string }): Promise<PaginatedResponse<MarketplaceSkill>> {
    return this.client.get<PaginatedResponse<MarketplaceSkill>>('/v2/marketplace/skills', {
      limit: params?.limit,
      cursor: params?.cursor,
      search: params?.search,
    });
  }

  /**
   * Get a marketplace skill by ID
   */
  async get(skillId: string): Promise<MarketplaceSkill> {
    return this.client.get<MarketplaceSkill>(`/v2/marketplace/skills/${skillId}`);
  }

  /**
   * Clone a marketplace skill to your project
   */
  async clone(skillId: string, params?: CloneSkillParams): Promise<Skill> {
    return this.client.post<Skill>(`/v2/marketplace/skills/${skillId}/clone`, {
      name: params?.name,
    });
  }

  /**
   * Execute a marketplace skill directly
   */
  async execute(skillId: string, params: ExecuteSkillParams): Promise<SkillExecution> {
    return this.client.post<SkillExecution>(`/v2/marketplace/skills/${skillId}/execute`, {
      parameters: params.parameters,
      session_id: params.sessionId,
    });
  }
}
