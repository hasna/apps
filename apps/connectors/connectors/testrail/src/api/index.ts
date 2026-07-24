import { TestRailClient, type RequestOptions } from './client';
import type {
  TestRailConfig,
  Project,
  Case,
  Run,
  Result,
  Plan,
  Milestone,
  CreateCaseInput,
  UpdateCaseInput,
  CreateRunInput,
  AddResultInput,
} from '../types';

export { TestRailClient } from './client';

export class TestRail {
  private client: TestRailClient;

  constructor(config: TestRailConfig) {
    this.client = new TestRailClient(config);
  }

  static fromEnv(): TestRail {
    const email = process.env.TESTRAIL_EMAIL;
    const apiKey = process.env.TESTRAIL_API_KEY;
    const baseUrl = process.env.TESTRAIL_BASE_URL;
    if (!email || !apiKey || !baseUrl) {
      throw new Error('TESTRAIL_EMAIL, TESTRAIL_API_KEY, and TESTRAIL_BASE_URL are required');
    }
    return new TestRail({ email, apiKey, baseUrl });
  }

  // Projects
  async listProjects(): Promise<Project[]> {
    return this.client.get<Project[]>('get_projects');
  }

  async getProject(projectId: number): Promise<Project> {
    return this.client.get<Project>('get_project', [projectId]);
  }

  // Cases
  async listCases(
    projectId: number,
    options?: {
      suite_id?: number;
      section_id?: number;
      created_after?: number;
      created_before?: number;
      created_by?: number[];
      limit?: number;
      offset?: number;
    }
  ): Promise<Case[]> {
    return this.client.get<Case[]>('get_cases', [projectId], options);
  }

  async getCase(caseId: number): Promise<Case> {
    return this.client.get<Case>('get_case', [caseId]);
  }

  async createCase(projectId: number, input: CreateCaseInput): Promise<Case> {
    return this.client.post<Case>('add_case', [projectId], input);
  }

  async updateCase(caseId: number, input: UpdateCaseInput): Promise<Case> {
    return this.client.post<Case>('update_case', [caseId], input);
  }

  // Runs
  async listRuns(
    projectId: number,
    options?: {
      suite_id?: number;
      created_after?: number;
      created_before?: number;
      created_by?: number[];
      is_completed?: 0 | 1;
      limit?: number;
      offset?: number;
    }
  ): Promise<Run[]> {
    return this.client.get<Run[]>('get_runs', [projectId], options);
  }

  async getRun(runId: number): Promise<Run> {
    return this.client.get<Run>('get_run', [runId]);
  }

  async createRun(projectId: number, input: CreateRunInput): Promise<Run> {
    return this.client.post<Run>('add_run', [projectId], input);
  }

  // Results
  async listResultsForRun(
    runId: number,
    options?: { limit?: number; offset?: number }
  ): Promise<Result[]> {
    return this.client.get<Result[]>('get_results_for_run', [runId], options);
  }

  async addResultForCase(
    runId: number,
    caseId: number,
    input: AddResultInput
  ): Promise<Result> {
    return this.client.post<Result>('add_result_for_case', [runId, caseId], input);
  }

  // Plans
  async listPlans(
    projectId: number,
    options?: {
      created_after?: number;
      created_before?: number;
      created_by?: number[];
      is_completed?: 0 | 1;
      limit?: number;
      offset?: number;
    }
  ): Promise<Plan[]> {
    return this.client.get<Plan[]>('get_plans', [projectId], options);
  }

  async getPlan(planId: number): Promise<Plan> {
    return this.client.get<Plan>('get_plan', [planId]);
  }

  // Milestones
  async listMilestones(
    projectId: number,
    options?: {
      is_started?: 0 | 1;
      is_completed?: 0 | 1;
      is_started_is_completed?: 0 | 1;
      limit?: number;
      offset?: number;
    }
  ): Promise<Milestone[]> {
    return this.client.get<Milestone[]>('get_milestones', [projectId], options);
  }

  async getMilestone(milestoneId: number): Promise<Milestone> {
    return this.client.get<Milestone>('get_milestone', [milestoneId]);
  }

  /**
   * Execute a raw TestRail API method (e.g. for endpoints not wrapped above).
   */
  async rawRequest<T>(
    method: string,
    segments: Array<string | number> = [],
    options?: RequestOptions
  ): Promise<T> {
    return this.client.request<T>(method, segments, options);
  }

  getClient(): TestRailClient {
    return this.client;
  }
}
