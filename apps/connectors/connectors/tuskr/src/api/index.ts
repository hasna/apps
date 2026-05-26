// Tuskr Connector — Test case management and QA platform
import { TuskrClient } from './client';
import type { TuskrConfig, TKProject, TKTestCase, TKTestRun, TKTestResult, TKFolder } from '../types';
export { TuskrClient } from './client';

export class Tuskr {
  private readonly client: TuskrClient;
  constructor(config: TuskrConfig) { this.client = new TuskrClient(config); }
  static fromEnv(): Tuskr {
    const token = process.env.TUSKR_TOKEN;
    if (!token) throw new Error('TUSKR_TOKEN is required');
    return new Tuskr({ token });
  }

  async listProjects(): Promise<TKProject[]> { return this.client.request<TKProject[]>('/projects'); }
  async getProject(projectId: string): Promise<TKProject> { return this.client.request<TKProject>(`/projects/${projectId}`); }

  async listTestCases(projectId: string, options?: { folder_id?: string }): Promise<TKTestCase[]> {
    return this.client.request<TKTestCase[]>(`/projects/${projectId}/test-cases`, { params: { folder_id: options?.folder_id } });
  }
  async getTestCase(projectId: string, testCaseId: string): Promise<TKTestCase> {
    return this.client.request<TKTestCase>(`/projects/${projectId}/test-cases/${testCaseId}`);
  }
  async createTestCase(projectId: string, data: { title: string; description?: string; steps?: { step: string; expected_result: string }[]; priority?: string; type?: string; folder_id?: string }): Promise<TKTestCase> {
    return this.client.request<TKTestCase>(`/projects/${projectId}/test-cases`, { method: 'POST', body: data as Record<string, unknown> });
  }

  async listTestRuns(projectId: string): Promise<TKTestRun[]> { return this.client.request<TKTestRun[]>(`/projects/${projectId}/test-runs`); }
  async getTestRun(projectId: string, testRunId: string): Promise<TKTestRun> {
    return this.client.request<TKTestRun>(`/projects/${projectId}/test-runs/${testRunId}`);
  }
  async createTestRun(projectId: string, data: { name: string; description?: string; test_case_ids: string[] }): Promise<TKTestRun> {
    return this.client.request<TKTestRun>(`/projects/${projectId}/test-runs`, { method: 'POST', body: data as Record<string, unknown> });
  }

  async listTestResults(projectId: string, testRunId: string): Promise<TKTestResult[]> {
    return this.client.request<TKTestResult[]>(`/projects/${projectId}/test-runs/${testRunId}/results`);
  }
  async updateTestResult(projectId: string, testRunId: string, resultId: string, data: { status: string; comment?: string }): Promise<TKTestResult> {
    return this.client.request<TKTestResult>(`/projects/${projectId}/test-runs/${testRunId}/results/${resultId}`, { method: 'PATCH', body: data as Record<string, unknown> });
  }

  async listFolders(projectId: string): Promise<TKFolder[]> { return this.client.request<TKFolder[]>(`/projects/${projectId}/folders`); }

  getClient(): TuskrClient { return this.client; }
}
